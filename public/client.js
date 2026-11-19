// Côté navigateur : affiche la grille et envoie les mots au serveur.
// Le client ne connaît jamais les solutions : il affiche, le serveur décide.
const socket = io();

const $ = (id) => document.getElementById(id);
const lobby = $('lobby');
const gameScreen = $('game');
const statusText = $('status');
const gameStatus = $('game-status');
const findForm = $('find-form');
const findBtn = $('find-btn');
const soloBtn = $('solo-btn');
const createRoomBtn = $('create-room-btn');
const joinRoomBtn = $('join-room-btn');
const roomCodeInput = $('room-code');
const waitingBox = $('waiting');
const pseudoInput = $('pseudo');
const board = $('board');
const timerEl = $('timer');
const resultScreen = $('result');
const buyBtn = $('buy-btn');
const powerBtn = $('power-btn');
const tripLayer = $('trip');
const freezeLayer = $('freeze');
const iceAvatar = $('ice-avatar');
const cineLayer = $('cine');
const cineVideo = $('cine-video');
const arena = $('arena');
Attack.init(arena); // le canvas des attaques, posé sur l'arène
const boxMe = $('box-me');
const boxOpp = $('box-opp');
const fighterMe = $('fighter-me');
const fighterOpp = $('fighter-opp');

const USES_PER_GAME = 1; // une seule super attaque par partie
const HITSTOP_MS = 80; // arrêt sur image à chaque coup
const KO_MS = 2600; // durée du ralenti de K.O. avant l'écran de fin
const CINE_MAX_MS = 20000; // sécurité : une vidéo ne bloque jamais plus de 20 s de trop
const CINE_END_FLASH_MS = 500; // flash blanc de fin de cinématique (le serveur compte la même durée)

// Nom affiché de chaque avatar. Les images sont dans public/assets/avatars/
// (préparées avec scripts/prepare-assets.js) : <avatar>.png (fixe) et, pour le
// combat, <avatar>.webp (animé, en boucle).
const AVATAR_NAMES = {
  givre: 'Le Givré', perche: 'Le Perché', verlan: 'Le Verlan', mannequin: 'Mannequin',
};
const DUMMY = { pseudo: 'MANNEQUIN', slot: 1, avatar: 'mannequin' }; // l'adversaire du mode solo

const ANIMATED_AVATARS = new Set(['givre', 'perche', 'verlan']);

// animated : le perso animé (.webp) en combat ; si le fichier manque ou ne se
// lit pas, on retombe sur l'image fixe (.png).
function avatarImg(img, who, animated = false) {
  const still = `assets/avatars/${who}.png`;
  img.alt = AVATAR_NAMES[who] || '';
  img.onerror = null;
  if (animated && ANIMATED_AVATARS.has(who)) {
    img.onerror = () => { img.onerror = null; img.src = still; };
    img.src = `assets/avatars/${who}.webp`;
  } else {
    img.src = still;
  }
}

// Nom du pouvoir de chaque avatar (affiché sur le bouton).
const POWER_NAMES = { givre: 'Freeze', perche: 'Trip', verlan: 'Verlan' };

// État de la partie en cours
let roomId = null;
let mySlot = null;
let words = new Map(); // wordId -> { id, number, direction, cells: ["r,c", ...] }
let cells = new Map(); // "r,c" -> { el, input, across, down, locked }
let currentWord = null; // wordId sélectionné
let players = []; // [{ pseudo, slot, avatar }] rangés par slot (un seul en solo)
let opponent = null; // { pseudo, slot, avatar }, ou null en solo
let oppPowersLeft = 0; // compté à chaque pouvoir reçu
let cineTimers = []; // minuteries de la vidéo de super attaque
let maxHp = 100;
let koPlaying = false; // pendant le ralenti de K.O.
let cinePlaying = false; // pendant une cinématique : chrono en pause, saisies bloquées
let frostMax = 1; // couches de givre au départ (pour la barre)
let lastMode = 'duo'; // 'duo' ou 'solo' : ce que relance le bouton Rejouer
let timerInterval = null;
let clockOffset = 0; // heure du serveur - heure locale
let myAvatar = null;
let verlanActive = false; // pendant le Verlan, on écrit les mots par la fin
let frozenActive = false; // pendant le Freeze, on ne peut plus jouer
let startLocked = false; // pendant le « 3, 2, 1 », on ne peut pas encore jouer
let goTimers = []; // minuteries du compte à rebours de départ
const effectTimers = {}; // pouvoir reçu -> minuterie de fin de l'effet

// Sens d'écriture : 1 = du début vers la fin du mot, -1 = par la fin (Verlan).
const writeStep = () => (verlanActive ? -1 : 1);

const key = (r, c) => `${r},${c}`;

// Garde le serveur éveillé tant que la page est ouverte (voir /ping dans server.js).
setInterval(() => { fetch('ping', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);

// Retire les accents et garde une seule lettre majuscule (ou '').
function cleanLetter(text) {
  const letter = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  return letter.slice(-1);
}

/* ---------- Fond d'arène : vidéo en boucle, sinon image de secours, sinon la ville CSS ---------- */

(function setupArenaBackground() {
  const video = $('arena-bg');
  const useImage = () => {
    const img = new Image();
    img.onload = () => {
      arena.style.setProperty('--arena-image', `url("${img.src}")`);
      arena.classList.add('bg-image');
    };
    img.src = 'assets/arena/arene.jpg'; // si elle n'existe pas non plus : on garde la ville en CSS
  };
  video.addEventListener('error', () => { arena.classList.remove('bg-video'); useImage(); }, { once: true });
  video.addEventListener('playing', () => arena.classList.add('bg-video'), { once: true });
  video.src = 'assets/arena/arene.webm';
  video.play().catch(() => { if (!arena.classList.contains('bg-video')) useImage(); });
}());

/* ---------- Son : bouton pour couper, et déblocage au premier clic ---------- */

const muteBtn = $('mute-btn');
function showMute() {
  const muted = Sound.isMuted();
  muteBtn.textContent = muted ? 'SON : OFF' : 'SON : ON';
  muteBtn.setAttribute('aria-pressed', String(muted));
}
showMute();
muteBtn.addEventListener('click', () => { Sound.toggle(); showMute(); });
document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
document.addEventListener('keydown', () => Sound.unlock(), { once: true });

/* ---------- Accueil et recherche de partie ---------- */

try {
  pseudoInput.value = localStorage.getItem('pseudo') || '';
  const saved = findForm.querySelector(`input[name="avatar"][value="${localStorage.getItem('avatar')}"]`);
  if (saved) saved.checked = true;
} catch (e) { /* stockage indisponible */ }

findForm.addEventListener('change', (event) => {
  if (event.target.name !== 'avatar') return;
  try { localStorage.setItem('avatar', event.target.value); } catch (e) { /* tant pis */ }
});

// Active ou bloque les boutons de l'accueil.
function setLobbyButtons(enabled) {
  [findBtn, soloBtn, createRoomBtn, joinRoomBtn].forEach((btn) => { btn.disabled = !enabled; });
}

// Lien d'invitation reçu (?salon=ABCD) : on prépare le bouton Rejoindre.
const invitedCode = new URLSearchParams(location.search).get('salon');
if (invitedCode) roomCodeInput.value = invitedCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

socket.on('connect', () => {
  statusText.textContent = roomCodeInput.value
    ? `Tu es invité dans le salon ${roomCodeInput.value} : choisis ton pseudo et ton avatar, puis REJOINDRE.`
    : 'Connecté. Choisis un pseudo et ton avatar.';
  setLobbyButtons(true);
});
socket.on('disconnect', () => {
  statusText.textContent = 'Connexion au serveur perdue, reconnexion...';
  setLobbyButtons(false);
  hideWaiting();
  // En pleine partie, la partie est perdue côté serveur : on le dit clairement
  // au lieu de laisser un écran qui ne répond plus.
  if (roomId) {
    showResult('CONNEXION PERDUE', 'La connexion au serveur a coupé, la partie est annulée. Relance-en une.', 'neutral', null, null);
    $('podium-opp').hidden = true;
    setLobbyButtons(false);
  }
});

findForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) return;
  try { localStorage.setItem('pseudo', pseudo); } catch (e) { /* tant pis */ }
  findGame();
});

