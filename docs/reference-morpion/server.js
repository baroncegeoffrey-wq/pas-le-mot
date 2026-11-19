const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const {
  addToQueue,
  handleDisconnect,
  endGame,
  activeGames,
  playerRooms,
} = require('./matchmaking');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Sert les fichiers statiques du dossier public/
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  socket.on('find-game', () => {
    addToQueue(socket, io);
  });

  socket.on('make-move', (index, clientRoomId) => {
    // Le salon vient de playerRooms, jamais du client : on ne peut pas jouer
    // dans une partie dont on ne fait pas partie.
    const roomId = playerRooms.get(socket.id);
    const room = roomId && activeGames.get(roomId);
    if (!room) {
      socket.emit('invalid-move', { error: "Tu n'es pas en partie" });
      return;
    }
    // Un roomId différent signale un client désynchronisé (ancienne partie).
    if (clientRoomId !== undefined && clientRoomId !== roomId) {
      socket.emit('invalid-move', { error: "Ce coup ne concerne pas ta partie en cours" });
      return;
    }

    // Le symbole vient du serveur, pas du client : impossible de jouer pour l'adversaire.
    const symbol = room.players.X === socket.id ? 'X' : 'O';
    const result = room.game.makeMove(index, symbol);

    if (!result.valid) {
      socket.emit('invalid-move', { error: result.error });
      return;
    }

    const isOver = Boolean(result.winner || result.isDraw);

    io.to(roomId).emit('move-made', {
      index,
      symbol: result.symbol,
      board: result.board,
      // null quand la partie est finie : personne ne doit plus pouvoir cliquer.
      nextTurn: isOver ? null : room.game.getState().currentTurn,
    });

    if (isOver) {
      io.to(roomId).emit('game-over', {
        winner: result.winner,
        isDraw: result.isDraw,
        board: result.board,
      });
      endGame(roomId, io);
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected', socket.id);
    handleDisconnect(socket, io);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
