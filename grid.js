// Fabrication d'une grille de mots croisés à partir de data/mots.json.
//
// Méthode : placement "glouton" avec beaucoup d'essais.
// - On mélange les mots classiques et les mots d'argot, puis on les pose un par
//   un en alternant les deux types. Le premier mot est posé à l'horizontale.
// - Chaque mot suivant doit croiser une lettre déjà posée. On liste toutes les
//   positions valides (lettres qui correspondent, pas de mot collé à un autre)
//   et on choisit celle qui croise le plus de mots et garde la grille compacte.
// - Si un mot ne rentre nulle part, on le saute et on prend le suivant du même
//   type. On recommence tout ça plusieurs fois et on garde la meilleure grille.
const WORDS = require('./data/mots.json');

const MIN_WORDS = 8;
const MAX_WORDS = 10;
const MAX_SIZE = 13; // largeur et hauteur max de la grille, en cases
const ATTEMPTS = 60;

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// La grille en construction : une Map "ligne,colonne" -> { letter, across, down }
// (across/down disent si un mot horizontal/vertical passe déjà par la case).
function key(row, col) {
  return `${row},${col}`;
}

// Teste si `word` peut être posé à (row, col) dans la direction donnée.
// Renvoie le nombre de croisements, ou -1 si la position est interdite.
function checkPlacement(cells, word, row, col, direction) {
  const dRow = direction === 'down' ? 1 : 0;
  const dCol = direction === 'across' ? 1 : 0;

  // Les cases juste avant et juste après le mot doivent être vides,
  // sinon il se collerait à un autre mot et formerait un mot inexistant.
  if (cells.has(key(row - dRow, col - dCol))) return -1;
  if (cells.has(key(row + dRow * word.length, col + dCol * word.length))) return -1;

  let crossings = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dRow * i;
    const c = col + dCol * i;
    const cell = cells.get(key(r, c));

    if (cell) {
      // Croisement : même lettre, et aucun mot déjà posé dans la même direction.
      if (cell.letter !== word[i] || cell[direction]) return -1;
      crossings++;
    } else {
      // Case neuve : ses voisines sur les côtés doivent être vides
      // (sinon deux mots parallèles se toucheraient).
      if (cells.has(key(r + dCol, c + dRow)) || cells.has(key(r - dCol, c - dRow))) return -1;
    }
  }
  return crossings;
}

function placeWord(cells, word, row, col, direction) {
  const dRow = direction === 'down' ? 1 : 0;
  const dCol = direction === 'across' ? 1 : 0;
  for (let i = 0; i < word.length; i++) {
    const k = key(row + dRow * i, col + dCol * i);
    const cell = cells.get(k) || { letter: word[i], across: false, down: false };
    cell[direction] = true;
    cells.set(k, cell);
  }
}

// Taille de la grille (rectangle qui englobe toutes les cases) si on ajoutait
// le mot à cette position.
function boundsWith(bounds, row, col, length, direction) {
  const endRow = direction === 'down' ? row + length - 1 : row;
  const endCol = direction === 'across' ? col + length - 1 : col;
  return {
    minRow: Math.min(bounds.minRow, row),
    maxRow: Math.max(bounds.maxRow, endRow),
    minCol: Math.min(bounds.minCol, col),
    maxCol: Math.max(bounds.maxCol, endCol),
  };
}

// Cherche la meilleure position pour `word` qui croise la grille actuelle.
function findBestPlacement(cells, bounds, word) {
  let best = null;
  for (const [k, cell] of cells) {
    const [cellRow, cellCol] = k.split(',').map(Number);
    for (let i = 0; i < word.length; i++) {
      if (word[i] !== cell.letter) continue;
      // Le nouveau mot part dans la direction libre de cette case.
      for (const direction of ['across', 'down']) {
        if (cell[direction]) continue;
        const row = direction === 'down' ? cellRow - i : cellRow;
        const col = direction === 'across' ? cellCol - i : cellCol;
        const crossings = checkPlacement(cells, word, row, col, direction);
        if (crossings < 1) continue;

        const b = boundsWith(bounds, row, col, word.length, direction);
        const height = b.maxRow - b.minRow + 1;
        const width = b.maxCol - b.minCol + 1;
        if (height > MAX_SIZE || width > MAX_SIZE) continue;

        // Plus de croisements = mieux ; à égalité, la grille la plus carrée et
        // la plus petite. Un peu de hasard pour varier les grilles.
        const score = crossings * 10 - Math.max(width, height) - (width * height) / 50 + Math.random();
        if (!best || score > best.score) best = { row, col, direction, score, bounds: b };
      }
    }
  }
  return best;
}

