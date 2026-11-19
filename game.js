// Logique d'une partie, sans Socket.io : la grille, la validation des mots et
// les scores. Le serveur fait autorité : tout se décide ici.
const { generateGrid } = require('./grid');

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
  // - { type: 'wrong', ... } : faux, -1
  submitWord(slot, wordId, letters) {
    if (this.over) return { type: 'ignored' };
    const word = this.getWord(wordId);
    if (!word || this.claimedBy.has(wordId)) return { type: 'ignored' };

    const answer = readLetters(letters);
    if (answer.length !== word.length) return { type: 'ignored' };

    if (answer === word.answer) {
      this.claimedBy.set(wordId, slot);
      this.scores[slot] += 1;
      return { type: 'claimed', wordId, letters: word.answer, by: slot, scores: [...this.scores] };
    }

    this.scores[slot] -= 1;
    return { type: 'wrong', wordId, scores: [...this.scores] };
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

module.exports = { Game, normalize };
