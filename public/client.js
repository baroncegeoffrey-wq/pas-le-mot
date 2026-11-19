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

// Nom du pouvoir de chaque avatar (affiché sur le bouton).
const POWER_NAMES = { givre: 'Freeze', perche: 'Trip', verlan: 'Verlan' };

// État de la partie en cours
let roomId = null;
let mySlot = null;
let words = new Map(); // wordId -> { id, number, direction, cells: ["r,c", ...] }
let cells = new Map(); // "r,c" -> { el, input, across, down, locked }
let currentWord = null; // wordId sélectionné
let players = []; // [{ pseudo, slot }] rangés par slot (un seul en solo)
let lastMode = 'duo'; // 'duo' ou 'solo' : ce que relance le bouton Rejouer
let timerInterval = null;
let clockOffset = 0; // heure du serveur - heure locale
let myAvatar = null;
let verlanActive = false; // pendant le Verlan, on écrit les mots par la fin
const effectTimers = {}; // pouvoir reçu -> minuterie de fin de l'effet

// Sens d'écriture : 1 = du début vers la fin du mot, -1 = par la fin (Verlan).
const writeStep = () => (verlanActive ? -1 : 1);

const key = (r, c) => `${r},${c}`;

// Retire les accents et garde une seule lettre majuscule (ou '').
function cleanLetter(text) {
  const letter = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  return letter.slice(-1);
}

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

