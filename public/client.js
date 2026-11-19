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
const pseudoInput = $('pseudo');
const board = $('board');
const timerEl = $('timer');
const resultScreen = $('result');
const buyBtn = $('buy-btn');
const powerBtn = $('power-btn');
const tripLayer = $('trip');
const freezeLayer = $('freeze');
const iceAvatar = $('ice-avatar');
const fxLayer = $('fx');
const fxTemplate = $('fx-template');
const arena = $('arena');
const boxMe = $('box-me');
const boxOpp = $('box-opp');
const fighterMe = $('fighter-me');
const fighterOpp = $('fighter-opp');

const USES_PER_GAME = 2;
const SPRITE_PX = 8; // taille des personnages dans l'arène (16 × 8 = 128 px)
// Couleurs de chaque super attaque (cœur et halo du rayon).
const ATTACK_LOOK = {
  freeze: { c1: '#00e5ff', c2: '#bfefff' },
  trip: { c1: '#b57bf0', c2: '#ff7ad9' },
  verlan: { c1: '#ff8a00', c2: '#f5e100' },
};
const CUTIN_MS = 1200; // cinématique
const BEAM_MS = 1500; // rayon jusqu'à l'impact et sa fin
const IMPACT_MS = 620; // moment de l'impact dans le rayon

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
let fxTimers = []; // minuteries de la super attaque en cours
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

/* ---------- Accueil et recherche de partie ---------- */

// Les personnages des cartes d'avatar.
document.querySelectorAll('canvas.sprite[data-who]').forEach((canvas) => {
  drawSprite(canvas, canvas.dataset.who, Number(canvas.dataset.px) || 6);
});

try {
  pseudoInput.value = localStorage.getItem('pseudo') || '';
  const saved = findForm.querySelector(`input[name="avatar"][value="${localStorage.getItem('avatar')}"]`);
  if (saved) saved.checked = true;
} catch (e) { /* stockage indisponible */ }

findForm.addEventListener('change', (event) => {
  if (event.target.name !== 'avatar') return;
  try { localStorage.setItem('avatar', event.target.value); } catch (e) { /* tant pis */ }
});

