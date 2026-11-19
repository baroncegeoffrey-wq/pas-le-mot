// Lot L2 : une vraie partie, du début à l'écran de fin.
const test = require('node:test');
const assert = require('node:assert');
const {
  startServer, waitFor, expectNothing, answerOfClue, pointsOf, startMatch, sleep, pick,
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
    assert.deepStrictEqual(pick(o1, ['scores', 'winner']), { scores: [pointsOf(first.clue), 0], winner: 0 });
    assert.deepStrictEqual(o2, o1);
    // Stats de fin : 1 mot trouvé pour p1, rien pour p2.
    assert.deepStrictEqual(o1.stats, [
      { found: 1, wrong: 0, bought: 0, powers: 0 },
      { found: 0, wrong: 0, bought: 0, powers: 0 },
    ]);
    // Les réponses arrivent avec la fin : tous les mots, avec qui les a trouvés.
    assert.strictEqual(o1.solutions.length, g1.clues.length);
    const firstSol = o1.solutions.find((s) => s.clue === first.clue);
    assert.strictEqual(firstSol.foundBy, 0);
    assert.strictEqual(o1.solutions.filter((s) => s.foundBy === null).length, g1.clues.length - 1);
    for (const s of o1.solutions) {
      const { normalize } = require('../game');
      assert.strictEqual(normalize(s.word), answerOfClue(s.clue));
    }
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('chrono : égalité à 0-0', async () => {
  const server = await startServer({ GAME_DURATION_MS: '500' });
  const { p1, p2 } = await startMatch(server);
  try {
    assert.deepStrictEqual(pick(await waitFor(p1, 'game-over'), ['scores', 'winner']), { scores: [0, 0], winner: null });
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
    assert.strictEqual(result.scores[1], g1.clues.reduce((sum, c) => sum + pointsOf(c.clue), 0));

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

test('adversaire déconnecté : l\'autre est prévenu et peut rejouer', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const left = waitFor(p1, 'opponent-left');
    p2.close();
    await left;
    // Son ancienne partie est fermée : ses envois ne font plus rien.
    p1.emit('submit-word', { roomId: g1.roomId, wordId: g1.clues[0].wordId, letters: answerOfClue(g1.clues[0].clue) });
    await expectNothing(p1, 'word-claimed');
    // Il peut chercher une nouvelle partie.
    p1.emit('find-game', { pseudo: 'Un' });
    await waitFor(p1, 'waiting');
  } finally {
    p1.close(); server.stop();
  }
});

test('déconnexion en file d\'attente : le joueur suivant ne tombe pas sur un fantôme', async () => {
  const server = await startServer();
  const { createPlayer } = require('./helpers');
  const ghost = createPlayer(server.url);
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  try {
    ghost.emit('find-game', { pseudo: 'Fantome' });
    await waitFor(ghost, 'waiting');
    ghost.close();
    await sleep(200);
    a.emit('find-game', { pseudo: 'A' });
    await waitFor(a, 'waiting');
    const start = waitFor(a, 'game-start');
    b.emit('find-game', { pseudo: 'B' });
    assert.strictEqual((await start).opponent.pseudo, 'B');
  } finally {
    a.close(); b.close(); server.stop();
  }
});

test('compte à rebours : rien ne compte avant le GO, puis la partie dure son temps', async () => {
  const server = await startServer({ START_DELAY_MS: '800', GAME_DURATION_MS: '60000' });
  const { p1, p2, g1 } = await startMatch(server);
  try {
    assert.ok(g1.startsAt - g1.serverNow > 600 && g1.startsAt - g1.serverNow <= 800);
    assert.strictEqual(g1.endsAt - g1.startsAt, 60000);
    const clue = g1.clues[0];
    // Avant le GO : mot ignoré, pouvoir refusé, achat ignoré.
    p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    p1.emit('buy-letter', { roomId: g1.roomId, wordId: clue.wordId });
    const refused = waitFor(p1, 'power-refused');
    p1.emit('use-power', { roomId: g1.roomId });
    assert.strictEqual((await refused).reason, 'Attends le GO !');
    await expectNothing(p1, 'word-claimed', 300);
    assert.ok(!p1.received.some((m) => m.event === 'letter-revealed'));
    // Après le GO : ça marche.
    await sleep(500);
    const ok = waitFor(p2, 'word-claimed');
    p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    assert.deepStrictEqual((await ok).scores, [pointsOf(clue.clue), 0]);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});
