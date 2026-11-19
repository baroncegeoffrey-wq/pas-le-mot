// Point d'entrée du jeu : Express sert la page, Socket.io gère le temps réel.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
  addToQueue, createSoloRoom, handleDisconnect, getRoomOf, endGame,
} = require('./matchmaking');
const { Game } = require('./game');
const { generateGrid } = require('./grid');
const { FREEZE } = require('./powers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// Durée d'une partie : 2 minutes (réglable pour les tests automatiques).
const GAME_DURATION_MS = Number(process.env.GAME_DURATION_MS) || 2 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

// Petit signal envoyé par la page toutes les 4 minutes : sur l'offre gratuite,
// Render éteint le serveur après 15 minutes sans visite, même en pleine partie.
app.get('/ping', (req, res) => res.type('text').send('ok'));

// Filet de sécurité : une erreur dans un événement ne doit jamais faire tomber
// le serveur (sinon toutes les parties en cours sont perdues). On la note dans
// les logs (visibles sur Render) et on continue.
function safe(name, fn) {
  return (...args) => {
    try {
      fn(...args);
    } catch (err) {
      console.error(`Erreur dans ${name} :`, err);
    }
  };
}
process.on('uncaughtException', (err) => console.error('Erreur inattendue :', err));
process.on('unhandledRejection', (err) => console.error('Promesse rejetée :', err));

// Mots vus récemment par chaque pseudo, pour ne pas retomber sur les mêmes.
const RECENT_WORDS_PER_PLAYER = 24;
const MAX_REMEMBERED_PLAYERS = 1000;
const recentWords = new Map(); // pseudo en minuscules -> [mots]

function rememberWords(pseudo, words) {
  const k = pseudo.toLowerCase();
  const list = (recentWords.get(k) || []).concat(words).slice(-RECENT_WORDS_PER_PLAYER);
  recentWords.delete(k); // le remettre en dernier = le plus récent
  recentWords.set(k, list);
  if (recentWords.size > MAX_REMEMBERED_PLAYERS) recentWords.delete(recentWords.keys().next().value);
}

// Deux joueurs viennent d'être appariés (ou un joueur lance une partie solo) :
// on crée la grille et on envoie à chacun la version publique (sans les solutions).
function startGame(roomId, room) {
  // Les mots que ces joueurs ont vus récemment sont évités.
  const exclude = new Set(room.players.flatMap((p) => recentWords.get(p.pseudo.toLowerCase()) || []));
  const fullGrid = generateGrid({ exclude });
  room.players.forEach((p) => rememberWords(p.pseudo, fullGrid.words.map((w) => w.answer)));
  room.game = new Game(fullGrid, room.players.map((p) => p.avatar));
  // Minuteries du Freeze, par joueur gelé : { regrow, safety }
  room.freezeTimers = [null, null];
  room.onClose = () => room.freezeTimers.forEach((_, slot) => clearFreezeTimers(room, slot));
  const { grid, clues } = room.game.getPublicGrid();
  const endsAt = Date.now() + GAME_DURATION_MS;
  room.timer = setTimeout(safe('fin du chrono', () => finishGame(roomId, room)), GAME_DURATION_MS);

  room.players.forEach((player, index) => {
    const opponent = room.players[1 - index];
    io.to(player.id).emit('game-start', {
      roomId,
      grid,
      clues,
      you: {
        pseudo: player.pseudo,
        slot: index,
        avatar: player.avatar,
        powersLeft: room.solo ? 0 : room.game.powersLeft[index],
      },
      // En solo, pas d'adversaire.
      opponent: opponent ? { pseudo: opponent.pseudo, slot: 1 - index, avatar: opponent.avatar } : null,
      endsAt,
      // L'heure du serveur, pour que le client corrige un écart d'horloge.
      serverNow: Date.now(),
    });
  });
}

// Fin de partie : chrono à zéro ou grille pleine. On envoie le résultat puis
// on ferme le salon (le chrono est arrêté dans endGame).
function finishGame(roomId, room) {
  if (room.game.over) return;
  const { scores, winner } = room.game.finish();
  if (room.solo) {
    // En solo : pas de gagnant, juste ton score et le nombre de mots trouvés.
    io.to(roomId).emit('game-over', {
      scores: [scores[0]],
      winner: null,
      found: room.game.claimedBy.size,
      total: room.game.grid.words.length,
    });
  } else {
    io.to(roomId).emit('game-over', { scores, winner });
  }
  endGame(roomId, io);
}

// Retrouve la partie du joueur. Le salon vient du serveur (playerRooms), jamais
// du client : on ne peut pas jouer dans une partie dont on ne fait pas partie.
function findPlayerGame(socket, clientRoomId) {
  const found = getRoomOf(socket.id);
  if (!found || !found.room.game) return null;
  // Un roomId différent signale un client désynchronisé (ancienne partie).
  if (clientRoomId !== found.roomId) return null;
  const slot = found.room.players.findIndex((p) => p.id === socket.id);
  return { ...found, slot };
}

function handleSubmitWord(socket, data) {
  if (!data || typeof data !== 'object') return;
  const found = findPlayerGame(socket, data.roomId);
  if (!found) return;
  const { roomId, room, slot } = found;

  const result = room.game.submitWord(slot, data.wordId, data.letters);
  if (result.type === 'claimed') {
    // Le mot est révélé chez les deux, avec le numéro de celui qui l'a trouvé.
    io.to(roomId).emit('word-claimed', {
      wordId: result.wordId,
      letters: result.letters,
      by: result.by,
      scores: result.scores,
    });
    if (room.game.isComplete()) finishGame(roomId, room);
  } else if (result.type === 'wrong') {
    socket.emit('word-wrong', {
      wordId: result.wordId,
      scores: result.scores,
      lockedUntil: result.lockedUntil,
      serverNow: Date.now(),
    });
    // L'adversaire voit le score bouger, mais pas le mot tenté.
    socket.to(roomId).emit('scores', { scores: result.scores });
  } else if (result.type === 'locked') {
    // Mot encore bloqué : pas de pénalité, on rappelle juste jusqu'à quand.
    socket.emit('word-locked', { wordId: result.wordId, lockedUntil: result.lockedUntil, serverNow: Date.now() });
  }
}

function handleBuyLetter(socket, data) {
  if (!data || typeof data !== 'object') return;
  const found = findPlayerGame(socket, data.roomId);
  if (!found) return;
  const { roomId, room, slot } = found;

  const result = room.game.buyLetter(slot, data.wordId);
  if (result.type !== 'revealed') return;
  // La lettre part à l'acheteur seul ; l'adversaire ne voit que les scores.
  socket.emit('letter-revealed', {
    wordId: result.wordId,
    index: result.index,
    letter: result.letter,
    scores: result.scores,
  });
  socket.to(roomId).emit('scores', { scores: result.scores });
}

/* ---------- Freeze : gel, givre qui repousse, dégivrage ---------- */

function clearFreezeTimers(room, slot) {
  const timers = room.freezeTimers[slot];
  if (!timers) return;
  clearInterval(timers.regrow);
  clearTimeout(timers.safety);
  room.freezeTimers[slot] = null;
}

// Le joueur `slot` est dégivré : on prévient les deux joueurs.
function thawPlayer(roomId, room, slot) {
  clearFreezeTimers(room, slot);
  io.to(roomId).emit('unfrozen', { slot });
}

function startFreezeTimers(roomId, room, slot) {
  clearFreezeTimers(room, slot);
  const target = room.players[slot].id;
  room.freezeTimers[slot] = {
    // S'il arrête de racler, le givre repousse.
    regrow: setInterval(safe('repousse du givre', () => {
      const layers = room.game.regrow(slot);
      if (layers !== null) io.to(target).emit('frost', { layers });
    }), FREEZE.regrowMs / 4),
    // Sécurité : personne ne reste bloqué plus de 20 s.
    safety: setTimeout(safe('dégivrage automatique', () => {
      if (room.game.thaw(slot)) thawPlayer(roomId, room, slot);
    }), FREEZE.maxMs),
  };
}

function handleScrape(socket, data) {
  if (!data || typeof data !== 'object') return;
  const found = findPlayerGame(socket, data.roomId);
  if (!found) return;
  const { roomId, room, slot } = found;

  const result = room.game.scrape(slot);
  if (result.type === 'frost') socket.emit('frost', { layers: result.layers });
  else if (result.type === 'thawed') thawPlayer(roomId, room, slot);
}

function handleUsePower(socket, data) {
  if (!data || typeof data !== 'object') return;
  const found = findPlayerGame(socket, data.roomId);
  if (!found) return;
  const { roomId, room, slot } = found;

  const result = room.game.usePower(slot);
  if (result.type !== 'used') {
    socket.emit('power-refused', { reason: result.reason });
    return;
  }
  const attacker = room.players[slot];
  // L'effet part chez la cible seulement ; le lanceur voit son compteur baisser.
  io.to(room.players[result.target].id).emit('power-hit', {
    power: result.power,
    duration: result.duration,
    payload: result.payload,
    from: attacker.pseudo,
  });
  socket.emit('power-used', { power: result.power, remaining: result.remaining });
  if (result.power === 'freeze') startFreezeTimers(roomId, room, result.target);
}

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  socket.on('find-game', safe('find-game', (data) => addToQueue(socket, data, startGame)));
  socket.on('play-solo', safe('play-solo', (data) => createSoloRoom(socket, data, startGame)));
  socket.on('submit-word', safe('submit-word', (data) => handleSubmitWord(socket, data)));
  socket.on('buy-letter', safe('buy-letter', (data) => handleBuyLetter(socket, data)));
  socket.on('use-power', safe('use-power', (data) => handleUsePower(socket, data)));
  socket.on('scrape', safe('scrape', (data) => handleScrape(socket, data)));

  socket.on('disconnect', safe('disconnect', (reason) => {
    console.log('Player disconnected', socket.id, reason);
    handleDisconnect(socket, io);
  }));
});

server.listen(PORT, () => {
  // Le vrai port (utile quand PORT=0 : le système en choisit un libre, pour les tests).
  console.log(`Serveur démarré sur http://localhost:${server.address().port}`);
});