socket.on('connect', () => {
  statusText.textContent = 'Connecté. Choisis un pseudo.';
  findBtn.disabled = false;
  soloBtn.disabled = false;
});
socket.on('disconnect', () => {
  statusText.textContent = 'Déconnecté du serveur';
  gameStatus.textContent = 'Déconnecté du serveur';
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

socket.on('waiting', () => {
  statusText.textContent = 'En attente d\'un adversaire...';
});

/* ---------- Début de partie : construction de la grille ---------- */

socket.on('game-start', (data) => {
  roomId = data.roomId;
  mySlot = data.you.slot;
  players = [data.you, data.opponent].filter(Boolean).sort((a, b) => a.slot - b.slot);

  // En solo, la case de l'adversaire est cachée.
  $('player-1').hidden = !data.opponent;
  for (const p of players) {
    const box = $(`player-${p.slot}`);
    box.querySelector('.name').textContent = p.pseudo;
    box.querySelector('.badge').className = `badge ${p.avatar}`;
    box.querySelector('.score').textContent = '0';
    box.classList.toggle('me', p.slot === mySlot);
  }

  clearEffects();
  myAvatar = data.you.avatar;
  setPowerButton(data.opponent ? data.you.powersLeft : 0);
  powerBtn.hidden = !data.opponent; // pas de pouvoir en solo

  buildBoard(data.grid);
  buildClues(data.clues);
  gameStatus.textContent = 'Remplis un mot puis appuie sur Entrée.';
  lobby.hidden = true;
  resultScreen.hidden = true;
  gameScreen.hidden = false;
  selectWord(data.grid.words[0].id, true);
  startTimer(data.endsAt, data.serverNow);
});

/* ---------- Chrono (affichage seulement : c'est le serveur qui arrête la partie) ---------- */

function startTimer(endsAt, serverNow) {
  clearInterval(timerInterval);
  clockOffset = serverNow - Date.now(); // écart entre l'horloge du serveur et la nôtre
  const tick = () => {
    const left = Math.max(0, endsAt - (Date.now() + clockOffset));
    const seconds = Math.ceil(left / 1000);
    timerEl.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    timerEl.classList.toggle('low', seconds <= 30);
    if (left === 0) clearInterval(timerInterval);
  };
  tick();
  timerInterval = setInterval(tick, 250);
}

/* ---------- Fin de partie ---------- */

function showResult(title, detail) {
  clearInterval(timerInterval);
  clearEffects();
  roomId = null;
  $('result-title').textContent = title;
  $('result-detail').textContent = detail;
  gameScreen.hidden = true;
  lobby.hidden = true;
  resultScreen.hidden = false;
  findBtn.disabled = false;
  soloBtn.disabled = false;
  $('replay-btn').focus();
}

socket.on('game-over', ({ scores, winner, found, total }) => {
  if (players.length === 1) {
    showResult('Partie terminée', `Score : ${scores[0]}  ·  ${found} mot${found > 1 ? 's' : ''} trouvé${found > 1 ? 's' : ''} sur ${total}`);
    return;
  }
  const title = winner === null ? 'Égalité !' : (winner === mySlot ? 'Gagné !' : 'Perdu...');
  const detail = players.map((p) => `${p.pseudo} : ${scores[p.slot]}`).join('  ·  ');
  showResult(title, detail);
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
    li.append(n, document.createTextNode(clue.clue));
    li.addEventListener('click', () => selectWord(clue.wordId, true));
    $(`clues-${clue.direction}`).appendChild(li);
    words.get(clue.wordId).clueEl = li;
  }
}

/* ---------- Sélection d'un mot et déplacement ---------- */

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

  if (focusFirstEmpty) {
    // En Verlan, on commence par la dernière case du mot.
    const order = verlanActive ? [...w.cells].reverse() : w.cells;
    const target = order.find((k) => !cells.get(k).input.value && !cells.get(k).frozen) || order[0];
    cells.get(target).input.focus();
  }
}

// Avance (step = 1) ou recule (step = -1) dans le mot courant, en sautant les
// cases déjà verrouillées ou gelées.
function moveInWord(fromKey, step) {
  const w = words.get(currentWord);
  let i = w.cells.indexOf(fromKey) + step;
  while (i >= 0 && i < w.cells.length) {
    const cell = cells.get(w.cells[i]);
    if (!cell.locked && !cell.frozen) return cell;
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
  const cell = cells.get(k);
  const [r, c] = k.split(',').map(Number);

  if (event.key === 'Enter') {
    event.preventDefault();
    submitCurrentWord();
    return;
  }

  if (event.key === 'Backspace') {
    event.preventDefault();
    if (!cell.locked && !cell.frozen && cell.input.value) {
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
    if (!letter || cell.locked || cell.frozen) return;
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
  if (cell.locked || cell.frozen) {
    cell.input.value = cell.locked ? cell.input.value : '';
    return;
  }
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
  showResult('Adversaire déconnecté', 'Ton adversaire a quitté la partie.');
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
  scores.forEach((s, slot) => { $(`player-${slot}`).querySelector('.score').textContent = s; });
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
    cell.frozen = false;
    cell.el.classList.remove('frozen');
    // Une case croisée garde la couleur du premier mot trouvé.
    if (!cell.el.classList.contains('p0') && !cell.el.classList.contains('p1')) {
      cell.el.classList.add(`p${by}`);
    }
  });
  w.clueEl.classList.add(`p${by}`);
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

socket.on('word-locked', ({ lockedUntil, serverNow, reason }) => {
  const seconds = secondsUntil(lockedUntil, serverNow);
  gameStatus.textContent = reason === 'freeze'
    ? `Ce mot passe par une case gelée : attends ${seconds} s.`
    : `Encore bloqué ${seconds} s : essaie un autre mot en attendant.`;
});

/* ---------- Acheter une lettre ---------- */

buyBtn.addEventListener('click', () => {
  const w = words.get(currentWord);
  if (!w || w.claimed || !roomId) return;
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
  powerBtn.className = myAvatar || '';
  powerBtn.textContent = `${POWER_NAMES[myAvatar] || 'Pouvoir'} (${left})`;
  powerBtn.disabled = left <= 0;
}

powerBtn.addEventListener('click', () => {
  if (!roomId) return;
  socket.emit('use-power', { roomId });
  const w = words.get(currentWord);
  if (w) selectWord(w.id, true); // on rend la main à la grille
});

socket.on('power-used', ({ remaining }) => {
  setPowerButton(remaining);
  gameStatus.textContent = `${POWER_NAMES[myAvatar]} lancé sur l'adversaire !`;
});

socket.on('power-refused', ({ reason }) => {
  gameStatus.textContent = reason;
});

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

function unfreezeAll() {
  for (const cell of cells.values()) {
    if (!cell.frozen) continue;
    cell.frozen = false;
    cell.el.classList.remove('frozen');
    cell.input.readOnly = cell.locked;
  }
}

// Freeze : ces cases deviennent impossibles à remplir.
function startFreeze({ cells: frozenCells }, duration) {
  unfreezeAll();
  for (const { row, col } of frozenCells || []) {
    const cell = cells.get(key(row, col));
    if (!cell || cell.locked) continue;
    cell.frozen = true;
    cell.input.value = '';
    cell.input.readOnly = true;
    cell.el.classList.add('frozen');
  }
  endEffectLater('freeze', duration, unfreezeAll);
}

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
  for (const power of Object.keys(effectTimers)) {
    clearTimeout(effectTimers[power].timer);
    effectTimers[power].stop();
    delete effectTimers[power];
  }
  gameStatus.classList.remove('hit');
}

socket.on('power-hit', ({ power, duration, payload, from }) => {
  if (power === 'freeze') {
    startFreeze(payload, duration);
    announce(`${from} t'a lancé un Freeze : 3 cases gelées !`);
  } else if (power === 'trip') {
    startTrip(duration);
    announce(`${from} t'a lancé un Trip : promène ta souris pour voir net !`);
  } else if (power === 'verlan') {
    startVerlan(duration);
    announce(`${from} t'a lancé un Verlan : tout est à l'envers, écris par la fin !`);
  }
  setTimeout(() => gameStatus.classList.remove('hit'), duration);
});

socket.on('scores', ({ scores }) => setScores(scores));
