// Salons privés avec un code, et annulation de la recherche.
const test = require('node:test');
const assert = require('node:assert');
const {
  startServer, createPlayer, waitFor, expectNothing,
} = require('./helpers');

test('salon privé : l\'ami rejoint avec le code, les autres ne tombent pas dessus', async () => {
  const server = await startServer();
  const host = createPlayer(server.url);
  const friend = createPlayer(server.url);
  const stranger = createPlayer(server.url);
  try {
    host.emit('create-room', { pseudo: 'Hote', avatar: 'givre' });
    const { code } = await waitFor(host, 'room-created');
    assert.match(code, /^[A-HJ-NP-Z]{4}$/);

    // Un inconnu en file publique n'est pas apparié avec l'hôte.
    stranger.emit('find-game', { pseudo: 'Inconnu' });
    await waitFor(stranger, 'waiting');
    await expectNothing(host, 'game-start');

    // Code faux : erreur claire.
    friend.emit('join-room', { code: 'ZZZZ', pseudo: 'Ami' });
    assert.ok((await waitFor(friend, 'room-error')).reason);

    // Bon code (en minuscules, avec espaces) : la partie démarre pour les deux.
    const s1 = waitFor(host, 'game-start');
    const s2 = waitFor(friend, 'game-start');
    friend.emit('join-room', { code: ` ${code.toLowerCase()} `, pseudo: 'Ami', avatar: 'verlan' });
    const [g1, g2] = await Promise.all([s1, s2]);
    assert.strictEqual(g1.roomId, g2.roomId);
    assert.strictEqual(g1.opponent.pseudo, 'Ami');
    assert.strictEqual(g2.opponent.avatar, 'givre');

    // Le code ne sert qu'une fois.
    const third = createPlayer(server.url);
    third.emit('join-room', { code, pseudo: 'Trop tard' });
    await waitFor(third, 'room-error');
    third.close();
  } finally {
    host.close(); friend.close(); stranger.close(); server.stop();
  }
});

test('annuler : le joueur sort de la file et du salon privé', async () => {
  const server = await startServer();
  const a = createPlayer(server.url);
  const b = createPlayer(server.url);
  const c = createPlayer(server.url);
  try {
    a.emit('find-game', { pseudo: 'A' });
    await waitFor(a, 'waiting');
    a.emit('cancel-search');
    await waitFor(a, 'search-cancelled');
    b.emit('find-game', { pseudo: 'B' });
    await waitFor(b, 'waiting'); // b attend : a n'est plus dans la file
    await expectNothing(a, 'game-start');

    a.emit('create-room', { pseudo: 'A' });
    const { code } = await waitFor(a, 'room-created');
    a.emit('cancel-search');
    await waitFor(a, 'search-cancelled');
    c.emit('join-room', { code, pseudo: 'C' });
    await waitFor(c, 'room-error');
  } finally {
    a.close(); b.close(); c.close(); server.stop();
  }
});

test('salon privé fermé si l\'hôte se déconnecte', async () => {
  const server = await startServer();
  const host = createPlayer(server.url);
  const friend = createPlayer(server.url);
  try {
    host.emit('create-room', { pseudo: 'Hote' });
    const { code } = await waitFor(host, 'room-created');
    host.close();
    await new Promise((r) => setTimeout(r, 200));
    friend.emit('join-room', { code, pseudo: 'Ami' });
    await waitFor(friend, 'room-error');
  } finally {
    friend.close(); server.stop();
  }
});
