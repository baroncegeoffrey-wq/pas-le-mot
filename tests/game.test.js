// Une vraie partie à deux joueurs simulés : validation, combat (PV), verrou,
// et surtout : aucune solution ne part vers le navigateur.
const test = require('node:test');
const assert = require('node:assert');
const { Game, normalize, wordDamage } = require('../game');
const {
  startServer, createPlayer, waitFor, expectNothing, answerOfClue, damageOf, forbiddenKeys, startMatch,
} = require('./helpers');

test('normalize : sans majuscules ni accents', () => {
  assert.strictEqual(normalize('frérot'), 'FREROT');
  assert.strictEqual(normalize(' Fantôme '), 'FANTOME');
  assert.strictEqual(normalize('vénère'), 'VENERE');
});

test('Game : dégâts = lettres × 3, recul de 5 sur erreur, verrou, mot incomplet ignoré', () => {
  const game = new Game();
  const [w] = game.grid.words;
  assert.deepStrictEqual(game.hp, [100, 100]);
  assert.deepStrictEqual(game.submitWord(0, w.id, 'X'.repeat(w.length - 1)), { type: 'ignored' });
  const wrong = game.submitWord(1, w.id, 'Q'.repeat(w.length));
  assert.strictEqual(wrong.type, 'wrong');
  assert.strictEqual(wrong.damage, 5);
  assert.deepStrictEqual(game.hp, [100, 95]); // recul pour le fautif
  const ok = game.submitWord(0, w.id, w.display.split(''));
  assert.strictEqual(ok.type, 'claimed');
  const expected = w.length >= 7 ? Math.round(w.length * 4.5) : w.length * 3;
  assert.strictEqual(ok.damage, expected);
  assert.strictEqual(ok.critical, w.length >= 7);
  assert.strictEqual(ok.target, 1);
  assert.deepStrictEqual(game.hp, [100, 95 - expected]);
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
    assert.strictEqual(g1.grid.words.length, 12);
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

    // Mot faux : 5 PV de recul pour le fautif, l'adversaire voit juste les PV.
    const wrong = waitFor(p1, 'word-wrong');
    const oppHp = waitFor(p2, 'hp');
    p1.emit('submit-word', { roomId, wordId: first.wordId, letters: 'Z'.repeat(answerOfClue(first.clue).length) });
    assert.deepStrictEqual((await wrong).hp, [95, 100]);
    assert.deepStrictEqual(await oppHp, { target: 0, damage: 5, hp: [95, 100] });

    // Mot juste (en minuscules) : révélé chez les deux, dégâts au joueur 1.
    const c1 = waitFor(p1, 'word-claimed');
    const c2 = waitFor(p2, 'word-claimed');
    p2.emit('submit-word', { roomId, wordId: first.wordId, letters: answerOfClue(first.clue).toLowerCase() });
    const [r1, r2] = await Promise.all([c1, c2]);
    assert.deepStrictEqual(r1, r2);
    assert.strictEqual(r1.by, 1);
    assert.strictEqual(r1.letters, answerOfClue(first.clue));
    assert.strictEqual(r1.target, 0);
    assert.strictEqual(r1.damage, damageOf(first.clue));
    assert.deepStrictEqual(r1.hp, [95 - damageOf(first.clue), 100]);

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
    const lost = 200 - claims[0].hp[0] - claims[0].hp[1];
    // (moins le soin de celui qui a trouvé le 2e mot : lettres × 2, plafonné à 100 PV)
    assert.strictEqual(lost, 5 + damageOf(first.clue) + damageOf(second.clue) - claims[0].heal);

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

test('Game : K.O. quand les PV tombent à 0, jamais en dessous', () => {
  const game = new Game();
  let last;
  for (const w of game.grid.words) {
    last = game.submitWord(0, w.id, w.answer);
    if (last.ko) break;
  }
  assert.strictEqual(last.ko, true);
  assert.strictEqual(game.hp[1], 0);
  assert.strictEqual(game.koSlot, 1);
  const end = game.finish();
  assert.strictEqual(end.winner, 0);
  assert.strictEqual(end.ko, 1);
  // Le recul peut aussi mettre K.O. : celui qui se trompe trop perd.
  const g2 = new Game();
  const [w] = g2.grid.words;
  for (let i = 0; i < 20; i++) g2.submitWord(0, w.id, 'Q'.repeat(w.length), i * 4000);
  assert.strictEqual(g2.hp[0], 0);
  assert.strictEqual(g2.finish().winner, 1);
});

test('coup critique : × 1,5 à partir de 7 lettres, arrondi', () => {
  assert.deepStrictEqual(wordDamage(6), { critical: false, damage: 18 });
  assert.deepStrictEqual(wordDamage(7), { critical: true, damage: 32 }); // 21 × 1,5 = 31,5
  assert.deepStrictEqual(wordDamage(8), { critical: true, damage: 36 });
  assert.deepStrictEqual(wordDamage(10), { critical: true, damage: 45 });
});

test('coup critique en vrai : les deux joueurs reçoivent critical et les bons dégâts', async () => {
  const server = await startServer();
  const { p1, p2, g1 } = await startMatch(server);
  try {
    const long = g1.clues.find((c) => answerOfClue(c.clue).length >= 7);
    const short = g1.clues.find((c) => answerOfClue(c.clue).length < 7);
    for (const [clue, critical] of [[long, true], [short, false]]) {
      if (!clue) continue; // grille sans mot de cette taille : rien à vérifier
      const got = [waitFor(p1, 'word-claimed'), waitFor(p2, 'word-claimed')];
      p1.emit('submit-word', { roomId: g1.roomId, wordId: clue.wordId, letters: answerOfClue(clue.clue) });
      const [a, b] = await Promise.all(got);
      assert.deepStrictEqual(a, b);
      assert.strictEqual(a.critical, critical);
      assert.strictEqual(a.damage, damageOf(clue.clue));
    }
    assert.ok(long, 'une grille de 12 mots a au moins un mot de 7 lettres');
  } finally {
    p1.close(); p2.close(); server.stop();
  }
});

test('soin : un mot trouvé soigne celui qui l\'a trouvé (lettres × 2), jamais au-delà de 100 PV', () => {
  const game = new Game();
  const [a, b] = game.grid.words;
  // Le joueur 0 s'est fait mal (deux erreurs) : 90 PV.
  game.submitWord(0, a.id, 'Q'.repeat(a.length), 1);
  game.submitWord(0, b.id, 'Q'.repeat(b.length), 2);
  assert.deepStrictEqual(game.hp, [90, 100]);
  const r = game.submitWord(0, a.id, a.answer, 5000);
  assert.strictEqual(r.heal, Math.min(10, a.length * 2));
  assert.strictEqual(r.hp[0], Math.min(100, 90 + a.length * 2));
  assert.strictEqual(r.hp[1], 100 - r.damage);
  // Le joueur 1 se soigne à son tour, mais jamais au-delà de 100 PV.
  const r2 = game.submitWord(1, b.id, b.answer, 5000);
  assert.strictEqual(r2.heal, Math.min(r.damage, b.length * 2));
  assert.strictEqual(r2.hp[1], Math.min(100, 100 - r.damage + b.length * 2));
  // À 100 PV pile : soin nul.
  const full = new Game();
  const [w] = full.grid.words;
  assert.strictEqual(full.submitWord(0, w.id, w.answer, 1).heal, 0);
});
