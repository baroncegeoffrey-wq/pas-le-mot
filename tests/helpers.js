// Outils de test : démarre le vrai serveur sur un port libre et crée des
// joueurs simulés avec socket.io-client.
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

let nextPort = 4100 + Math.floor(Math.random() * 500);

// Lance server.js et attend qu'il écoute. env permet de raccourcir le chrono.
function startServer(env = {}) {
  const port = nextPort++;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Serveur démarré')) {
        resolve({ url: `http://localhost:${port}`, stop: () => child.kill() });
      }
    });
    child.stderr.on('data', (chunk) => reject(new Error(chunk.toString())));
  });
}

// Un joueur simulé qui enregistre tout ce qu'il reçoit du serveur.
function createPlayer(url) {
  const socket = io(url, { transports: ['websocket'], forceNew: true });
  socket.received = [];
  socket.onAny((event, payload) => socket.received.push({ event, payload }));
  return socket;
}

// Attend le prochain message `event` (ou échoue au bout de `ms`).
function waitFor(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Pas reçu "${event}"`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Vérifie qu'un message n'arrive PAS pendant `ms`.
function expectNothing(socket, event, ms = 300) {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`"${event}" reçu alors qu'il ne devait pas`));
    socket.once(event, handler);
    setTimeout(() => { socket.off(event, handler); resolve(); }, ms);
  });
}

module.exports = { startServer, createPlayer, waitFor, expectNothing };
