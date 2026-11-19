// Vérifie sur beaucoup de grilles tirées au hasard qu'elles sont valides.
const test = require('node:test');
const assert = require('node:assert');
const { generateGrid, MIN_WORDS, MAX_WORDS, MAX_SIZE } = require('../grid');

// Reconstruit le dessin de la grille et vérifie toutes les règles.
function checkGrid(grid) {
  const { width, height, words } = grid;
  assert.ok(words.length >= MIN_WORDS && words.length <= MAX_WORDS, 'nombre de mots');
  assert.ok(width <= MAX_SIZE && height <= MAX_SIZE, 'taille');

  const classics = words.filter((w) => w.type === 'classique').length;
  assert.ok(Math.abs(classics - (words.length - classics)) <= 1, 'moitié classique, moitié argot');
  assert.strictEqual(new Set(words.map((w) => w.answer)).size, words.length, 'pas de doublon');

  const board = Array.from({ length: height }, () => Array(width).fill(null));
  for (const w of words) {
    for (let i = 0; i < w.length; i++) {
      const r = w.row + (w.direction === 'down' ? i : 0);
      const c = w.col + (w.direction === 'across' ? i : 0);
      assert.ok(r >= 0 && r < height && c >= 0 && c < width, 'dans la grille');
      if (board[r][c]) assert.strictEqual(board[r][c], w.answer[i], 'lettres croisées identiques');
      board[r][c] = w.answer[i];
    }
  }

  // Chaque suite de 2 lettres ou plus (ligne ou colonne) doit être un mot posé :
  // aucun "faux mot" créé par deux mots collés.
  const expected = new Set(words.map((w) => `${w.direction}:${w.row},${w.col}:${w.answer}`));
  const found = new Set();
  for (let r = 0; r < height; r++) {
    let c = 0;
    while (c < width) {
      if (!board[r][c]) { c++; continue; }
      let s = ''; const start = c;
      while (c < width && board[r][c]) s += board[r][c++];
      if (s.length > 1) found.add(`across:${r},${start}:${s}`);
    }
  }
  for (let c = 0; c < width; c++) {
    let r = 0;
    while (r < height) {
      if (!board[r][c]) { r++; continue; }
      let s = ''; const start = r;
      while (r < height && board[r][c]) s += board[r++][c];
      if (s.length > 1) found.add(`down:${start},${c}:${s}`);
    }
  }
  assert.deepStrictEqual([...found].sort(), [...expected].sort(), 'aucun mot parasite');

  // Tous les mots sont reliés entre eux (un seul bloc).
  const seen = new Set([0]);
  const stack = [0];
  const cellsOf = words.map((w) => new Set(Array.from({ length: w.length }, (_, i) =>
    `${w.row + (w.direction === 'down' ? i : 0)},${w.col + (w.direction === 'across' ? i : 0)}`)));
  while (stack.length) {
    const i = stack.pop();
    words.forEach((_, j) => {
      if (!seen.has(j) && [...cellsOf[i]].some((k) => cellsOf[j].has(k))) { seen.add(j); stack.push(j); }
    });
  }
  assert.strictEqual(seen.size, words.length, 'grille connexe');

  // Numéros : chaque mot a un numéro et un id unique.
  assert.strictEqual(new Set(words.map((w) => w.id)).size, words.length);
  assert.ok(words.every((w) => Number.isInteger(w.number) && w.number > 0));
}

test('grid : 80 grilles valides', () => {
  const t0 = Date.now();
  for (let i = 0; i < 80; i++) checkGrid(generateGrid());
  const perGrid = (Date.now() - t0) / 80;
  // Une grille est fabriquée une seule fois par partie : moins d'une demi-seconde suffit.
  assert.ok(perGrid < 500, `trop lent : ${perGrid} ms par grille`);
});

test('grid : les mots à éviter ne sortent pas (s\'il en reste assez)', () => {
  const WORDS = require('../data/mots.json');
  const exclude = new Set(WORDS.slice(0, 20).map((w) => w.mot));
  for (let i = 0; i < 20; i++) {
    const g = generateGrid({ exclude });
    checkGrid(g);
    assert.ok(g.words.every((w) => !exclude.has(w.answer)));
  }
});

test('grid : 12 mots bien croisés (en moyenne plus de 2 croisements par mot)', () => {
  let crossings = 0;
  let words = 0;
  for (let i = 0; i < 40; i++) {
    const g = generateGrid();
    assert.strictEqual(g.words.length, 12);
    const count = new Map();
    const cellsOf = (w) => Array.from({ length: w.length }, (_, k) =>
      `${w.row + (w.direction === 'down' ? k : 0)},${w.col + (w.direction === 'across' ? k : 0)}`);
    g.words.forEach((w) => cellsOf(w).forEach((k) => count.set(k, (count.get(k) || 0) + 1)));
    g.words.forEach((w) => { crossings += cellsOf(w).filter((k) => count.get(k) > 1).length; words++; });
  }
  assert.ok(crossings / words > 2.1, `seulement ${(crossings / words).toFixed(2)} croisements par mot`);
});
