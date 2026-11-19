// Une vraie partie à deux joueurs simulés : validation, scores, verrou,
// et surtout : aucune solution ne part vers le navigateur.
const test = require('node:test');
const assert = require('node:assert');
const WORDS = require('../data/mots.json');
const { Game, normalize } = require('../game');
const { startServer, createPlayer, waitFor, expectNothing } = require('./helpers');

// Le test retrouve les réponses à partir des définitions, comme le ferait un
// humain avec la bibliothèque. Le serveur, lui, ne les envoie jamais.
const answerOfClue = (clue) => WORDS.find((w) => w.definition === clue).mot;

// Cherche récursivement des clés interdites dans un message.
function forbiddenKeys(value, found = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (['answer', 'display', 'type', 'mot', 'affichage'].includes(k)) found.push(k);
      forbiddenKeys(v, found);
    }
  }
  return found;
}

async function startMatch(server) {
  const p1 = createPlayer(server.url);
  const p2 = createPlayer(server.url);
  p1.emit('find-game', { pseudo: 'Un' });
  await waitFor(p1, 'waiting');
  const s1 = waitFor(p1, 'game-start');
  const s2 = waitFor(p2, 'game-start');
  p2.emit('find-game', { pseudo: 'Deux' });
  const [g1, g2] = await Promise.all([s1, s2]);
  return { p1, p2, g1, g2 };
}

test('normalize : sans majuscules ni accents', () => {
  assert.strictEqual(normalize('frérot'), 'FREROT');
  assert.strictEqual(normalize(' Fantôme '), 'FANTOME');
  assert.strictEqual(normalize('vénère'), 'VENERE');
});

test('Game : +1, -1, verrou, mot incomplet ignoré', () => {
  const game = new Game();
  const [w] = game.grid.words;
  assert.deepStrictEqual(game.submitWord(0, w.id, 'X'.repeat(w.length - 1)), { type: 'ignored' });
  assert.strictEqual(game.submitWord(1, w.id, 'Q'.repeat(w.length)).type, 'wrong');
  assert.deepStrictEqual(game.scores, [0, -1]);
  const ok = game.submitWord(0, w.id, w.display.split(''));
  assert.strictEqual(ok.type, 'claimed');
  assert.deepStrictEqual(game.scores, [1, -1]);
  // Verrouillé : plus personne ne peut le jouer, même juste.
  assert.deepStrictEqual(game.submitWord(1, w.id, w.answer), { type: 'ignored' });
  assert.deepStrictEqual(game.submitWord(0, 'w999', 'ABC'), { type: 'ignored' });
  assert.deepStrictEqual(game.submitWord(0, w.id, { evil: true }), { type: 'ignored' });
});

test('partie : même grille pour les deux, sans aucune solution', async () => {
  const server = await startServer();
  const { p1, p2, g1, g2 } = await startMatch(server);
  try {
    assert.deepStrictEqual(g1.grid, g2.grid);
    assert.deepStrictEqual(g1.clues, g2.clues);
    assert.ok(g1.grid.words.length >= 8 && g1.grid.words.length <= 10);
    assert.deepStrictEqual(forbiddenKeys(g1), []);

    const json = JSON.stringify(g1);
    for (const clue of g1.clues) {
      const answer = answerOfClue(clue.clue);
      assert.ok(!json.includes(answer), `la solution ${answer} est dans game-start`);
    }
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('partie : mot juste, mot faux, verrou et premier arrivé gagne', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const roomId = g1.roomId;
    const [first, second, third] = g1.clues;

    // Mot faux : -1 pour le fautif seulement, l'adversaire voit juste le score.
    const wrong = waitFor(p1, 'word-wrong');
    const oppScores = waitFor(p2, 'scores');
    p1.emit('submit-word', { roomId, wordId: first.wordId, letters: 'Z'.repeat(answerOfClue(first.clue).length) });
    assert.deepStrictEqual((await wrong).scores, [-1, 0]);
    assert.deepStrictEqual((await oppScores).scores, [-1, 0]);

    // Mot juste (en minuscules) : révélé chez les deux, +1 pour le joueur 2.
    const c1 = waitFor(p1, 'word-claimed');
    const c2 = waitFor(p2, 'word-claimed');
    p2.emit('submit-word', { roomId, wordId: first.wordId, letters: answerOfClue(first.clue).toLowerCase() });
    const [r1, r2] = await Promise.all([c1, c2]);
    assert.deepStrictEqual(r1, r2);
    assert.strictEqual(r1.by, 1);
    assert.strictEqual(r1.letters, answerOfClue(first.clue));
    assert.deepStrictEqual(r1.scores, [-1, 1]);

    // Mot verrouillé : le rejouer ne fait rien.
    p1.emit('submit-word', { roomId, wordId: first.wordId, letters: answerOfClue(first.clue) });
    await expectNothing(p1, 'word-claimed');

    // Mauvais salon ou salon absent : ignoré.
    p1.emit('submit-word', { roomId: 'faux', wordId: second.wordId, letters: answerOfClue(second.clue) });
    p1.emit('submit-word', { wordId: second.wordId, letters: answerOfClue(second.clue) });
    p1.emit('submit-word', null);
    await expectNothing(p1, 'word-claimed');

    // Les deux valident le même mot en même temps : un seul gagne.
    const claims = [];
    p1.on('word-claimed', (d) => claims.push(d));
    const answer = answerOfClue(second.clue);
    p1.emit('submit-word', { roomId, wordId: second.wordId, letters: answer });
    p2.emit('submit-word', { roomId, wordId: second.wordId, letters: answer });
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(claims.length, 1);
    const total = claims[0].scores[0] + claims[0].scores[1];
    assert.strictEqual(total, 1); // -1 + 1 + 1

    // Un intrus hors partie ne peut rien valider.
    const intruder = createPlayer(server.url);
    intruder.emit('submit-word', { roomId, wordId: third.wordId, letters: answerOfClue(third.clue) });
    await expectNothing(p1, 'word-claimed');
    intruder.close();

    // Aucun message reçu ne contient de clé de solution, et chaque mot
    // révélé ne l'a été qu'après avoir été trouvé.
    for (const player of [p1, p2]) {
      assert.deepStrictEqual(forbiddenKeys(player.received), []);
      const revealed = player.received.filter((m) => m.event === 'word-claimed').map((m) => m.payload.wordId);
      assert.deepStrictEqual([...new Set(revealed)].sort(), [first.wordId, second.wordId].sort());
    }
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});
