// Lot L3 : avatars et pouvoirs, décidés par le serveur.
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../game');
const {
  startServer, createPlayer, waitFor, expectNothing, answerOfClue, forbiddenKeys, sleep,
} = require('./helpers');

async function matchWith(server, avatar1, avatar2) {
  const p1 = createPlayer(server.url);
  const p2 = createPlayer(server.url);
  p1.emit('find-game', { pseudo: 'Un', avatar: avatar1 });
  await waitFor(p1, 'waiting');
  const s1 = waitFor(p1, 'game-start');
  const s2 = waitFor(p2, 'game-start');
  p2.emit('find-game', { pseudo: 'Deux', avatar: avatar2 });
  const [g1, g2] = await Promise.all([s1, s2]);
  return { p1, p2, g1, g2 };
}

// Cases d'un mot, au format "ligne,colonne".
const cellsOf = (w) => Array.from({ length: w.length }, (_, i) =>
  `${w.row + (w.direction === 'down' ? i : 0)},${w.col + (w.direction === 'across' ? i : 0)}`);

test('Game : 2 pouvoirs par partie, pas en solo', () => {
  const game = new Game(undefined, ['perche', 'verlan']);
  const first = game.usePower(0);
  assert.strictEqual(first.type, 'used');
  assert.strictEqual(first.power, 'trip');
  assert.strictEqual(first.target, 1);
  assert.strictEqual(first.duration, 10000);
  assert.strictEqual(game.usePower(0).remaining, 0);
  assert.strictEqual(game.usePower(0).type, 'refused');
  assert.strictEqual(game.usePower(1).power, 'verlan');

  const solo = new Game(undefined, ['givre']);
  assert.strictEqual(solo.usePower(0).type, 'refused');
});

test('Game : Freeze gèle 3 cases libres et bloque la validation pendant 10 s', () => {
  const game = new Game(undefined, ['givre', 'perche']);
  const t0 = 5000000;
  const r = game.usePower(0, t0);
  assert.strictEqual(r.payload.cells.length, 3);
  const frozen = new Set(r.payload.cells.map(({ row, col }) => `${row},${col}`));
  const hit = game.grid.words.find((w) => cellsOf(w).some((k) => frozen.has(k)));
  const free = game.grid.words.find((w) => !cellsOf(w).some((k) => frozen.has(k)));

  // La cible (joueur 1) ne peut pas valider un mot gelé, sans pénalité.
  assert.deepStrictEqual(game.submitWord(1, hit.id, hit.answer, t0 + 9999), {
    type: 'locked', wordId: hit.id, lockedUntil: t0 + 10000, reason: 'freeze',
  });
  assert.deepStrictEqual(game.scores, [0, 0]);
  // Les mots sans case gelée restent jouables.
  if (free) assert.strictEqual(game.submitWord(1, free.id, free.answer, t0).type, 'claimed');
  // Après 10 s, c'est dégelé.
  assert.strictEqual(game.submitWord(1, hit.id, hit.answer, t0 + 10000).type, 'claimed');
});

test('Game : Freeze ne gèle jamais une case déjà trouvée', () => {
  const game = new Game(undefined, ['givre', 'givre']);
  const words = game.grid.words;
  // On trouve tous les mots sauf le dernier : seules ses cases libres restent.
  words.slice(0, -1).forEach((w) => game.submitWord(1, w.id, w.answer));
  const last = words[words.length - 1];
  const known = new Set(words.slice(0, -1).flatMap(cellsOf));
  const r = game.usePower(0);
  for (const { row, col } of r.payload.cells) {
    assert.ok(cellsOf(last).includes(`${row},${col}`));
    assert.ok(!known.has(`${row},${col}`));
  }
});

test('en vrai : le pouvoir touche la cible seule, 3e utilisation refusée', async () => {
  const server = await startServer();
  const { p1, p2, g1, g2 } = await matchWith(server, 'verlan', 'givre');
  try {
    assert.strictEqual(g1.you.avatar, 'verlan');
    assert.strictEqual(g1.opponent.avatar, 'givre');
    assert.strictEqual(g1.you.powersLeft, 2);

    const hit = waitFor(p2, 'power-hit');
    const used = waitFor(p1, 'power-used');
    p1.emit('use-power', { roomId: g1.roomId });
    assert.deepStrictEqual(await hit, { power: 'verlan', duration: 10000, payload: {}, from: 'Un' });
    assert.deepStrictEqual(await used, { power: 'verlan', remaining: 1 });

    p1.emit('use-power', { roomId: g1.roomId });
    await waitFor(p1, 'power-used');
    const refused = waitFor(p1, 'power-refused');
    p1.emit('use-power', { roomId: g1.roomId });
    assert.ok((await refused).reason);
    await expectNothing(p2, 'power-hit');
    assert.strictEqual(p1.received.filter((m) => m.event === 'power-hit').length, 0);
    assert.strictEqual(p2.received.filter((m) => m.event === 'power-hit').length, 2);

    // Le Givré gèle des cases ; la cible ne peut pas valider un mot gelé.
    const frozenHit = waitFor(p1, 'power-hit');
    p2.emit('use-power', { roomId: g2.roomId });
    const { payload } = await frozenHit;
    assert.strictEqual(payload.cells.length, 3);
    const frozen = new Set(payload.cells.map(({ row, col }) => `${row},${col}`));
    const word = g1.grid.words.find((w) => cellsOf(w).some((k) => frozen.has(k)));
    const clue = g1.clues.find((c) => c.wordId === word.id);
    const locked = waitFor(p1, 'word-locked');
    p1.emit('submit-word', { roomId: g1.roomId, wordId: word.id, letters: answerOfClue(clue.clue) });
    assert.strictEqual((await locked).reason, 'freeze');

    for (const p of [p1, p2]) assert.deepStrictEqual(forbiddenKeys(p.received), []);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('en vrai : pas de pouvoir en solo, ni hors partie, ni avec un faux roomId', async () => {
  const server = await startServer();
  const solo = createPlayer(server.url);
  const intruder = createPlayer(server.url);
  try {
    const start = waitFor(solo, 'game-start');
    solo.emit('play-solo', { pseudo: 'S', avatar: 'perche' });
    const g = await start;
    assert.strictEqual(g.you.powersLeft, 0);
    const refused = waitFor(solo, 'power-refused');
    solo.emit('use-power', { roomId: g.roomId });
    await refused;

    intruder.emit('use-power', { roomId: g.roomId });
    intruder.emit('use-power', null);
    await sleep(200);
    assert.deepStrictEqual(intruder.received, []);
  } finally {
    solo.close(); intruder.close(); server.stop();
  }
});
