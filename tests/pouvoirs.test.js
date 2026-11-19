// Lot L3 : avatars et pouvoirs, décidés par le serveur.
const test = require('node:test');
const assert = require('node:assert');
const { Game } = require('../game');
const { FREEZE, POWER_DURATION_MS } = require('../powers');
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

test('Game : 2 pouvoirs par partie, pas en solo', () => {
  const game = new Game(undefined, ['perche', 'verlan']);
  const first = game.usePower(0);
  assert.strictEqual(first.type, 'used');
  assert.strictEqual(first.power, 'trip');
  assert.strictEqual(first.target, 1);
  assert.strictEqual(first.duration, POWER_DURATION_MS);
  assert.strictEqual(game.usePower(0).remaining, 0);
  assert.strictEqual(game.usePower(0).type, 'refused');
  assert.strictEqual(game.usePower(1).power, 'verlan');

  const solo = new Game(undefined, ['givre']);
  assert.strictEqual(solo.usePower(0).type, 'refused');
});

test('Game : Freeze bloque tout, le raclage dégivre (pas avant le temps minimum)', () => {
  const game = new Game(undefined, ['givre', 'perche']);
  const t0 = 5000000;
  const r = game.usePower(0, t0);
  assert.deepStrictEqual(r.payload, { layers: FREEZE.layers });
  assert.strictEqual(r.duration, FREEZE.maxMs);
  const [w] = game.grid.words;

  // Gelé : il ne peut ni valider, ni acheter, ni lancer son pouvoir.
  assert.deepStrictEqual(game.submitWord(1, w.id, w.answer, t0 + 10), { type: 'ignored' });
  assert.deepStrictEqual(game.buyLetter(1, w.id), { type: 'ignored' });
  assert.strictEqual(game.usePower(1, t0 + 10).type, 'refused');
  // On ne gèle pas deux fois, et le pouvoir n'est pas consommé.
  assert.strictEqual(game.usePower(0, t0 + 10).type, 'refused');
  assert.strictEqual(game.powersLeft[0], 1);

  // Coups trop rapprochés : ignorés.
  assert.strictEqual(game.scrape(1, t0 + 100).layers, FREEZE.layers - 1);
  assert.strictEqual(game.scrape(1, t0 + 120).type, 'ignored');
  // Raclage très rapide : avant le temps minimum, il reste au moins une couche.
  let t = t0 + 100;
  while (t + FREEZE.minScrapeGapMs < t0 + FREEZE.minMs) { t += FREEZE.minScrapeGapMs; game.scrape(1, t); }
  assert.ok(game.frozen[1].layers >= 1);
  // Ensuite, il faut racler toutes les couches restantes.
  let result;
  while (game.frozen[1]) { t += 100; result = game.scrape(1, t); }
  assert.deepStrictEqual(result, { type: 'thawed' });
  assert.strictEqual(game.submitWord(1, w.id, w.answer, t + 100).type, 'claimed');
  assert.strictEqual(game.scrape(1, t + 200).type, 'ignored');
});

test('Game : le givre repousse s\'il arrête de racler', () => {
  const game = new Game(undefined, ['givre', 'verlan']);
  const t0 = 1000000;
  const R = FREEZE.regrowMs;
  game.usePower(0, t0);
  game.scrape(1, t0 + 100);
  game.scrape(1, t0 + 200);
  assert.strictEqual(game.frozen[1].layers, FREEZE.layers - 2);
  assert.strictEqual(game.regrow(1, t0 + 200 + R - 1), null); // il vient de racler
  assert.strictEqual(game.regrow(1, t0 + 200 + R), FREEZE.layers - 1);
  assert.strictEqual(game.regrow(1, t0 + 200 + R + R / 2), null);
  assert.strictEqual(game.regrow(1, t0 + 200 + 2 * R), FREEZE.layers);
  assert.strictEqual(game.regrow(1, t0 + 200 + 10 * R), null); // jamais plus que le départ
  assert.strictEqual(game.thaw(1), true);
  assert.strictEqual(game.frozen[1], null);
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
    assert.deepStrictEqual(await hit, { power: 'verlan', duration: POWER_DURATION_MS, payload: {}, from: 'Un' });
    assert.deepStrictEqual(await used, { power: 'verlan', remaining: 1 });

    p1.emit('use-power', { roomId: g1.roomId });
    await waitFor(p1, 'power-used');
    const refused = waitFor(p1, 'power-refused');
    p1.emit('use-power', { roomId: g1.roomId });
    assert.ok((await refused).reason);
    await expectNothing(p2, 'power-hit');
    assert.strictEqual(p1.received.filter((m) => m.event === 'power-hit').length, 0);
    assert.strictEqual(p2.received.filter((m) => m.event === 'power-hit').length, 2);

    // Le Givré gèle l'adversaire : il ne peut plus rien valider.
    const frozenHit = waitFor(p1, 'power-hit');
    p2.emit('use-power', { roomId: g2.roomId });
    const { payload } = await frozenHit;
    assert.deepStrictEqual(payload, { layers: FREEZE.layers });
    const clue = g1.clues[0];
    p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    await expectNothing(p1, 'word-claimed');

    // Il racle : une couche de moins à chaque coup, puis dégivré (chez les deux).
    p1.emit('scrape', { roomId: g1.roomId });
    assert.strictEqual((await waitFor(p1, 'frost')).layers, FREEZE.layers - 1);
    await sleep(FREEZE.minMs);
    const thaw1 = waitFor(p1, 'unfrozen', 10000);
    const thaw2 = waitFor(p2, 'unfrozen', 10000);
    for (let i = 0; i < FREEZE.layers + 2; i++) {
      p1.emit('scrape', { roomId: g1.roomId });
      await sleep(100);
    }
    assert.deepStrictEqual(await thaw1, { slot: 0 });
    assert.deepStrictEqual(await thaw2, { slot: 0 });
    const claimed = waitFor(p1, 'word-claimed');
    p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
    await claimed;

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


test('en vrai : dégivrage automatique au bout du temps maximum', async () => {
  const server = await startServer({ FREEZE_MAX_MS: '800' });
  const { p1, p2, g2 } = await matchWith(server, 'perche', 'givre');
  try {
    const hit = waitFor(p1, 'power-hit');
    p2.emit('use-power', { roomId: g2.roomId });
    assert.strictEqual((await hit).duration, 800);
    // Il ne racle pas du tout : il est quand même libéré.
    const [t1, t2] = await Promise.all([waitFor(p1, 'unfrozen'), waitFor(p2, 'unfrozen')]);
    assert.deepStrictEqual(t1, { slot: 0 });
    assert.deepStrictEqual(t2, { slot: 0 });
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});
