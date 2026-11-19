// Mode solo : un seul joueur, mêmes règles, pas d'adversaire.
const test = require('node:test');
const assert = require('node:assert');
const {
  startServer, createPlayer, waitFor, expectNothing, answerOfClue, forbiddenKeys, startMatch, sleep,
} = require('./helpers');

async function startSolo(server, pseudo = 'Solo') {
  const p = createPlayer(server.url);
  const start = waitFor(p, 'game-start');
  p.emit('play-solo', { pseudo });
  return { p, g: await start };
}

test('solo : la partie démarre tout de suite, sans adversaire ni solution', async () => {
  const server = await startServer();
  const { p, g } = await startSolo(server);
  try {
    assert.strictEqual(g.opponent, null);
    assert.strictEqual(g.you.pseudo, 'Solo');
    assert.ok(g.grid.words.length >= 8);
    assert.deepStrictEqual(forbiddenKeys(g), []);
    const json = JSON.stringify(g);
    for (const clue of g.clues) assert.ok(!json.includes(answerOfClue(clue.clue)));
  } finally {
    p.close(); server.stop();
  }
});

test('solo : mêmes règles (+1, -1, blocage, achat), fin quand la grille est pleine', async () => {
  const server = await startServer();
  const { p, g } = await startSolo(server);
  try {
    const [a, b, ...rest] = g.clues;
    const wrong = waitFor(p, 'word-wrong');
    p.emit('submit-word', { roomId: g.roomId, wordId: a.wordId, letters: 'Q'.repeat(answerOfClue(a.clue).length) });
    assert.strictEqual((await wrong).scores[0], -1);

    p.emit('submit-word', { roomId: g.roomId, wordId: a.wordId, letters: answerOfClue(a.clue) });
    await waitFor(p, 'word-locked');

    const bought = waitFor(p, 'letter-revealed');
    p.emit('buy-letter', { roomId: g.roomId, wordId: b.wordId });
    assert.strictEqual((await bought).scores[0], -2);

    for (const clue of [b, ...rest]) {
      p.emit('submit-word', { roomId: g.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    }
    await sleep(3100); // fin du blocage du premier mot
    const over = waitFor(p, 'game-over');
    p.emit('submit-word', { roomId: g.roomId, wordId: a.wordId, letters: answerOfClue(a.clue) });
    const result = await over;
    assert.deepStrictEqual(result, {
      scores: [g.clues.length - 2], winner: null, found: g.clues.length, total: g.clues.length,
    });
  } finally {
    p.close(); server.stop();
  }
});

test('solo : fin au chrono avec le nombre de mots trouvés', async () => {
  const server = await startServer({ GAME_DURATION_MS: '800' });
  const { p, g } = await startSolo(server);
  try {
    const clue = g.clues[0];
    p.emit('submit-word', { roomId: g.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    assert.deepStrictEqual(await waitFor(p, 'game-over'), {
      scores: [1], winner: null, found: 1, total: g.clues.length,
    });
  } finally {
    p.close(); server.stop();
  }
});

test('solo : quitte la file d\'attente, et ignoré en pleine partie', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  try {
    // a attendait un adversaire puis lance un solo : b ne doit pas tomber sur lui.
    a.emit('find-game', { pseudo: 'A' });
    await waitFor(a, 'waiting');
    const soloStart = waitFor(a, 'game-start');
    a.emit('play-solo', { pseudo: 'A' });
    await soloStart;
    b.emit('find-game', { pseudo: 'B' });
    await waitFor(b, 'waiting');
    await expectNothing(b, 'game-start');

    // Relancer un solo en pleine partie ne fait rien.
    a.emit('play-solo', { pseudo: 'A' });
    await expectNothing(a, 'game-start');
  } finally {
    a.close(); b.close(); server.stop();
  }
});

test('solo : en duo, rien ne change (toujours un gagnant)', async () => {
  const server = await startServer({ GAME_DURATION_MS: '500' });
  const { p1, p2 } = await startMatch(server);
  try {
    assert.deepStrictEqual(await waitFor(p1, 'game-over'), { scores: [0, 0], winner: null });
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('mots variés : deux parties de suite avec le même pseudo n\'ont aucun mot en commun', async () => {
  const server = await startServer({ GAME_DURATION_MS: '400' });
  try {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      const { p, g } = await startSolo(server, 'Fidele');
      seen.push(new Set(g.clues.map((c) => answerOfClue(c.clue))));
      await waitFor(p, 'game-over');
      p.close();
    }
    for (let i = 1; i < seen.length; i++) {
      const common = [...seen[i]].filter((m) => seen[i - 1].has(m));
      assert.deepStrictEqual(common, [], `partie ${i + 1} : mots déjà vus ${common}`);
    }
  } finally {
    server.stop();
  }
});
