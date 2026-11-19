// Outils de test : démarre le vrai serveur sur un port libre et crée des
// joueurs simulés avec socket.io-client.
const { spawn } = require('child_process');
const path = require('path');
const { io } = require('socket.io-client');

// Lance server.js et attend qu'il écoute. env permet de raccourcir le chrono.
function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    // PORT=0 : le système choisit un port libre (pas de collision entre fichiers de test).
    // START_DELAY_MS=0 : pas de compte à rebours dans les tests (sauf s'ils le demandent).
    env: { ...process.env, PORT: '0', START_DELAY_MS: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/Serveur démarré sur (http:\/\/localhost:\d+)/);
      if (match) resolve({ url: match[1], stop: () => child.kill() });
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

// Le test retrouve les réponses à partir des définitions, comme le ferait un
// humain avec la bibliothèque. Le serveur, lui, ne les envoie jamais.
const WORDS = require('../data/mots.json');
const answerOfClue = (clue) => WORDS.find((w) => w.definition === clue).mot;
// Dégâts infligés par un mot trouvé : lettres × 3 (voir COMBAT dans game.js).
const damageOf = (clue) => answerOfClue(clue).length * 3;

// Cherche récursivement des clés de solution dans un message.
function forbiddenKeys(value, found = []) {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (['answer', 'display', 'type', 'mot', 'affichage'].includes(k)) found.push(k);
      forbiddenKeys(v, found);
    }
  }
  return found;
}

// Deux joueurs cherchent une partie et sont appariés.
async function startMatch(server) {
  const p1 = createPlayer(server.url);
  const p2 = createPlayer(server.url);
  p1.emit('find-game', { pseudo: 'Un' });
  await waitFor(p1, 'waiting');
  const s1 = waitFor(p1, 'game-start');
  const s2 = waitFor(p2, 'game-start');
  p2.emit('find-game', { pseudo: 'Deux' });
  const [g1, g2] = await Promise.all([s1, s2]);
  return { p1, p2, g1, g2 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ne garde que certains champs d'un message (pour comparer l'essentiel).
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

module.exports = {
  startServer, createPlayer, waitFor, expectNothing, answerOfClue, damageOf, forbiddenKeys, startMatch, sleep, pick,
};
