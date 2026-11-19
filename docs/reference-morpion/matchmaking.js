// Mise en relation des joueurs et suivi des parties en cours.
const crypto = require('crypto');
const TicTacToeGame = require('./game');

// Joueurs en attente d'un adversaire.
const queue = [];

// roomId -> { game, players: { X: socketId, O: socketId } }
const activeGames = new Map();

// socketId -> roomId
const playerRooms = new Map();

function addToQueue(socket, io) {
  // Ignore un joueur déjà en attente ou déjà en partie.
  if (queue.includes(socket) || playerRooms.has(socket.id)) return;

  const opponent = queue.shift();
  if (!opponent) {
    queue.push(socket);
    socket.emit('waiting');
    return;
  }

  const roomId = crypto.randomUUID();
  const game = new TicTacToeGame();

  // Tirage au sort de qui joue X.
  const [playerX, playerO] = Math.random() < 0.5 ? [socket, opponent] : [opponent, socket];

  activeGames.set(roomId, { game, players: { X: playerX.id, O: playerO.id } });

  for (const [player, symbol] of [[playerX, 'X'], [playerO, 'O']]) {
    playerRooms.set(player.id, roomId);
    player.join(roomId);
    player.emit('game-start', { symbol, roomId, currentTurn: game.getState().currentTurn });
  }
}

function removeFromQueue(socket) {
  const index = queue.indexOf(socket);
  if (index !== -1) queue.splice(index, 1);
}

function handleDisconnect(socket, io) {
  removeFromQueue(socket);

  const roomId = playerRooms.get(socket.id);
  if (!roomId) return;

  const room = activeGames.get(roomId);
  activeGames.delete(roomId);

  for (const playerId of Object.values(room ? room.players : { self: socket.id })) {
    playerRooms.delete(playerId);
    if (playerId === socket.id) continue;

    io.to(playerId).emit('opponent-left');
    // L'adversaire est encore connecté : il quitte le salon fermé.
    const opponentSocket = io.sockets.sockets.get(playerId);
    if (opponentSocket) opponentSocket.leave(roomId);
  }
}

// Ferme un salon dont la partie est terminée, pour que les deux joueurs
// puissent relancer 'find-game'.
function endGame(roomId, io) {
  const room = activeGames.get(roomId);
  if (!room) return;
  activeGames.delete(roomId);

  for (const playerId of Object.values(room.players)) {
    playerRooms.delete(playerId);
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) playerSocket.leave(roomId);
  }
}

module.exports = {
  addToQueue,
  removeFromQueue,
  handleDisconnect,
  endGame,
  activeGames,
  playerRooms,
};
