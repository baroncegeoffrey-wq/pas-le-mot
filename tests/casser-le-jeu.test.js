// Tests "casser le jeu" : un client malin ou maladroit envoie n'importe quoi.
// Le serveur ne doit ni planter, ni tricher, ni lâcher une solution.
const test = require('node:test');
const assert = require('node:assert');
const {
  startServer, createPlayer, waitFor, expectNothing, answerOfClue, forbiddenKeys, startMatch, sleep,
} = require('./helpers');

const GARBAGE = [
  undefined, null, 42, 'texte', [], [1, 2], true,
  { roomId: 42 }, { roomId: null, wordId: {} }, { wordId: '__proto__', letters: 'X' },
  { letters: { toString: 'boom' } }, { letters: 'A'.repeat(100000) },
];

test('messages absurdes : le serveur ne plante pas et ne bouge pas les scores', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    for (const event of ['find-game', 'submit-word', 'buy-letter', 'use-power', 'inconnu']) {
      for (const payload of GARBAGE) p1.emit(event, payload);
    }
    for (const payload of GARBAGE) {
      p1.emit('submit-word', { roomId: g1.roomId, ...(payload && typeof payload === 'object' ? payload : {}) });
      // (une chaîne de la bonne longueur serait un vrai essai, compté -1 : on l'évite ici)
      if (typeof payload !== 'string') {
        p1.emit('submit-word', { roomId: g1.roomId, wordId: g1.clues[0].wordId, letters: payload });
      }
      p1.emit('buy-letter', { roomId: g1.roomId, wordId: payload });
    }
    await sleep(300);
    // Aucun effet : ni mot trouvé, ni erreur, ni lettre achetée.
    const effects = p1.received.filter((m) => ['word-claimed', 'word-wrong', 'letter-revealed', 'scores'].includes(m.event));
    assert.deepStrictEqual(effects, []);

    // Le serveur répond toujours : la partie continue normalement.
    const clue = g1.clues[0];
    const claimed = waitFor(p2, 'word-claimed');
    p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    assert.deepStrictEqual((await claimed).scores, [1, 0]);
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('find-game deux fois, ou en pleine partie : ignoré', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  const c = createPlayer(server.url);
  try {
    a.emit('find-game', { pseudo: 'A' });
    a.emit('find-game', { pseudo: 'A' });
    await waitFor(a, 'waiting');
    await sleep(200);
    // a ne doit pas avoir été apparié avec lui-même.
    assert.ok(!a.received.some((m) => m.event === 'game-start'));

    const start = waitFor(a, 'game-start');
    b.emit('find-game', { pseudo: 'B' });
    await start;

    // a relance find-game en pleine partie : rien ne se passe, c ne tombe pas sur lui.
    a.emit('find-game', { pseudo: 'A' });
    c.emit('find-game', { pseudo: 'C' });
    await waitFor(c, 'waiting');
    await expectNothing(c, 'game-start');
  } finally {
    a.close(); b.close(); c.close(); server.stop();
  }
});

test('jouer dans la partie des autres : impossible', async () => {
  const server = await startServer();
  const m1 = await startMatch(server);
  const m2 = await startMatch(server);
  try {
    // Un joueur de la partie 2 envoie le roomId et un mot de la partie 1.
    const clue = m1.g1.clues[0];
    m2.p1.emit('submit-word', { roomId: m1.g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    m2.p1.emit('buy-letter', { roomId: m1.g1.roomId, wordId: clue.wordId });
    await expectNothing(m1.p1, 'word-claimed');
    assert.ok(!m2.p1.received.some((m) => m.event === 'letter-revealed'));
    assert.ok(!m1.p1.received.some((m) => m.event === 'scores'));
  } finally {
    [m1.p1, m1.p2, m2.p1, m2.p2].forEach((p) => p.close());
    server.stop();
  }
});

test('pseudo piégé : renvoyé comme du texte, coupé à 16 caractères', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  try {
    a.emit('find-game', { pseudo: '<img src=x onerror=alert(1)>' });
    await waitFor(a, 'waiting');
    const start = waitFor(b, 'game-start');
    b.emit('find-game', { pseudo: 'B' });
    assert.strictEqual((await start).opponent.pseudo, '<img src=x onerr');
  } finally {
    a.close(); b.close(); server.stop();
  }
});

test('partie complète : aucune solution dans les messages, à aucun moment', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    // Une partie mouvementée : erreurs, achats, mots trouvés, fin.
    const [a, b, ...rest] = g1.clues;
    p1.emit('submit-word', { roomId: g1.roomId, wordId: a.wordId, letters: 'Q'.repeat(answerOfClue(a.clue).length) });
    p2.emit('buy-letter', { roomId: g1.roomId, wordId: b.wordId });
    p2.emit('buy-letter', { roomId: g1.roomId, wordId: b.wordId });
    await sleep(200);
    const over = waitFor(p1, 'game-over');
    for (const clue of [b, ...rest, a]) {
      p2.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    }
    await over;

    for (const player of [p1, p2]) {
      assert.deepStrictEqual(forbiddenKeys(player.received), []);
      // Avant le premier mot trouvé, aucun message ne contient une réponse entière.
      const firstClaim = player.received.findIndex((m) => m.event === 'word-claimed');
      const before = JSON.stringify(player.received.slice(0, firstClaim));
      for (const clue of g1.clues) {
        assert.ok(!before.includes(`"${answerOfClue(clue.clue)}"`), `solution trouvée : ${answerOfClue(clue.clue)}`);
      }
      // Les lettres achetées n'arrivent qu'à l'acheteur, une par une.
      for (const m of player.received.filter((x) => x.event === 'letter-revealed')) {
        assert.strictEqual(player, p2);
        assert.strictEqual(m.payload.letter.length, 1);
      }
    }
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});
