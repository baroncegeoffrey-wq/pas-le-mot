// Lot L2 : une vraie partie, du début à l'écran de fin.
const test = require('node:test');
const assert = require('node:assert');
const {
  startServer, waitFor, expectNothing, answerOfClue, startMatch, sleep,
} = require('./helpers');
const { Game } = require('../game');

test('chrono : game-start annonce la fin, game-over arrive au bout du temps', async () => {
  const server = await startServer({ GAME_DURATION_MS: '1200' });
  const { p1, p2, g1 } = await startMatch(server);
  try {
    assert.ok(Math.abs(g1.endsAt - g1.serverNow - 1200) < 100);
    // p1 trouve un mot : il doit gagner 1 à 0.
    const first = g1.clues[0];
    p1.emit('submit-word', { roomId: g1.roomId, wordId: first.wordId, letters: answerOfClue(first.clue) });
    const [o1, o2] = await Promise.all([waitFor(p1, 'game-over', 3000), waitFor(p2, 'game-over', 3000)]);
    assert.deepStrictEqual(o1, { scores: [1, 0], winner: 0 });
    assert.deepStrictEqual(o2, o1);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('chrono : égalité à 0-0', async () => {
  const server = await startServer({ GAME_DURATION_MS: '500' });
  const { p1, p2 } = await startMatch(server);
  try {
    assert.deepStrictEqual(await waitFor(p1, 'game-over'), { scores: [0, 0], winner: null });
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('grille pleine : la partie s\'arrête tout de suite, puis on peut rejouer', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const over = waitFor(p2, 'game-over');
    for (const clue of g1.clues) {
      p2.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    }
    const result = await over;
    assert.strictEqual(result.winner, 1);
    assert.strictEqual(result.scores[1], g1.clues.length);

    // Plus rien ne compte après la fin.
    p1.emit('submit-word', { roomId: g1.roomId, wordId: g1.clues[0].wordId, letters: 'X' });

    // Rejouer : les deux relancent find-game et retombent ensemble.
    p1.emit('find-game', { pseudo: 'Un' });
    await waitFor(p1, 'waiting');
    const again = waitFor(p1, 'game-start');
    p2.emit('find-game', { pseudo: 'Deux' });
    const g = await again;
    assert.notStrictEqual(g.roomId, g1.roomId);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('anti-spam : mot bloqué 3 s après une erreur, pour le fautif seulement', async () => {
  const game = new Game();
  const [w] = game.grid.words;
  const wrongLetters = 'Q'.repeat(w.length);
  const t0 = 1000000;
  assert.strictEqual(game.submitWord(0, w.id, wrongLetters, t0).type, 'wrong');
  // Pendant 3 s : bloqué, et pas de nouvelle pénalité.
  assert.strictEqual(game.submitWord(0, w.id, w.answer, t0 + 2999).type, 'locked');
  assert.strictEqual(game.submitWord(0, w.id, wrongLetters, t0 + 1000).type, 'locked');
  assert.deepStrictEqual(game.scores, [-1, 0]);
  // L'adversaire, lui, n'est pas bloqué.
  assert.strictEqual(game.submitWord(1, w.id, wrongLetters, t0 + 10).type, 'wrong');
  // Après 3 s, le fautif peut rejouer.
  assert.strictEqual(game.submitWord(0, w.id, w.answer, t0 + 3000).type, 'claimed');
});

test('anti-spam : en vrai, 20 mauvais envois d\'affilée ne coûtent que -1', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const clue = g1.clues[0];
    const bad = 'Q'.repeat(answerOfClue(clue.clue).length);
    const wrong = waitFor(p1, 'word-wrong');
    for (let i = 0; i < 20; i++) p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: bad });
    const w = await wrong;
    assert.ok(w.lockedUntil - w.serverNow > 2900 && w.lockedUntil - w.serverNow <= 3000);
    await sleep(300);
    const wrongs = p1.received.filter((m) => m.event === 'word-wrong');
    const locks = p1.received.filter((m) => m.event === 'word-locked');
    assert.strictEqual(wrongs.length, 1);
    assert.strictEqual(locks.length, 19);
    assert.deepStrictEqual(wrongs[0].payload.scores, [-1, 0]);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('acheter une lettre : -1, révélée à l\'acheteur seul, jamais deux fois la même', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const clue = g1.clues[0];
    const answer = answerOfClue(clue.clue);
    const seen = new Set();
    for (let i = 0; i < answer.length; i++) {
      const got = waitFor(p1, 'letter-revealed');
      const opp = waitFor(p2, 'scores');
      p1.emit('buy-letter', { roomId: g1.roomId, wordId: clue.wordId });
      const r = await got;
      assert.strictEqual(r.letter, answer[r.index]);
      assert.ok(!seen.has(r.index), 'même lettre vendue deux fois');
      seen.add(r.index);
      assert.deepStrictEqual(r.scores, [-(i + 1), 0]);
      assert.deepStrictEqual((await opp).scores, [-(i + 1), 0]);
    }
    // Toutes les lettres connues : plus rien à acheter, pas de pénalité.
    p1.emit('buy-letter', { roomId: g1.roomId, wordId: clue.wordId });
    await expectNothing(p1, 'letter-revealed');
    assert.ok(!p2.received.some((m) => m.event === 'letter-revealed'));

    // Mot déjà trouvé : impossible d'acheter.
    const other = g1.clues[1];
    const claimed = waitFor(p2, 'word-claimed');
    p2.emit('submit-word', { roomId: g1.roomId, wordId: other.wordId, letters: answerOfClue(other.clue) });
    await claimed;
    p1.emit('buy-letter', { roomId: g1.roomId, wordId: other.wordId });
    await expectNothing(p1, 'letter-revealed');
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});
