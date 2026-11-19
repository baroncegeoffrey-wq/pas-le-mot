// Lot L2 : une vraie partie, du début à l'écran de fin.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitFor, answerOfClue, startMatch } = require('./helpers');

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
