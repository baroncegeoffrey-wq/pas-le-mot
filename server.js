// Point d'entrée du jeu : Express sert la page, Socket.io gère le temps réel.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { addToQueue, handleDisconnect, getRoomOf, endGame } = require('./matchmaking');
const { Game } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// Durée d'une partie : 4 minutes (réglable pour les tests automatiques).
const GAME_DURATION_MS = Number(process.env.GAME_DURATION_MS) || 4 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));

// Deux joueurs viennent d'être appariés : on crée la grille et on envoie à
// chacun la version publique (sans les solutions).
function startGame(roomId, room) {
  room.game = new Game();
  const { grid, clues } = room.game.getPublicGrid();
  const endsAt = Date.now() + GAME_DURATION_MS;
  room.timer = setTimeout(() => finishGame(roomId, room), GAME_DURATION_MS);

  room.players.forEach((player, index) => {
    const opponent = room.players[1 - index];
    io.to(player.id).emit('game-start', {
      roomId,
      grid,
      clues,
      you: { pseudo: player.pseudo, slot: index },
      opponent: { pseudo: opponent.pseudo, slot: 1 - index },
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
  io.to(roomId).emit('game-over', { scores, winner });
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
    socket.emit('word-wrong', { wordId: result.wordId, scores: result.scores });
    // L'adversaire voit le score bouger, mais pas le mot tenté.
    socket.to(roomId).emit('scores', { scores: result.scores });
  }
}

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  socket.on('find-game', (data) => {
    addToQueue(socket, data && data.pseudo, startGame);
  });

  socket.on('submit-word', (data) => handleSubmitWord(socket, data));

  socket.on('disconnect', () => {
    console.log('Player disconnected', socket.id);
    handleDisconnect(socket, io);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
