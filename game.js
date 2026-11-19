// Logique d'une partie, sans Socket.io : la grille, la validation des mots et
// les scores. Le serveur fait autorité : tout se décide ici.
const { generateGrid } = require('./grid');
const {
  AVATARS, USES_PER_GAME, POWER_DURATION_MS, FREEZE,
} = require('./powers');

const WRONG_LOCK_MS = 3000; // un mot raté est bloqué 3 s pour celui qui s'est trompé

// "frérot", "Frerot " et "FREROT" deviennent tous "FREROT".
function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

// Accepte une chaîne ("SEUM") ou un tableau de lettres (["S","E","U","M"]),
// et ignore tout le reste (le client peut envoyer n'importe quoi).
function readLetters(letters) {
  if (typeof letters === 'string') return normalize(letters.slice(0, 50));
  if (Array.isArray(letters)) {
    return normalize(letters.slice(0, 50).map((l) => (typeof l === 'string' ? l : '')).join(''));
  }
  return '';
}

class Game {
  // avatars : ['givre', 'perche'] en duo, un seul en solo (pas de pouvoir).
  constructor(grid = generateGrid(), avatars = []) {
    this.grid = grid; // contient les solutions : ne quitte jamais le serveur
    this.scores = [0, 0];
    this.claimedBy = new Map(); // wordId -> numéro du joueur (0 ou 1)
    this.over = false;
    this.lockedUntil = [new Map(), new Map()]; // par joueur : wordId -> heure de fin du blocage
    this.bought = [new Set(), new Set()]; // par joueur : cases "ligne,colonne" achetées
    this.avatars = avatars;
    this.powersLeft = [USES_PER_GAME, USES_PER_GAME];
    // Par joueur : null, ou { layers, since, lastScrapeAt } tant qu'il est gelé.
    this.frozen = [null, null];
  }

  // Ce que le navigateur a le droit de voir : positions, longueurs, numéros et
  // définitions. Jamais `answer`, `display` ni `type`.
  getPublicGrid() {
    const { width, height, words } = this.grid;
    return {
      grid: {
        width,
        height,
        words: words.map(({ id, number, direction, row, col, length }) => ({
          id, number, direction, row, col, length,
        })),
      },
      clues: words.map(({ id, number, direction, clue }) => ({
        wordId: id, number, direction, clue,
      })),
    };
  }

  getWord(wordId) {
    return this.grid.words.find((w) => w.id === wordId) || null;
  }

  // Un joueur propose un mot. Renvoie ce qui s'est passé :
  // - { type: 'ignored' } : mot inconnu, déjà trouvé ou incomplet (pas de pénalité)
  // - { type: 'claimed', ... } : juste, +1, le mot est à lui
  // - { type: 'wrong', ... } : faux, -1, et le mot est bloqué 3 s pour lui
  // - { type: 'locked', ... } : le mot est encore bloqué pour lui (pas de pénalité)
  submitWord(slot, wordId, letters, now = Date.now()) {
    if (this.over || this.frozen[slot]) return { type: 'ignored' }; // gelé : il ne peut rien faire
    const word = this.getWord(wordId);
    if (!word || this.claimedBy.has(wordId)) return { type: 'ignored' };

    const lockedUntil = this.lockedUntil[slot].get(wordId) || 0;
    if (now < lockedUntil) return { type: 'locked', wordId, lockedUntil };

    const answer = readLetters(letters);
    if (answer.length !== word.length) return { type: 'ignored' };

    if (answer === word.answer) {
      this.claimedBy.set(wordId, slot);
      this.scores[slot] += 1;
      return { type: 'claimed', wordId, letters: word.answer, by: slot, scores: [...this.scores] };
    }

    this.scores[slot] -= 1;
    this.lockedUntil[slot].set(wordId, now + WRONG_LOCK_MS);
    return { type: 'wrong', wordId, scores: [...this.scores], lockedUntil: now + WRONG_LOCK_MS };
  }

  // Les cases d'un mot, dans l'ordre : ["ligne,colonne", ...]
  cellsOf(word) {
    return Array.from({ length: word.length }, (_, i) => {
      const r = word.row + (word.direction === 'down' ? i : 0);
      const c = word.col + (word.direction === 'across' ? i : 0);
      return `${r},${c}`;
    });
  }