function chosenAvatar() {
  const checked = findForm.querySelector('input[name="avatar"]:checked');
  return checked ? checked.value : 'givre';
}

function findGame() {
  lastMode = 'duo';
  socket.emit('find-game', { pseudo: pseudoInput.value.trim(), avatar: chosenAvatar() });
  setLobbyButtons(false);
  statusText.textContent = 'Recherche d\'un adversaire...';
}

// Le pseudo est obligatoire avant toute partie ; on le retient pour la prochaine fois.
function checkPseudo() {
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) { pseudoInput.reportValidity(); return false; }
  try { localStorage.setItem('pseudo', pseudo); } catch (e) { /* tant pis */ }
  return true;
}

createRoomBtn.addEventListener('click', () => {
  if (!checkPseudo()) return;
  lastMode = 'private';
  socket.emit('create-room', { pseudo: pseudoInput.value.trim(), avatar: chosenAvatar() });
  setLobbyButtons(false);
});

function joinRoom() {
  if (!checkPseudo()) return;
  const code = roomCodeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) {
    statusText.textContent = 'Le code d\'un salon fait 4 lettres.';
    roomCodeInput.focus();
    return;
  }
  lastMode = 'private';
  socket.emit('join-room', { code, pseudo: pseudoInput.value.trim(), avatar: chosenAvatar() });
  setLobbyButtons(false);
  statusText.textContent = `Connexion au salon ${code}...`;
}
joinRoomBtn.addEventListener('click', joinRoom);
roomCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); joinRoom(); }
});

/* ---------- Écran d'attente ---------- */

let waitingTimer = null;
let inviteLink = '';

// mode : 'public' (file d'attente) ou 'private' (salon avec un code).
function showWaiting(mode, code) {
  findForm.hidden = true;
  waitingBox.hidden = false;
  avatarImg($('waiting-sprite'), chosenAvatar());
  const base = `${location.origin}${location.pathname}`;
  inviteLink = mode === 'private' ? `${base}?salon=${code}` : base;
  $('waiting-title').textContent = mode === 'private' ? 'SALON PRIVÉ CRÉÉ' : 'EN ATTENTE D\'UN ADVERSAIRE';
  $('waiting-code').hidden = mode !== 'private';
  $('waiting-code').textContent = code || '';
  $('waiting-help').textContent = mode === 'private'
    ? 'Envoie ce code ou le lien à ton pote : la partie démarre dès qu\'il rejoint.'
    : 'Personne en ligne ? Envoie le lien du jeu à un pote pour qu\'il te rejoigne.';
  $('copy-status').textContent = '';
  statusText.textContent = '';
  const startedAt = Date.now();
  clearInterval(waitingTimer);
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('waiting-time').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  waitingTimer = setInterval(tick, 1000);
}

function hideWaiting() {
  clearInterval(waitingTimer);
  waitingBox.hidden = true;
  findForm.hidden = false;
}

$('copy-link-btn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(inviteLink);
    $('copy-status').textContent = 'Lien copié ! Colle-le à ton pote.';
  } catch (e) {
    // Presse-papiers indisponible : on affiche le lien pour qu'il soit copié à la main.
    $('copy-status').textContent = inviteLink;
  }
});

$('cancel-btn').addEventListener('click', () => socket.emit('cancel-search'));

socket.on('search-cancelled', () => {
  hideWaiting();
  setLobbyButtons(true);
  statusText.textContent = 'Recherche annulée.';
});

socket.on('room-created', ({ code }) => showWaiting('private', code));

socket.on('room-error', ({ reason }) => {
  hideWaiting();
  setLobbyButtons(true);
  statusText.textContent = reason;
});

function playSolo() {
  lastMode = 'solo';
  socket.emit('play-solo', { pseudo: pseudoInput.value.trim(), avatar: chosenAvatar() });
}

soloBtn.addEventListener('click', () => {
  if (!checkPseudo()) return;
  playSolo();
});

// Revient à l'accueil et relance une partie du même type, avec le même pseudo.
$('replay-btn').addEventListener('click', () => {
  resultScreen.hidden = true;
  gameScreen.hidden = true;
  lobby.hidden = false;
  if (lastMode === 'solo') playSolo();
  else if (lastMode === 'private') {
    // Un salon privé ne se relance pas tout seul : on revient à l'accueil.
    setLobbyButtons(true);
    statusText.textContent = 'Crée un nouveau salon, ou rejoins celui de ton pote avec son code.';
  } else findGame();
});

// Revient à l'accueil sans relancer de partie.
$('home-btn').addEventListener('click', () => {
  resultScreen.hidden = true;
  gameScreen.hidden = true;
  lobby.hidden = false;
  statusText.textContent = 'Choisis ton avatar et relance une partie.';
});

socket.on('waiting', () => showWaiting('public'));

/* ---------- Début de partie : construction de la grille ---------- */

socket.on('game-start', (data) => {
  hideWaiting();
  // Le lien d'invitation a servi : on le retire de l'adresse.
  if (invitedCode) history.replaceState(null, '', location.pathname);
  roomId = data.roomId;
  mySlot = data.you.slot;
  players = [data.you, data.opponent].filter(Boolean).sort((a, b) => a.slot - b.slot);
  opponent = data.opponent;

  clearEffects();
  myAvatar = data.you.avatar;
  oppPowersLeft = opponent ? USES_PER_GAME : 0;

  // L'arène : moi à gauche, l'adversaire à droite (un mannequin en solo).
  maxHp = data.maxHp || 100;
  const foe = opponent || DUMMY;
  fillPlayerBox(boxMe, data.you, true, data.opponent ? data.you.powersLeft : 0);
  fillPlayerBox(boxOpp, foe, false, oppPowersLeft);
  avatarImg(fighterMe.querySelector('img'), data.you.avatar, true);
  avatarImg(fighterOpp.querySelector('img'), foe.avatar, true);
  resetFighters();
  setHp([maxHp, maxHp], true);
  preloadCinematics(); // les 3 vidéos, pour qu'elles se lancent sans délai
  setPowerButton(data.opponent ? data.you.powersLeft : 0);
  powerBtn.hidden = !data.opponent; // pas de pouvoir en solo

  buildBoard(data.grid);
  buildClues(data.clues);
  gameStatus.textContent = 'Remplis un mot puis appuie sur Entrée.';
  lobby.hidden = true;
  resultScreen.hidden = true;
  gameScreen.hidden = false;
  selectWord(data.grid.words[0].id, true);
  const startsAt = data.startsAt || data.serverNow;
  startTimer(data.endsAt, data.serverNow, data.endsAt - startsAt);
  startCountdown(startsAt, data.serverNow);
});

