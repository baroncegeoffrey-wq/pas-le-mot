// Deux joueurs se cherchent une partie et sont appariés avec leur pseudo.
const test = require('node:test');
const assert = require('node:assert');
const { startServer, createPlayer, waitFor } = require('./helpers');

test('matchmaking : deux joueurs sont appariés avec leur pseudo', async () => {
  const server = await startServer();
  const alice = createPlayer(server.url);
  const bob = createPlayer(server.url);
  try {
    alice.emit('find-game', { pseudo: '  Alice  ' });
    await waitFor(alice, 'waiting');

    const aliceStart = waitFor(alice, 'game-start');
    const bobStart = waitFor(bob, 'game-start');
    bob.emit('find-game', { pseudo: 'Bob' });
    const [a, b] = await Promise.all([aliceStart, bobStart]);

    assert.strictEqual(a.roomId, b.roomId);
    assert.strictEqual(a.you.pseudo, 'Alice');
    assert.strictEqual(a.opponent.pseudo, 'Bob');
    assert.strictEqual(b.opponent.pseudo, 'Alice');
    assert.notStrictEqual(a.you.slot, b.you.slot);
  } finally {
    alice.close(); bob.close(); server.stop();
  }
});

test('matchmaking : avatar choisi transmis, avatar inconnu remplacé', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  try {
    a.emit('find-game', { pseudo: 'A', avatar: 'perche' });
    await waitFor(a, 'waiting');
    const start = waitFor(a, 'game-start');
    b.emit('find-game', { pseudo: 'B', avatar: '__proto__' });
    const data = await start;
    assert.strictEqual(data.you.avatar, 'perche');
    assert.strictEqual(data.opponent.avatar, 'givre');
  } finally {
    a.close(); b.close(); server.stop();
  }
});

test('matchmaking : pseudo vide ou trop long nettoyé', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  try {
    a.emit('find-game', {});
    await waitFor(a, 'waiting');
    const start = waitFor(a, 'game-start');
    b.emit('find-game', { pseudo: 'x'.repeat(100) });
    const data = await start;
    assert.strictEqual(data.you.pseudo, 'Joueur');
    assert.strictEqual(data.opponent.pseudo.length, 16);
  } finally {
    a.close(); b.close(); server.stop();
  }
});