  // Le joueur achète une lettre du mot (-1). On lui révèle, à lui seul, une case
  // qu'il ne connaît pas encore : ni achetée, ni venue d'un mot déjà trouvé.
  buyLetter(slot, wordId) {
    if (this.over || this.frozen[slot]) return { type: 'ignored' };
    const word = this.getWord(wordId);
    if (!word || this.claimedBy.has(wordId)) return { type: 'ignored' };

    const known = new Set(this.bought[slot]);
    for (const id of this.claimedBy.keys()) this.cellsOf(this.getWord(id)).forEach((k) => known.add(k));

    const cells = this.cellsOf(word);
    const hidden = cells.map((k, index) => ({ k, index })).filter(({ k }) => !known.has(k));
    if (hidden.length === 0) return { type: 'ignored' };

    const { k, index } = hidden[Math.floor(Math.random() * hidden.length)];
    this.bought[slot].add(k);
    this.scores[slot] -= 1;
    return { type: 'revealed', wordId, index, letter: word.answer[index], scores: [...this.scores] };
  }

  // Le joueur lance le pouvoir de son avatar sur l'adversaire.
  // - { type: 'refused', reason } : solo, partie finie, plus d'utilisation...
  // - { type: 'used', power, target, duration, payload, remaining }
  usePower(slot, now = Date.now()) {
    if (this.over) return { type: 'refused', reason: 'La partie est finie' };
    if (this.avatars.length < 2) return { type: 'refused', reason: 'Pas de pouvoir en solo' };
    if (this.frozen[slot]) return { type: 'refused', reason: 'Tu es gelé : racle d\'abord ton givre !' };
    if (this.powersLeft[slot] <= 0) return { type: 'refused', reason: 'Plus de pouvoir pour cette partie' };

    const power = AVATARS[this.avatars[slot]].power;
    const target = 1 - slot;
    let payload = {};
    let duration = POWER_DURATION_MS;

    if (power === 'freeze') {
      // On ne gèle pas quelqu'un qui l'est déjà (et le pouvoir n'est pas consommé).
      if (this.frozen[target]) return { type: 'refused', reason: 'Ton adversaire est déjà gelé' };
      this.frozen[target] = { layers: FREEZE.layers, since: now, lastScrapeAt: now };
      payload = { layers: FREEZE.layers };
      duration = FREEZE.maxMs;
    }

    this.powersLeft[slot] -= 1;
    return {
      type: 'used', power, target, duration, payload, remaining: this.powersLeft[slot],
    };
  }

  // Un coup de raclette du joueur gelé.
  // - { type: 'ignored' } : pas gelé, ou coups trop rapprochés
  // - { type: 'frost', layers } : une couche de moins
  // - { type: 'thawed' } : plus de givre, il peut rejouer
  scrape(slot, now = Date.now()) {
    const frozen = this.frozen[slot];
    if (!frozen || this.over) return { type: 'ignored' };
    if (now - frozen.lastScrapeAt < FREEZE.minScrapeGapMs) return { type: 'ignored' };
    frozen.lastScrapeAt = now;
    // Avant 2 s de gel, il reste toujours au moins une couche.
    const floor = now - frozen.since < FREEZE.minMs ? 1 : 0;
    frozen.layers = Math.max(floor, frozen.layers - 1);
    if (frozen.layers === 0) {
      this.frozen[slot] = null;
      return { type: 'thawed' };
    }
    return { type: 'frost', layers: frozen.layers };
  }

  // Appelé régulièrement : s'il a arrêté de racler depuis 2 s, une couche repousse.
  // Renvoie le nouveau nombre de couches, ou null si rien n'a changé.
  regrow(slot, now = Date.now()) {
    const frozen = this.frozen[slot];
    if (!frozen || frozen.layers >= FREEZE.layers) return null;
    if (now - frozen.lastScrapeAt < FREEZE.regrowMs) return null;
    frozen.layers += 1;
    frozen.lastScrapeAt = now; // la prochaine couche repoussera 2 s plus tard
    return frozen.layers;
  }

  // Dégivrage forcé (sécurité au bout de 20 s).
  thaw(slot) {
    const wasFrozen = Boolean(this.frozen[slot]);
    this.frozen[slot] = null;
    return wasFrozen;
  }

  isComplete() {
    return this.claimedBy.size === this.grid.words.length;
  }

  // Termine la partie (chrono à zéro ou grille pleine). winner vaut le numéro
  // du gagnant, ou null en cas d'égalité.
  finish() {
    this.over = true;
    const [a, b] = this.scores;
    return { scores: [...this.scores], winner: a === b ? null : (a > b ? 0 : 1) };
  }
}

module.exports = { Game, normalize, WRONG_LOCK_MS };