/* ---------- Compte à rebours de départ : 3, 2, 1, GO ! ---------- */

function stopCountdown() {
  goTimers.forEach(clearTimeout);
  goTimers = [];
  $('go').hidden = true;
  startLocked = false;
}

function showGo(text, final) {
  const go = $('go');
  go.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  go.appendChild(span);
  go.classList.toggle('final', final);
  go.hidden = false;
  Sound.play(final ? 'go' : 'tick');
}

// startsAt est l'heure du serveur ; on la ramène à l'horloge locale.
function startCountdown(startsAt, serverNow) {
  stopCountdown();
  const localStart = startsAt - (serverNow - Date.now());
  const wait = localStart - Date.now();
  if (wait <= 50) return; // pas de compte à rebours (déjà commencé)
  startLocked = true;
  gameStatus.textContent = 'Prêt ? La partie commence dans un instant...';
  [3, 2, 1].forEach((n) => {
    const at = wait - n * 1000;
    if (at >= -100) goTimers.push(setTimeout(() => showGo(String(n), false), Math.max(0, at)));
  });
  goTimers.push(setTimeout(() => {
    startLocked = false;
    showGo('GO !', true);
    gameStatus.textContent = 'Remplis un mot puis appuie sur Entrée.';
    if (currentWord) selectWord(currentWord, true);
  }, wait));
  goTimers.push(setTimeout(() => { $('go').hidden = true; }, wait + 800));
}

// Plaque de nom d'un joueur : pseudo, score, avatar, pouvoirs restants.
function fillPlayerBox(box, player, isMe, powersLeft) {
  box.querySelector('.name').textContent = player.pseudo;
  box.querySelector('.avatar-label').textContent = `${AVATAR_NAMES[player.avatar] || ''}${isMe ? ' · toi' : ''}`;
  setPips(box, powersLeft);
}

/* ---------- Points de vie ---------- */

// Met à jour les deux barres de PV. La partie blanche (« ghost ») descend un peu
// après la barre colorée, pour bien voir le morceau de vie perdu.
// PV affichés = PV du serveur + dégâts encore « en vol » (le projectile n'a
// pas encore touché) : la barre ne descend qu'à l'impact.
let lastHp = [100, 100];
let pendingDamage = [0, 0];

function setHp(hp, instant) {
  lastHp = hp.slice();
  hp.forEach((serverValue, slot) => {
    if (slot !== mySlot && slot !== 1 - mySlot) return;
    const value = Math.min(maxHp, serverValue + (pendingDamage[slot] || 0));
    const box = boxOf(slot);
    const bar = box.querySelector('.hp');
    const pct = Math.max(0, Math.min(100, (value / maxHp) * 100));
    const fill = bar.querySelector('.hp-fill');
    const ghost = bar.querySelector('.hp-ghost');
    fill.style.width = `${pct}%`;
    if (instant) ghost.style.width = `${pct}%`;
    else setTimeout(() => { ghost.style.width = `${pct}%`; }, 450);
    bar.querySelector('.hp-text').textContent = `${value} PV`;
    bar.setAttribute('aria-valuenow', String(value));
    bar.classList.toggle('low', pct <= 30);
    bar.classList.toggle('mid', pct > 30 && pct <= 60);
  });
}

/* ---------- Impacts : chaque coup se sent ---------- */

function resetFighters() {
  Attack.clear();
  pendingDamage = [0, 0];
  [fighterMe, fighterOpp].forEach((f) => f.classList.remove('iced', 'flash', 'recoil', 'lunge', 'ko-fall', 'charging'));
  arena.classList.remove('ko-zoom', 'ko-left', 'ko-right', 'upside-down');
  $('ko-text').hidden = true;
}