// Un essai : pose `target` mots en alternant les deux types.
function tryBuild(target) {
  const pools = {
    classique: shuffle(WORDS.filter((w) => w.type === 'classique')),
    argot: shuffle(WORDS.filter((w) => w.type === 'argot')),
  };
  // Pour un nombre impair de mots, le type en plus est tiré au hasard.
  let turn = Math.random() < 0.5 ? 'classique' : 'argot';
  const quota = {
    [turn]: Math.ceil(target / 2),
    [turn === 'classique' ? 'argot' : 'classique']: Math.floor(target / 2),
  };

  const cells = new Map();
  const placed = [];
  let bounds = null;

  while (placed.length < target) {
    if (quota[turn] === 0) turn = turn === 'classique' ? 'argot' : 'classique';
    const pool = pools[turn];
    let done = false;

    while (pool.length && !done) {
      const entry = pool.shift();
      const word = entry.mot;

      if (!bounds) {
        // Premier mot : à l'horizontale, en haut à gauche.
        if (word.length > MAX_SIZE) continue;
        placeWord(cells, word, 0, 0, 'across');
        bounds = { minRow: 0, maxRow: 0, minCol: 0, maxCol: word.length - 1 };
        placed.push({ entry, row: 0, col: 0, direction: 'across' });
        done = true;
        continue;
      }

      const spot = findBestPlacement(cells, bounds, word);
      if (!spot) continue; // ce mot ne rentre pas : on essaie le suivant
      placeWord(cells, word, spot.row, spot.col, spot.direction);
      bounds = spot.bounds;
      placed.push({ entry, row: spot.row, col: spot.col, direction: spot.direction });
      done = true;
    }

    if (!done) return null; // plus aucun mot de ce type ne rentre : essai raté
    quota[turn]--;
    turn = turn === 'classique' ? 'argot' : 'classique';
  }

  const crossings = [...cells.values()].filter((cell) => cell.across && cell.down).length;
  return { placed, bounds, crossings };
}

// Numérote les mots comme dans une vraie grille : de haut en bas puis de gauche
// à droite ; un horizontal et un vertical qui partent de la même case partagent
// le même numéro.
function finalize({ placed, bounds }) {
  const words = placed.map(({ entry, row, col, direction }) => ({
    row: row - bounds.minRow,
    col: col - bounds.minCol,
    direction,
    length: entry.mot.length,
    answer: entry.mot,
    display: entry.affichage,
    clue: entry.definition,
    type: entry.type,
  }));

  const starts = [...new Set(words.map((w) => key(w.row, w.col)))]
    .map((k) => k.split(',').map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const numbers = new Map(starts.map(([r, c], i) => [key(r, c), i + 1]));

  words.forEach((w) => { w.number = numbers.get(key(w.row, w.col)); });
  words.sort((a, b) => a.number - b.number || (a.direction === 'across' ? -1 : 1));
  words.forEach((w, i) => { w.id = `w${i}`; });

  return {
    width: bounds.maxCol - bounds.minCol + 1,
    height: bounds.maxRow - bounds.minRow + 1,
    words,
  };
}

// Point d'entrée : renvoie une grille complète AVEC les solutions.
// Ce résultat reste sur le serveur (voir game.js pour la version publique).
function generateGrid() {
  const target = MIN_WORDS + Math.floor(Math.random() * (MAX_WORDS - MIN_WORDS + 1));
  let best = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const result = tryBuild(target);
    if (!result) continue;
    const { bounds } = result;
    const size = Math.max(bounds.maxRow - bounds.minRow, bounds.maxCol - bounds.minCol) + 1;
    const score = result.crossings * 3 - size;
    if (!best || score > best.score) best = { ...result, score };
  }

  if (!best) throw new Error('Impossible de construire une grille avec la bibliothèque actuelle');
  return finalize(best);
}

module.exports = { generateGrid, MIN_WORDS, MAX_WORDS, MAX_SIZE };