socket.on('connect', () => {
  statusText.textContent = 'Connecté. Choisis un pseudo et ton avatar.';
  findBtn.disabled = false;
  soloBtn.disabled = false;
});
socket.on('disconnect', () => {
  statusText.textContent = 'Connexion au serveur perdue, reconnexion...';
  findBtn.disabled = true;
  soloBtn.disabled = true;
  // En pleine partie, la partie est perdue côté serveur : on le dit clairement
  // au lieu de laisser un écran qui ne répond plus.
  if (roomId) {
    showResult('CONNEXION PERDUE', 'La connexion au serveur a coupé, la partie est annulée. Relance-en une.', 'neutral', null, null);
    $('podium-opp').hidden = true;
    findBtn.disabled = true;
    soloBtn.disabled = true;
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
  findBtn.disabled = true;
  statusText.textContent = 'Recherche d\'un adversaire...';
}

function playSolo() {
  lastMode = 'solo';
  socket.emit('play-solo', { pseudo: pseudoInput.value.trim(), avatar: chosenAvatar() });
}

soloBtn.addEventListener('click', () => {
  const pseudo = pseudoInput.value.trim();
  if (!pseudo) { pseudoInput.reportValidity(); return; }
  try { localStorage.setItem('pseudo', pseudo); } catch (e) { /* tant pis */ }
  playSolo();
});

// Revient à l'accueil et relance une partie du même type, avec le même pseudo.
$('replay-btn').addEventListener('click', () => {
  resultScreen.hidden = true;
  gameScreen.hidden = true;
  lobby.hidden = false;
  if (lastMode === 'solo') playSolo();
  else findGame();
});

// Revient à l'accueil sans relancer de partie.
$('home-btn').addEventListener('click', () => {
  resultScreen.hidden = true;
  gameScreen.hidden = true;
  lobby.hidden = false;
  statusText.textContent = 'Choisis ton avatar et relance une partie.';
});

socket.on('waiting', () => {
  statusText.textContent = 'En attente d\'un adversaire...';
});

/* ---------- Début de partie : construction de la grille ---------- */

socket.on('game-start', (data) => {
  roomId = data.roomId;
  mySlot = data.you.slot;
  players = [data.you, data.opponent].filter(Boolean).sort((a, b) => a.slot - b.slot);
  opponent = data.opponent;

  clearEffects();
  myAvatar = data.you.avatar;
  oppPowersLeft = opponent ? USES_PER_GAME : 0;

  // L'arène : moi à gauche, l'adversaire à droite (caché en solo).
  fillPlayerBox(boxMe, data.you, true, data.opponent ? data.you.powersLeft : 0);
  drawSprite(fighterMe.querySelector('canvas'), data.you.avatar, SPRITE_PX);
  boxOpp.hidden = !opponent;
  fighterOpp.parentElement.hidden = !opponent;
  if (opponent) {
    fillPlayerBox(boxOpp, opponent, false, oppPowersLeft);
    drawSprite(fighterOpp.querySelector('canvas'), opponent.avatar, SPRITE_PX);
  }
  fighterMe.classList.remove('iced', 'hit');
  fighterOpp.classList.remove('iced', 'hit');
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
  box.querySelector('.score').textContent = '0';
  box.querySelector('.avatar-label').textContent = `${SPRITES[player.avatar].name}${isMe ? ' · toi' : ''}`;
  setPips(box, powersLeft);
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
}

function clearStress() {
  lastStressSecond = null;
  document.body.classList.remove('stress-30', 'stress-20', 'stress-10');
  $('stress-alert').classList.remove('show');
  $('countdown').classList.remove('tick');
}

/* ---------- Chrono (affichage seulement : c'est le serveur qui arrête la partie) ---------- */

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
// scores : les scores par slot, ou null quand il n'y a pas de podium à montrer.
function showResult(title, detail, tone, scores, winner, extra = {}) {
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
  fillPodium($('podium-me'), me, scores, winner);
  const showOpp = Boolean(opponent && scores && scores.length > 1);
  $('podium-opp').hidden = !showOpp;
  if (showOpp) fillPodium($('podium-opp'), opponent, scores, winner);

  gameScreen.hidden = true;
  lobby.hidden = true;
  resultScreen.hidden = false;
  findBtn.disabled = false;
  soloBtn.disabled = false;
  $('replay-btn').focus();
}

function fillPodium(card, player, scores, winner) {
  const big = winner === null || winner === undefined || winner === player.slot;
  drawSprite(card.querySelector('canvas'), player.avatar, big ? 11 : 8);
  card.querySelector('.name').textContent = player.pseudo.toUpperCase();
  card.querySelector('.score').textContent = scores ? scores[player.slot] ?? scores[0] : '';
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

socket.on('game-over', ({ scores, winner, found, total, stats, solutions }) => {
  const extra = { stats, solutions };
  if (players.length === 1) {
    const words = `${found} mot${found > 1 ? 's' : ''} trouvé${found > 1 ? 's' : ''} sur ${total}`;
    showResult('PARTIE TERMINÉE', `Score : ${scores[0]}  ·  ${words}`, 'neutral', scores, null, extra);
    return;
  }
  const me = players.find((p) => p.slot === mySlot);
  if (winner === null) {
    showResult('ÉGALITÉ !', `${scores[0]} partout`, 'draw', scores, null, extra);
  } else if (winner === mySlot) {
    showResult('GAGNÉ !', `${me.pseudo} remporte la manche, ${scores[mySlot]} à ${scores[1 - mySlot]}`, 'win', scores, winner, extra);
  } else {
    showResult('PERDU...', `${opponent.pseudo} remporte la manche, ${scores[1 - mySlot]} à ${scores[mySlot]}`, 'lose', scores, winner, extra);
  }
});

function buildBoard(grid) {
  words = new Map();
  cells = new Map();
  board.innerHTML = '';
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
  if (frozenActive || startLocked) { event.preventDefault(); return; }
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
  if (frozenActive || startLocked) { cell.input.value = ''; return; }
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

function setScores(scores) {
  scores.forEach((score, slot) => {
    if (slot !== mySlot && !opponent) return;
    boxOf(slot).querySelector('.score').textContent = score;
  });
}

socket.on('word-claimed', ({ wordId, letters, by, scores }) => {
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
  setScores(scores);
  gameStatus.textContent = by === mySlot ? `Bien vu ! +1 (${w.number})` : `L'adversaire a trouvé le ${w.number}.`;

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

socket.on('word-wrong', ({ wordId, scores, lockedUntil, serverNow }) => {
  const w = words.get(wordId);
  setScores(scores);
  gameStatus.textContent = `Raté ! -1. Ce mot est bloqué ${secondsUntil(lockedUntil, serverNow)} s pour toi.`;
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
  if (!w || w.claimed || !roomId || startLocked) return;
  socket.emit('buy-letter', { roomId, wordId: w.id });
  // On rend la main à la grille pour continuer à taper.
  const target = w.cells.find((k) => !cells.get(k).input.value) || w.cells[0];
  cells.get(target).input.focus();
});

socket.on('letter-revealed', ({ wordId, index, letter, scores }) => {
  const w = words.get(wordId);
  setScores(scores);
  if (!w) return;
  const cell = cells.get(w.cells[index]);
  cell.input.value = letter;
  cell.input.readOnly = true;
  cell.locked = true;
  cell.el.classList.add('bought');
  gameStatus.textContent = `Lettre achetée : ${letter} (-1)`;
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
  if (!roomId || startLocked) return;
  socket.emit('use-power', { roomId });
  const w = words.get(currentWord);
  if (w) selectWord(w.id, true); // on rend la main à la grille
});

socket.on('power-used', ({ power, remaining }) => {
  setPowerButton(remaining);
  gameStatus.textContent = `${POWER_NAMES[myAvatar]} lancé sur ${opponent ? opponent.pseudo : 'l\'adversaire'} !`;
  playSuperAttack('me', myAvatar, power, () => {
    // Freeze : l'adversaire reste givré jusqu'à ce qu'il se dégivre.
    if (power === 'freeze') fighterOpp.classList.add('iced');
  });
});

socket.on('power-refused', ({ reason }) => {
  gameStatus.textContent = reason;
});

/* ---------- Super attaque : cinématique puis rayon géant ---------- */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function stopFx() {
  fxTimers.forEach(clearTimeout);
  fxTimers = [];
  fxLayer.hidden = true;
  fxLayer.className = '';
  fxLayer.innerHTML = '';
}

// Centre d'un élément à l'écran.
function centerOf(el) {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

// side : 'me' (je lance, le rayon part de ma plateforme) ou 'opp' (je reçois).
// done() est appelé à la fin de l'animation.
function playSuperAttack(side, avatar, power, done) {
  stopFx();
  if (reducedMotion() || !opponent) { done(); return; }

  const look = ATTACK_LOOK[power] || ATTACK_LOOK.freeze;
  fxLayer.appendChild(fxTemplate.content.cloneNode(true));
  fxLayer.style.setProperty('--c1', look.c1);
  fxLayer.style.setProperty('--c2', look.c2);
  fxLayer.style.setProperty('--band', side === 'me' ? 'var(--acid)' : 'var(--pink)');
  drawSprite(fxLayer.querySelector('.cutin-hero canvas'), avatar, 15);
  fxLayer.querySelector('.cutin-name').textContent = (POWER_NAMES[avatar] || '').toUpperCase();
  fxLayer.querySelector('.cutin-sub').textContent = `${SPRITES[avatar].name.toUpperCase()} · SUPER ATTAQUE`;

  // Le rayon va du lanceur à la cible, quelle que soit la position à l'écran.
  const shooter = side === 'me' ? fighterMe : fighterOpp;
  const target = side === 'me' ? fighterOpp : fighterMe;
  const from = centerOf(shooter);
  const to = centerOf(target);
  fxLayer.style.setProperty('--bx', `${from.x}px`);
  fxLayer.style.setProperty('--by', `${from.y}px`);
  fxLayer.style.setProperty('--dist', `${Math.abs(to.x - from.x)}px`);
  fxLayer.querySelector('.beam-wrap').classList.toggle('reverse', to.x < from.x);

  fxLayer.hidden = false;
  fxLayer.className = 'phase-cutin';
  fxTimers.push(setTimeout(() => {
    fxLayer.className = 'phase-beam';
    arena.classList.remove('quake');
    void arena.offsetWidth; // relance l'animation
    arena.classList.add('quake');
  }, CUTIN_MS));
  fxTimers.push(setTimeout(() => {
    target.classList.remove('hit');
    void target.offsetWidth;
    target.classList.add('hit');
  }, CUTIN_MS + IMPACT_MS));
  fxTimers.push(setTimeout(() => {
    stopFx();
    arena.classList.remove('quake');
    target.classList.remove('hit');
    done();
  }, CUTIN_MS + BEAM_MS));
}

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
  drawSprite($('ice-sprite'), myAvatar, 14);
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
  document.removeEventListener('mousemove', onTripMouse);
  board.removeEventListener('focusin', onTripFocus);
}
function startTrip(duration) {
  tripLayer.hidden = false;
  gameScreen.classList.add('tripping');
  document.addEventListener('mousemove', onTripMouse);
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
}
function startVerlan(duration) {
  verlanActive = true;
  gameScreen.classList.add('verlan');
  if (currentWord) selectWord(currentWord, true);
  endEffectLater('verlan', duration, stopVerlan);
}

function clearEffects() {
  stopFx();
  for (const power of Object.keys(effectTimers)) {
    if (effectTimers[power].timer) clearTimeout(effectTimers[power].timer);
    effectTimers[power].stop();
    delete effectTimers[power];
  }
  gameStatus.classList.remove('hit');
}

socket.on('power-hit', ({ power, duration, payload, from }) => {
  oppPowersLeft = Math.max(0, oppPowersLeft - 1);
  setPips(boxOpp, oppPowersLeft);
  announce(`${from} lance une super attaque !`);
  // D'abord la super attaque (vue aussi par celui qui la lance), puis l'effet.
  playSuperAttack('opp', opponent ? opponent.avatar : 'givre', power, () => {
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

socket.on('scores', ({ scores }) => setScores(scores));