// Relance une animation CSS (retirer puis remettre la classe).
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// Des étincelles et des gouttes (sang stylisé) qui jaillissent du point d'impact.
function burstParticles(x, y, count, blood) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    const isBlood = blood && i % 2 === 1;
    p.className = isBlood ? 'particle blood' : 'particle spark';
    const angle = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 90;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.7 + (isBlood ? 40 : -10)}px`);
    arena.appendChild(p);
    setTimeout(() => p.remove(), 750);
  }
}

// Le chiffre de dégâts qui jaillit au-dessus de la cible.
function popDamage(x, y, damage, kind) {
  const d = document.createElement('span');
  d.className = `dmg ${kind}`;
  d.textContent = `-${damage}`;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  d.style.setProperty('--size', `${Math.min(64, 22 + damage)}px`);
  arena.appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

// Un coup : arrêt sur image, tremblement proportionnel, flash blanc de la cible,
// recul, chiffre de dégâts et particules. side : 'me' ou 'opp' (la cible).
// kind : 'word' (mot trouvé), 'recoil' (erreur), 'cost' (lettre achetée).
function hitFx(side, damage, kind) {
  if (!damage) return;
  const target = side === 'me' ? fighterMe : fighterOpp;
  const box = target.getBoundingClientRect();
  const origin = arena.getBoundingClientRect();
  const x = box.left - origin.left + box.width / 2;
  const y = box.top - origin.top + box.height * 0.4;

  document.body.classList.add('hitstop');
  setTimeout(() => {
    document.body.classList.remove('hitstop');
    // Tremblement : plus le coup est fort, plus l'écran bouge (2 à 22 px).
    gameScreen.style.setProperty('--amp', `${Math.min(22, 2 + damage * 0.6)}px`);
    replay(gameScreen, 'shake');
    target.style.setProperty('--dir', side === 'me' ? '-1' : '1');
    replay(target, 'flash');
    replay(target, 'recoil');
    popDamage(x, y - 40, damage, kind);
    burstParticles(x, y, kind === 'word' ? 10 + Math.min(14, damage / 2) : 6, kind === 'word');
  }, HITSTOP_MS);
  Sound.play(kind === 'word' ? 'impact' : 'bad');
}

const sideOf = (slot) => (slot === mySlot ? 'me' : 'opp');
const fighterOf = (slot) => (slot === mySlot ? fighterMe : fighterOpp);
const avatarOfSlot = (slot) => (slot === mySlot ? myAvatar : (opponent ? opponent.avatar : DUMMY.avatar));

// Mot trouvé : l'attaquant charge, tire son projectile, et l'impact (barre de
// PV, hit-stop, tremblement...) arrive quand il touche. Voir attack.js.
function attackFx(by, target, letters, damage, big = false) {
  pendingDamage[target] += damage;
  setHp(lastHp);
  const from = fighterOf(by);
  Attack.fire({
    from,
    to: fighterOf(target),
    avatar: avatarOfSlot(by),
    letters,
    big,
    onShot: () => replay(from, 'lunge'),
    onImpact: () => {
      pendingDamage[target] = Math.max(0, pendingDamage[target] - damage);
      setHp(lastHp);
      hitFx(sideOf(target), damage, 'word');
    },
  });
}

function setPips(box, left) {
  const pips = box.querySelector('.pips');
  pips.innerHTML = '';
  if (!opponent) return; // pas de pouvoir en solo
  for (let i = 0; i < USES_PER_GAME; i++) {
    const pip = document.createElement('span');
    if (i < left) pip.className = 'on';
    pips.appendChild(pip);
  }
}

const boxOf = (slot) => (slot === mySlot ? boxMe : boxOpp);

/* ---------- Stress de fin de partie (30 s, 20 s, 10 s) ---------- */

let lastStressSecond = null;

function flashAlert(text) {
  const alert = $('stress-alert');
  alert.textContent = text;
  alert.classList.remove('show');
  void alert.offsetWidth; // relance l'animation
  alert.classList.add('show');
  Sound.play('alert');
}

function showCountdown(n) {
  const el = $('countdown');
  el.textContent = n;
  el.classList.remove('tick');
  void el.offsetWidth;
  el.classList.add('tick');
}

// Appelée à chaque tic du chrono avec les secondes restantes.
function updateStress(seconds) {
  const level = seconds <= 10 ? 10 : seconds <= 20 ? 20 : seconds <= 30 ? 30 : 0;
  document.body.classList.toggle('stress-30', level === 30);
  document.body.classList.toggle('stress-20', level === 20);
  document.body.classList.toggle('stress-10', level === 10);
  if (seconds === lastStressSecond) return;
  lastStressSecond = seconds;
  if (seconds === 30) flashAlert('30 SECONDES !');
  if (seconds === 20) flashAlert('20 SECONDES !');
  if (seconds <= 10 && seconds > 0) showCountdown(seconds);
  // Battement de cœur sur les 30 dernières secondes, bip en plus sur les 10 dernières.
  if (seconds <= 30 && seconds > 0 && seconds !== 30 && seconds !== 20) Sound.play('heart');
  if (seconds <= 10 && seconds > 0) Sound.play('countdown');
}

function clearStress() {
  lastStressSecond = null;
  document.body.classList.remove('stress-30', 'stress-20', 'stress-10');
  $('stress-alert').classList.remove('show');
  $('countdown').classList.remove('tick');
}

/* ---------- Chrono (affichage seulement : c'est le serveur qui arrête la partie) ---------- */

// Fige le chrono (pendant une cinématique) : il garde la valeur affichée.
function pauseTimer() {
  clearInterval(timerInterval);
}

// duration : durée de la partie (le chrono ne dépasse jamais cette valeur,
// même pendant le compte à rebours de départ).
function startTimer(endsAt, serverNow, duration) {
  clearInterval(timerInterval);
  clearStress();
  clockOffset = serverNow - Date.now(); // écart entre l'horloge du serveur et la nôtre
  const tick = () => {
    const left = Math.min(duration, Math.max(0, endsAt - (Date.now() + clockOffset)));
    const seconds = Math.ceil(left / 1000);
    timerEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('low', seconds <= 30);
    updateStress(seconds);
    if (left === 0) clearInterval(timerInterval);
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

/* ---------- Fin de partie ---------- */

// Écran de fin. tone : 'win', 'lose', 'draw' ou 'neutral'.
// hp : les PV par slot, ou null quand il n'y a pas de podium à montrer.
function showResult(title, detail, tone, hp, winner, extra = {}) {
  clearInterval(timerInterval);
  clearStress();
  stopCountdown();
  renderStats(extra.stats);
  renderSolutions(extra.solutions);
  clearEffects();
  roomId = null;
  const titleEl = $('result-title');
  titleEl.textContent = title;
  titleEl.className = `result-title ${tone}`;
  $('result-detail').textContent = detail;

  // Le podium : le gagnant en grand, le perdant K.O.
  const me = players.find((p) => p.slot === mySlot);
  fillPodium($('podium-me'), me, hp, winner);
  const showOpp = Boolean(opponent && hp);
  $('podium-opp').hidden = !showOpp;
  if (showOpp) fillPodium($('podium-opp'), opponent, hp, winner);

  gameScreen.hidden = true;
  lobby.hidden = true;
  resultScreen.hidden = false;
  setLobbyButtons(socket.connected);
  $('replay-btn').focus();
}

function fillPodium(card, player, hp, winner) {
  avatarImg(card.querySelector('img'), player.avatar);
  card.querySelector('.name').textContent = player.pseudo.toUpperCase();
  card.querySelector('.score').textContent = hp ? `${hp[player.slot]} PV` : '';
  const isWinner = winner !== null && winner !== undefined && winner === player.slot;
  const isLoser = winner !== null && winner !== undefined && winner !== player.slot;
  card.classList.toggle('winner', isWinner);
  card.classList.toggle('ko', isLoser);
  card.querySelector('.podium-tag').textContent = isWinner ? 'VAINQUEUR' : (isLoser ? 'K.O.' : '');
}

// Tableau des stats : une colonne par joueur (moi d'abord).
function renderStats(stats) {
  const box = $('result-stats');
  box.innerHTML = '';
  if (!stats || !stats.length) return;
  const cols = stats.length > 1
    ? [{ slot: mySlot, cls: 'me', name: 'TOI' }, { slot: 1 - mySlot, cls: 'opp', name: opponent ? opponent.pseudo.toUpperCase() : 'ADVERSAIRE' }]
    : [{ slot: 0, cls: 'me', name: 'TOI' }];
  const rows = [
    ['Dégâts infligés', 'damage', 'high'],
    ['Mots trouvés', 'found', 'high'],
    ['Erreurs', 'wrong', 'low'],
    ['Lettres achetées', 'bought', 'low'],
    ['Super attaques', 'powers', 'none'],
  ];
  const table = document.createElement('table');
  const head = table.insertRow();
  head.appendChild(document.createElement('th'));
  cols.forEach((col) => {
    const th = document.createElement('th');
    th.className = col.cls;
    th.textContent = col.name;
    head.appendChild(th);
  });
  rows.forEach(([label, keyName, better]) => {
    const tr = table.insertRow();
    tr.insertCell().textContent = label;
    const values = cols.map((col) => stats[col.slot === mySlot && stats.length === 1 ? 0 : col.slot][keyName]);
    values.forEach((value) => {
      const td = tr.insertCell();
      td.textContent = value;
      // En duo, la meilleure valeur de la ligne est en jaune.
      if (cols.length > 1 && better !== 'none' && values[0] !== values[1]) {
        const best = better === 'high' ? Math.max(...values) : Math.min(...values);
        if (value === best) td.className = 'best';
      }
    });
  });
  box.appendChild(table);
}

// Les réponses : chaque mot avec sa définition et qui l'a trouvé.
function renderSolutions(solutions) {
  const wrap = $('result-solutions');
  const list = $('solutions-list');
  list.innerHTML = '';
  wrap.hidden = !solutions || !solutions.length;
  if (wrap.hidden) return;
  const sorted = [...solutions].sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === 'across' ? -1 : 1));
  sorted.forEach((s) => {
    const li = document.createElement('li');
    const who = s.foundBy === null ? 'nobody' : (s.foundBy === mySlot ? 'mine' : 'theirs');
    li.className = who;
    const n = document.createElement('span');
    n.className = 'sol-n';
    n.textContent = `${s.number} ${s.direction === 'across' ? '→' : '↓'}`;
    const word = document.createElement('span');
    word.className = 'sol-word';
    word.textContent = s.word;
    const whoText = document.createElement('span');
    whoText.className = 'sol-who';
    whoText.textContent = who === 'mine' ? 'trouvé par toi' : who === 'theirs' ? `trouvé par ${opponent ? opponent.pseudo : 'l\'adversaire'}` : 'pas trouvé';
    word.appendChild(whoText);
    const clue = document.createElement('span');
    clue.className = 'sol-clue';
    clue.textContent = s.clue;
    li.append(n, word, clue);
    list.appendChild(li);
  });
}

socket.on('game-over', ({
  hp, winner, ko, found, total, stats, solutions,
}) => {
  const extra = { stats, solutions };
  const show = () => {
    if (players.length === 1) {
      // Solo : on a frappé un mannequin d'entraînement.
      const words = `${found} mot${found > 1 ? 's' : ''} trouvé${found > 1 ? 's' : ''} sur ${total}`;
      Sound.play('win');
      const title = ko === 1 ? 'MANNEQUIN K.O. !' : 'TEMPS ÉCOULÉ';
      showResult(title, `${stats[0].damage} dégâts infligés  ·  ${words}`, ko === 1 ? 'win' : 'neutral', null, null, extra);
      return;
    }
    const me = players.find((p) => p.slot === mySlot);
    const winnerName = winner === mySlot ? me.pseudo : (opponent ? opponent.pseudo : '');
    const how = ko !== null && ko !== undefined
      ? `${winnerName} gagne par K.O. !`
      : `${winnerName} gagne aux points de vie, ${hp[winner]} PV contre ${hp[1 - winner]}`;
    Sound.play(winner === mySlot ? 'win' : 'lose');
    if (winner === null) showResult('ÉGALITÉ !', `${hp[0]} PV partout`, 'draw', hp, null, extra);
    else if (winner === mySlot) showResult('GAGNÉ !', how, 'win', hp, winner, extra);
    else showResult('PERDU...', how, 'lose', hp, winner, extra);
  };
  // On laisse les projectiles encore en vol toucher avant le K.O. ou l'écran de fin.
  Attack.whenIdle(() => {
    if (ko !== null && ko !== undefined) playKO(ko, show);
    else show();
  });
});

// K.O. : ralenti, zoom sur celui qui tombe, grand « K.O. », puis l'écran de fin.
function playKO(koSlot, then) {
  koPlaying = true;
  roomId = null; // plus aucune action pendant le ralenti
  clearInterval(timerInterval);
  clearStress();
  clearEffects(); // gel, Trip, Verlan ou vidéo en cours : on voit le K.O. en clair
  const loser = sideOf(koSlot) === 'me' ? fighterMe : fighterOpp;
  // Laisse le dernier coup s'afficher, puis tout ralentit.
  setTimeout(() => {
    document.getAnimations().forEach((a) => { a.playbackRate = 0.25; });
    arena.classList.add('ko-zoom', sideOf(koSlot) === 'me' ? 'ko-left' : 'ko-right');
    loser.classList.add('ko-fall');
    $('ko-text').hidden = false;
    Sound.play('impact');
  }, HITSTOP_MS + 150);
  setTimeout(() => {
    document.getAnimations().forEach((a) => { a.playbackRate = 1; });
    koPlaying = false;
    resetFighters();
    then();
  }, KO_MS);
}

function buildBoard(grid) {
  words = new Map();
  cells = new Map();
  board.innerHTML = '';
  // Taille des cases : 2,4 rem au maximum, plus petites si l'écran est étroit
  // (téléphone) pour que la grille entière tienne en largeur.
  board.style.setProperty('--size', `min(2.4rem, calc((100vw - 64px - ${(grid.width - 1) * 3}px) / ${grid.width}))`);
  board.style.gridTemplateColumns = `repeat(${grid.width}, var(--size))`;

  for (const w of grid.words) {
    const list = [];
    for (let i = 0; i < w.length; i++) {
      const r = w.row + (w.direction === 'down' ? i : 0);
      const c = w.col + (w.direction === 'across' ? i : 0);
      list.push(key(r, c));
      const cell = cells.get(key(r, c)) || { across: null, down: null, locked: false, number: null };
      cell[w.direction] = w.id;
      if (i === 0) cell.number = w.number;
      cells.set(key(r, c), cell);
    }
    words.set(w.id, { ...w, cells: list });
  }

  for (let r = 0; r < grid.height; r++) {
    for (let c = 0; c < grid.width; c++) {
      const cell = cells.get(key(r, c));
      const el = document.createElement('div');
      if (!cell) {
        el.className = 'empty';
        board.appendChild(el);
        continue;
      }
      el.className = 'cell';
      if (cell.number) {
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = cell.number;
        el.appendChild(num);
      }
      const input = document.createElement('input');
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'characters'); // clavier du téléphone en majuscules
      input.setAttribute('autocorrect', 'off');
      input.dataset.key = key(r, c);
      input.setAttribute('aria-label', `Case ligne ${r + 1}, colonne ${c + 1}`);
      el.appendChild(input);
      board.appendChild(el);
      cell.el = el;
      cell.input = input;
    }
  }
}

function buildClues(clues) {
  for (const dir of ['across', 'down']) $(`clues-${dir}`).innerHTML = '';
  for (const clue of clues) {
    const li = document.createElement('li');
    li.dataset.wordId = clue.wordId;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = clue.number;
    // Une flèche rappelle le sens du mot dans la grille.
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.setAttribute('aria-hidden', 'true');
    dir.textContent = clue.direction === 'across' ? '→' : '↓';
    const len = document.createElement('span');
    len.className = 'len';
    len.textContent = `(${words.get(clue.wordId).length})`;
    li.append(n, dir, document.createTextNode(clue.clue), len);
    words.get(clue.wordId).clueText = clue.clue;
    li.addEventListener('click', () => selectWord(clue.wordId, true));
    // Survoler une définition éclaire sa ligne dans la grille.
    li.addEventListener('mouseenter', () => setHover(clue.wordId, true));
    li.addEventListener('mouseleave', () => setHover(clue.wordId, false));
    $(`clues-${clue.direction}`).appendChild(li);
    words.get(clue.wordId).clueEl = li;
  }
}

/* ---------- Sélection d'un mot et déplacement ---------- */

// Affiche la définition du mot sélectionné juste au-dessus de la grille.
function showCurrentClue(w) {
  $('cc-num').textContent = w.number;
  $('cc-dir').textContent = w.direction === 'across' ? '→' : '↓';
  $('cc-text').textContent = w.clueText || '';
  $('cc-len').textContent = `${w.length} lettres`;
}

// Relie une définition et sa ligne : les deux s'éclairent ensemble.
function setHover(wordId, on) {
  const w = words.get(wordId);
  if (!w) return;
  w.cells.forEach((k) => cells.get(k).el.classList.toggle('hover', on));
  w.clueEl.classList.toggle('hover', on);
}

// Survoler une case éclaire la ou les définitions qui passent par elle.
board.addEventListener('mouseover', (event) => {
  const k = event.target.dataset && event.target.dataset.key;
  if (!k) return;
  const cell = cells.get(k);
  [cell.across, cell.down].filter(Boolean).forEach((id) => words.get(id).clueEl.classList.add('hover'));
});
board.addEventListener('mouseout', (event) => {
  const k = event.target.dataset && event.target.dataset.key;
  if (!k) return;
  const cell = cells.get(k);
  [cell.across, cell.down].filter(Boolean).forEach((id) => words.get(id).clueEl.classList.remove('hover'));
});

function selectWord(wordId, focusFirstEmpty) {
  if (currentWord) {
    const old = words.get(currentWord);
    old.cells.forEach((k) => cells.get(k).el.classList.remove('current'));
    old.clueEl.classList.remove('current');
  }
  currentWord = wordId;
  const w = words.get(wordId);
  w.cells.forEach((k) => cells.get(k).el.classList.add('current'));
  w.clueEl.classList.add('current');
  buyBtn.disabled = Boolean(w.claimed);
  showCurrentClue(w);

  if (focusFirstEmpty) {
    // En Verlan, on commence par la dernière case du mot.
    const order = verlanActive ? [...w.cells].reverse() : w.cells;
    const target = order.find((k) => !cells.get(k).input.value) || order[0];
    cells.get(target).input.focus();
  }
}

// Avance (step = 1) ou recule (step = -1) dans le mot courant, en sautant les
// cases déjà verrouillées.
function moveInWord(fromKey, step) {
  const w = words.get(currentWord);
  let i = w.cells.indexOf(fromKey) + step;
  while (i >= 0 && i < w.cells.length) {
    const cell = cells.get(w.cells[i]);
    if (!cell.locked) return cell;
    i += step;
  }
  return null;
}

board.addEventListener('focusin', (event) => {
  const k = event.target.dataset.key;
  if (!k) return;
  const cell = cells.get(k);
  const w = currentWord && words.get(currentWord);
  if (w && w.cells.includes(k)) return;
  // On garde la même direction si possible.
  const dir = w ? w.direction : 'across';
  selectWord(cell[dir] || cell.across || cell.down, false);
});

// Un clic sur la case déjà sélectionnée change de direction.
board.addEventListener('mousedown', (event) => {
  const k = event.target.dataset && event.target.dataset.key;
  if (!k || document.activeElement !== event.target) return;
  const cell = cells.get(k);
  if (cell.across && cell.down) {
    selectWord(currentWord === cell.across ? cell.down : cell.across, false);
  }
});

board.addEventListener('keydown', (event) => {
  const k = event.target.dataset.key;
  if (!k || !currentWord) return;
  // Gelé, ou avant le GO : le clavier ne répond pas.
  if (frozenActive || startLocked || cinePlaying) { event.preventDefault(); return; }
  const cell = cells.get(k);
  const [r, c] = k.split(',').map(Number);

  if (event.key === 'Enter') {
    event.preventDefault();
    submitCurrentWord();
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    if (!cell.locked && cell.input.value) {
      cell.input.value = '';
      return;
    }
    const prev = moveInWord(k, -writeStep());
    if (prev) { prev.input.value = ''; prev.input.focus(); }
    return;
  }

  const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
  if (arrows[event.key]) {
    event.preventDefault();
    const [dr, dc] = arrows[event.key];
    const next = cells.get(key(r + dr, c + dc));
    if (!next) return;
    const dir = dr ? 'down' : 'across';
    if (next[dir]) selectWord(next[dir], false);
    next.input.focus();
    return;
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const letter = cleanLetter(event.key);
    if (!letter || cell.locked) return;
    cell.input.value = letter;
    const next = moveInWord(k, writeStep());
    if (next) next.input.focus();
  }
});

// Secours pour les claviers qui n'envoient pas de keydown utilisable, et pour
// le copier-coller : plusieurs lettres reçues d'un coup sont réparties dans les
// cases suivantes du mot.
board.addEventListener('input', (event) => {
  const k = event.target.dataset.key;
  if (!k) return;
  let cell = cells.get(k);
  if (cell.locked) return;
  if (frozenActive || startLocked || cinePlaying) { cell.input.value = ''; return; }
  // event.data = le texte qui vient d'être tapé ou collé (sans l'ancienne lettre).
  const raw = typeof event.data === 'string' ? event.data : cell.input.value;
  const letters = [...raw].map(cleanLetter).filter(Boolean);
  cell.input.value = '';
  let currentKey = k;
  for (const letter of letters) {
    cell.input.value = letter;
    const next = moveInWord(currentKey, writeStep());
    if (!next) break;
    cell = next;
    currentKey = next.input.dataset.key;
  }
  cell.input.focus();
});

socket.on('opponent-left', () => {
  showResult('DÉCONNECTÉ', 'Ton adversaire a quitté la partie.', 'neutral', null, null);
  $('podium-opp').hidden = true;
});

/* ---------- Validation ---------- */

function submitCurrentWord() {
  const w = words.get(currentWord);
  if (!w || w.claimed) return;
  const letters = w.cells.map((k) => cells.get(k).input.value);
  if (letters.some((l) => !l)) {
    gameStatus.textContent = 'Remplis toutes les cases du mot avant de valider.';
    return;
  }
  socket.emit('submit-word', { roomId, wordId: w.id, letters: letters.join('') });
}

socket.on('word-claimed', ({
  wordId, letters, by, target, damage, hp,
}) => {
  const w = words.get(wordId);
  if (!w) return;
  w.claimed = true;
  w.cells.forEach((k, i) => {
    const cell = cells.get(k);
    cell.input.value = letters[i];
    cell.input.readOnly = true;
    cell.locked = true;
    // Une case croisée garde la couleur du premier mot trouvé.
    if (!cell.el.classList.contains('mine') && !cell.el.classList.contains('theirs')) {
      cell.el.classList.add(by === mySlot ? 'mine' : 'theirs');
    }
  });
  w.clueEl.classList.add(by === mySlot ? 'mine' : 'theirs');
  if (currentWord === wordId) buyBtn.disabled = true;
  setHp(hp);
  attackFx(by, target, letters.length, damage);
  gameStatus.textContent = by === mySlot
    ? `Bien vu ! ${damage} dégâts (${w.number})`
    : `${opponent ? opponent.pseudo : 'L\'adversaire'} trouve le ${w.number} et te frappe : -${damage} PV`;
  Sound.play(by === mySlot ? 'good' : 'theirs');

  // Si j'étais sur ce mot, je passe au prochain mot libre.
  if (currentWord === wordId) {
    const next = [...words.values()].find((x) => !x.claimed);
    if (next) selectWord(next.id, true);
  }
});

// Secondes restantes avant la fin d'un blocage (heure du serveur).
function secondsUntil(serverTime, serverNow) {
  return Math.max(1, Math.ceil((serverTime - serverNow) / 1000));
}

socket.on('word-wrong', ({
  wordId, damage, hp, lockedUntil, serverNow,
}) => {
  const w = words.get(wordId);
  setHp(hp);
  hitFx('me', damage, 'recoil');
  gameStatus.textContent = `Raté ! ${damage} dégâts de recul. Ce mot est bloqué ${secondsUntil(lockedUntil, serverNow)} s pour toi.`;
  Sound.play('bad');
  if (!w) return;
  w.cells.forEach((k) => {
    const el = cells.get(k).el;
    el.classList.remove('wrong');
    void el.offsetWidth; // relance l'animation
    el.classList.add('wrong');
    setTimeout(() => el.classList.remove('wrong'), 600);
  });
});

socket.on('word-locked', ({ lockedUntil, serverNow }) => {
  gameStatus.textContent = `Encore bloqué ${secondsUntil(lockedUntil, serverNow)} s : essaie un autre mot en attendant.`;
});

/* ---------- Acheter une lettre ---------- */

buyBtn.addEventListener('click', () => {
  const w = words.get(currentWord);
  if (!w || w.claimed || !roomId || startLocked || cinePlaying) return;
  socket.emit('buy-letter', { roomId, wordId: w.id });
  // On rend la main à la grille pour continuer à taper.
  const target = w.cells.find((k) => !cells.get(k).input.value) || w.cells[0];
  cells.get(target).input.focus();
});

socket.on('letter-revealed', ({
  wordId, index, letter, damage, hp,
}) => {
  Sound.play('blip');
  const w = words.get(wordId);
  setHp(hp);
  hitFx('me', damage, 'cost');
  if (!w) return;
  const cell = cells.get(w.cells[index]);
  cell.input.value = letter;
  cell.input.readOnly = true;
  cell.locked = true;
  cell.el.classList.add('bought');
  gameStatus.textContent = `Lettre achetée : ${letter} (-${damage} PV)`;
  // Si le curseur était sur cette case, on avance.
  if (document.activeElement === cell.input && currentWord === wordId) {
    const next = moveInWord(w.cells[index], writeStep());
    if (next) next.input.focus();
  }
});

/* ---------- Pouvoirs : celui que je lance ---------- */

function setPowerButton(left) {
  powerBtn.textContent = `${(POWER_NAMES[myAvatar] || 'Pouvoir').toUpperCase()} ×${left}`;
  powerBtn.disabled = left <= 0;
  setPips(boxMe, left);
}

powerBtn.addEventListener('click', () => {
  if (!roomId || startLocked || cinePlaying) return;
  socket.emit('use-power', { roomId });
  const w = words.get(currentWord);
  if (w) selectWord(w.id, true); // on rend la main à la grille
});

socket.on('power-used', ({
  power, remaining, cine, duration,
}) => {
  setPowerButton(remaining);
  gameStatus.textContent = `${POWER_NAMES[myAvatar]} lancé sur ${opponent ? opponent.pseudo : 'l\'adversaire'} !`;
  playCine(cine, () => {
    // Freeze : l'adversaire reste givré jusqu'à ce qu'il se dégivre.
    if (power === 'freeze') fighterOpp.classList.add('iced');
    if (power === 'verlan') startArenaFlip(duration || 20000);
  });
});

socket.on('power-refused', ({ reason }) => {
  gameStatus.textContent = reason;
});

/* ---------- Super attaque : vidéo plein écran, synchronisée par le serveur ---------- */

// Les 3 vidéos sont téléchargées en entier dès le début de la partie, pour se
// lancer sans délai. cineFiles[avatar] = adresse locale (blob) de la vidéo, ou
// 'missing' si elle n'existe pas (le flash blanc la remplacera).
const CINE_AVATARS = ['givre', 'perche', 'verlan'];
const cineFiles = {};
function preloadCinematics() {
  CINE_AVATARS.forEach((avatar) => {
    if (cineFiles[avatar]) return; // déjà en mémoire
    cineFiles[avatar] = 'loading';
    fetch(`assets/cine/${avatar}.webm`, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('absente'))))
      .then((blob) => { cineFiles[avatar] = URL.createObjectURL(blob); })
      .catch(() => { cineFiles[avatar] = 'missing'; });
  });
}

function stopCine() {
  cineTimers.forEach(clearTimeout);
  cineTimers = [];
  cineVideo.pause();
  cineVideo.removeAttribute('src');
  cineVideo.removeAttribute('poster');
  cineLayer.hidden = true;
  cineLayer.classList.remove('flash', 'ending');
  cinePlaying = false;
}

// Centre d'un élément à l'écran.
function centerOf(el) {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// cine = { avatar, at, serverNow } : la vidéo public/assets/cine/<avatar>.webm
// démarre à l'heure `at` du serveur, chez les deux joueurs. Si le fichier
// n'existe pas (encore), un flash blanc la remplace. done() est appelé à la fin.
// cine = { avatar, at, durationMs, resumeAt, endsAt, serverNow } (heures du serveur).
// La vidéo démarre à `at` chez les deux joueurs ; un flash blanc la termine ; à
// `resumeAt`, le serveur relance le chrono et la partie reprend. done() est
// appelé à ce moment-là.
function playCine(cine, done) {
  stopCine();
  if (!cine) { done(); return; }
  cinePlaying = true;
  // Écart d'horloge, mesuré à la réception : heure du serveur → heure locale.
  const offset = cine.serverNow - Date.now();
  const local = (serverTime) => Math.max(0, serverTime - offset - Date.now());
  pauseTimer();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopCine();
    cinePlaying = false;
    // Le chrono repart avec la fin de partie repoussée par le serveur.
    startTimer(cine.endsAt, Date.now() + offset, cine.endsAt - cine.resumeAt);
    done();
  };
  const endFlash = () => {
    cineLayer.hidden = false;
    cineLayer.classList.add('ending');
    cineVideo.pause();
  };

  const file = cineFiles[cine.avatar];
  const missing = !file || file === 'missing' || reducedMotion();
  if (!missing) {
    cineVideo.muted = Sound.isMuted();
    cineVideo.poster = `assets/cine/${cine.avatar}.jpg`;
    cineVideo.src = file === 'loading' ? `assets/cine/${cine.avatar}.webm` : file;
    cineVideo.load();
  }

  cineTimers.push(setTimeout(() => {
    cineLayer.hidden = false;
    if (missing) {
      cineLayer.classList.add('flash');
      Sound.play('impact');
      return;
    }
    cineVideo.currentTime = 0;
    cineVideo.play().catch(() => {
      // Lecture refusée (son bloqué par le navigateur) : on réessaie en muet.
      cineVideo.muted = true;
      cineVideo.play().catch(() => cineLayer.classList.add('flash'));
    });
  }, local(cine.at)));
  // Flash blanc de fin : à la fin de la vidéo, calée sur l'heure du serveur.
  if (!missing) cineTimers.push(setTimeout(endFlash, local(cine.resumeAt - CINE_END_FLASH_MS)));
  cineTimers.push(setTimeout(finish, local(cine.resumeAt)));
  // Sécurité : jamais bloqué plus de 20 s de plus que prévu.
  cineTimers.push(setTimeout(finish, local(cine.resumeAt) + CINE_MAX_MS));
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Pouvoirs : ceux que je reçois ---------- */

function announce(text) {
  gameStatus.textContent = text;
  gameStatus.classList.add('hit');
}

// Programme la fin d'un effet ; un deuxième coup du même pouvoir repart à zéro.
function endEffectLater(power, duration, stop) {
  clearTimeout(effectTimers[power] && effectTimers[power].timer);
  effectTimers[power] = { timer: setTimeout(() => { stop(); delete effectTimers[power]; }, duration), stop };
}

/* Freeze : avatar géant givré, à racler avec la souris (ou le doigt) */

const SCRAPE_MAX_MS = 400; // un coup de raclette doit traverser l'avatar en moins de 0,4 s
const SCRAPE_MIN_SPAN = 0.6; // ... et sur au moins 60 % de sa largeur
let lastPointer = null;
let stroke = null; // coup de raclette en cours : { start, last }

function setFrost(layers) {
  const frost = $('frost');
  [...frost.children].forEach((layer, i) => layer.classList.toggle('gone', i >= layers));
  $('frost-fill').style.width = `${Math.round((layers / frostMax) * 100)}%`;
  $('frost-left').textContent = layers > 0 ? `Encore ${layers} couche${layers > 1 ? 's' : ''} de givre sur ${frostMax}` : '';
}

// Points intermédiaires entre deux positions de la souris : un geste très
// rapide peut sauter l'avatar d'un coup, on vérifie donc tout le trajet.
function samplePath(a, b, steps = 8) {
  return Array.from({ length: steps }, (_, i) => {
    const f = (i + 1) / steps;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: a.t + (b.t - a.t) * f };
  });
}

function onScrapeMove(event) {
  const point = { x: event.clientX, y: event.clientY, t: performance.now() };
  const box = iceAvatar.getBoundingClientRect();
  const points = lastPointer ? samplePath(lastPointer, point) : [point];
  lastPointer = point;
  for (const q of points) {
    const inside = q.x >= box.left && q.x <= box.right && q.y >= box.top && q.y <= box.bottom;
    if (inside) {
      if (!stroke) stroke = { start: q, last: q };
      else stroke.last = q;
    } else if (stroke) {
      // On vient de ressortir de l'avatar : le coup compte s'il a été long et rapide.
      const span = Math.hypot(stroke.last.x - stroke.start.x, stroke.last.y - stroke.start.y);
      const time = stroke.last.t - stroke.start.t;
      if (span >= box.width * SCRAPE_MIN_SPAN && time <= SCRAPE_MAX_MS) scrapeHit();
      stroke = null;
    }
  }
}

function scrapeHit() {
  if (!roomId) return;
  socket.emit('scrape', { roomId });
  Sound.play('scrape');
  iceAvatar.classList.remove('scraped');
  void iceAvatar.offsetWidth; // relance l'animation
  iceAvatar.classList.add('scraped');
}

function stopFreeze() {
  frozenActive = false;
  freezeLayer.hidden = true;
  freezeLayer.classList.remove('thawing');
  document.removeEventListener('pointermove', onScrapeMove);
  lastPointer = null;
  stroke = null;
}

function startFreeze({ layers }) {
  frozenActive = true;
  frostMax = layers;
  avatarImg($('ice-sprite'), myAvatar);
  const frost = $('frost');
  frost.innerHTML = '';
  for (let i = 0; i < layers; i++) {
    const layer = document.createElement('div');
    layer.className = 'frost-layer';
    layer.style.setProperty('--i', i);
    frost.appendChild(layer);
  }
  setFrost(layers);
  freezeLayer.classList.remove('thawing');
  freezeLayer.hidden = false;
  document.addEventListener('pointermove', onScrapeMove);
  if (document.activeElement) document.activeElement.blur();
  // Pas de minuterie ici : c'est le serveur qui annonce le dégivrage ('unfrozen').
  effectTimers.freeze = { timer: null, stop: stopFreeze };
}

socket.on('frost', ({ layers }) => setFrost(layers));

socket.on('unfrozen', ({ slot }) => {
  if (slot === mySlot) {
    delete effectTimers.freeze;
    setFrost(0);
    freezeLayer.classList.add('thawing');
    Sound.play('thaw');
    gameStatus.classList.remove('hit');
    gameStatus.textContent = 'Dégivré ! À toi de jouer.';
    setTimeout(() => {
      stopFreeze();
      if (currentWord) selectWord(currentWord, true);
    }, 600);
  } else {
    fighterOpp.classList.remove('iced');
    const p = players.find((x) => x.slot === slot);
    gameStatus.textContent = `${p ? p.pseudo : 'L\'adversaire'} s'est dégivré !`;
  }
});

