// Point d'entrée du jeu : Express sert la page, Socket.io gère le temps réel.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { addToQueue, handleDisconnect } = require('./matchmaking');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Deux joueurs viennent d'être appariés : on prévient chacun.
function startGame(roomId, room) {
  room.players.forEach((player, index) => {
    const opponent = room.players[1 - index];
    io.to(player.id).emit('game-start', {
      roomId,
      you: { pseudo: player.pseudo, slot: index },
      opponent: { pseudo: opponent.pseudo, slot: 1 - index },
    });
  });
}

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  socket.on('find-game', (data) => {
    addToQueue(socket, data && data.pseudo, startGame);
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected', socket.id);
    handleDisconnect(socket, io);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
