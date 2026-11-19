// Logique d'une partie, sans Socket.io : la grille, la validation des mots et
// les scores. Le serveur fait autorité : tout se décide ici.
const { generateGrid } = require('./grid');

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
  constructor(grid = generateGrid()) {
    this.grid = grid; // contient les solutions : ne quitte jamais le serveur
    this.scores = [0, 0];
    this.claimedBy = new Map(); // wordId -> numéro du joueur (0 ou 1)
    this.over = false;
    this.lockedUntil = [new Map(), new Map()]; // par joueur : wordId -> heure de fin du blocage
    this.bought = [new Set(), new Set()]; // par joueur : cases "ligne,colonne" achetées
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
    if (this.over) return { type: 'ignored' };
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
    if (this.over) return { type: 'ignored' };
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