// Trip : le cercle net suit la souris, et la case où l'on tape.
function moveTripHole(x, y) {
  tripLayer.style.setProperty('--x', `${x}px`);
  tripLayer.style.setProperty('--y', `${y}px`);
}
function onTripMouse(event) { moveTripHole(event.clientX, event.clientY); }
function onTripFocus(event) {
  if (!event.target.dataset.key) return;
  const box = event.target.getBoundingClientRect();
  moveTripHole(box.left + box.width / 2, box.top + box.height / 2);
}
function stopTrip() {
  tripLayer.hidden = true;
  gameScreen.classList.remove('tripping');
  document.removeEventListener('pointermove', onTripMouse);
  board.removeEventListener('focusin', onTripFocus);
}
function startTrip(duration) {
  tripLayer.hidden = false;
  gameScreen.classList.add('tripping');
  document.addEventListener('pointermove', onTripMouse);
  board.addEventListener('focusin', onTripFocus);
  if (document.activeElement && document.activeElement.dataset.key) {
    onTripFocus({ target: document.activeElement });
  }
  endEffectLater('trip', duration, stopTrip);
}

// Verlan : écran retourné, et on écrit les mots par la fin.
function stopVerlan() {
  verlanActive = false;
  gameScreen.classList.remove('verlan');
  arena.classList.remove('upside-down');
}
function startVerlan(duration) {
  verlanActive = true;
  gameScreen.classList.add('verlan');
  arena.classList.add('upside-down');
  if (currentWord) selectWord(currentWord, true);
  endEffectLater('verlan', duration, stopVerlan);
}

