// Mise en relation des joueurs et suivi des parties en cours.
// Repris du morpion (docs/reference-morpion/matchmaking.js) : même file
// d'attente, mêmes salons, mais avec un pseudo et sans logique de jeu ici.
const crypto = require('crypto');

const MAX_PSEUDO_LENGTH = 16;

// Joueurs en attente d'un adversaire : [{ socket, pseudo }]
const queue = [];

// roomId -> { game, timer, solo, players: [{ id, pseudo }, { id, pseudo }] }
// (un seul joueur dans players en mode solo)
const activeGames = new Map();

// socketId -> roomId
const playerRooms = new Map();

// Nettoie le pseudo envoyé par le client (on ne lui fait pas confiance).
function cleanPseudo(raw) {
  const pseudo = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  return pseudo.slice(0, MAX_PSEUDO_LENGTH) || 'Joueur';
}

// Met le joueur en file. Si quelqu'un attend déjà, crée un salon pour les deux
// et appelle onMatch(roomId, room) : c'est server.js qui lance la partie.
function addToQueue(socket, rawPseudo, onMatch) {
  // Ignore un joueur déjà en attente ou déjà en partie.
  if (queue.some((entry) => entry.socket === socket) || playerRooms.has(socket.id)) return;

  const pseudo = cleanPseudo(rawPseudo);
  const opponent = queue.shift();
  if (!opponent) {
    queue.push({ socket, pseudo });
    socket.emit('waiting');
    return;
  }

  const roomId = crypto.randomUUID();
  const room = {
    game: null,
    timer: null,
    players: [
      { id: opponent.socket.id, pseudo: opponent.pseudo },
      { id: socket.id, pseudo },
    ],
  };
  activeGames.set(roomId, room);

  for (const player of [opponent.socket, socket]) {
    playerRooms.set(player.id, roomId);
    player.join(roomId);
  }

  onMatch(roomId, room);
}

// Mode solo : un salon pour un seul joueur, sans passer par la file d'attente.
function createSoloRoom(socket, rawPseudo, onMatch) {
  if (playerRooms.has(socket.id)) return;
  removeFromQueue(socket); // il attendait peut-être un adversaire

  const roomId = crypto.randomUUID();
  const room = { game: null, timer: null, solo: true, players: [{ id: socket.id, pseudo: cleanPseudo(rawPseudo) }] };
  activeGames.set(roomId, room);
  playerRooms.set(socket.id, roomId);
  socket.join(roomId);
  onMatch(roomId, room);
}

function removeFromQueue(socket) {
  const index = queue.findIndex((entry) => entry.socket === socket);
  if (index !== -1) queue.splice(index, 1);
}

// Retrouve le salon du joueur à partir du serveur, jamais du client.
function getRoomOf(socketId) {
  const roomId = playerRooms.get(socketId);
  const room = roomId && activeGames.get(roomId);
  return room ? { roomId, room } : null;
}

// Supprime le salon, arrête son chrono et libère les deux joueurs.
function closeRoom(roomId, io) {
  const room = activeGames.get(roomId);
  if (!room) return null;
  activeGames.delete(roomId);
  if (room.timer) clearTimeout(room.timer);

  for (const { id } of room.players) {
    playerRooms.delete(id);
    const playerSocket = io.sockets.sockets.get(id);
    if (playerSocket) playerSocket.leave(roomId);
  }
  return room;
}

function handleDisconnect(socket, io) {
  removeFromQueue(socket);

  const roomId = playerRooms.get(socket.id);
  if (!roomId) return;

  const room = closeRoom(roomId, io);
  if (!room) return;
  for (const { id } of room.players) {
    if (id !== socket.id) io.to(id).emit('opponent-left');
  }
}

// Ferme un salon dont la partie est terminée, pour que les deux joueurs
// puissent relancer 'find-game'.
function endGame(roomId, io) {
  closeRoom(roomId, io);
}

module.exports = {
  addToQueue,
  createSoloRoom,
  removeFromQueue,
  handleDisconnect,
  endGame,
  getRoomOf,
  activeGames,
  playerRooms,
};
