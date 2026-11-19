// Point d'entrée du jeu : Express sert la page, Socket.io gère le temps réel.
// Squelette de départ. La logique du jeu arrive au lot L1.
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('Player connected', socket.id);

  socket.on('disconnect', () => {
    console.log('Player disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