// Chez celui qui lance le Verlan : seul le décor de l'arène se retourne.
function startArenaFlip(duration) {
  arena.classList.add('upside-down');
  endEffectLater('arena-flip', duration, () => arena.classList.remove('upside-down'));
}

function clearEffects() {
  stopCine();
  for (const power of Object.keys(effectTimers)) {
    if (effectTimers[power].timer) clearTimeout(effectTimers[power].timer);
    effectTimers[power].stop();
    delete effectTimers[power];
  }
  gameStatus.classList.remove('hit');
}

socket.on('power-hit', ({
  power, duration, payload, from, cine,
}) => {
  oppPowersLeft = Math.max(0, oppPowersLeft - 1);
  setPips(boxOpp, oppPowersLeft);
  announce(`${from} lance une super attaque !`);
  // D'abord la vidéo de super attaque (vue aussi par celui qui la lance), puis l'effet.
  playCine(cine, () => {
    if (power === 'freeze') {
      startFreeze(payload);
      announce(`${from} t'a gelé ! Racle ton givre pour rejouer.`);
    } else if (power === 'trip') {
      startTrip(duration);
      announce(`${from} t'a lancé un Trip : promène ta souris pour voir net !`);
    } else if (power === 'verlan') {
      startVerlan(duration);
      announce(`${from} t'a lancé un Verlan : tout est à l'envers, écris par la fin !`);
    }
    if (power !== 'freeze') setTimeout(() => gameStatus.classList.remove('hit'), duration);
  });
});

// L'adversaire s'est trompé ou a acheté une lettre : on voit ses PV baisser.
socket.on('hp', ({ target, damage, hp }) => {
  setHp(hp);
  hitFx(sideOf(target), damage, 'recoil');
});
