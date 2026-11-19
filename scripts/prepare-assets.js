#!/usr/bin/env node
// Prépare les images et vidéos du jeu à partir des fichiers bruts.
//
//   node scripts/prepare-assets.js [dossier-source] [dossier-sortie]
//
// Par défaut : source = ~/Documents/01-Projets/pas-le-mot/assets-src/
//              sortie = public/assets/
//
// Ce que fait le script (il utilise ffmpeg, qui doit être installé) :
// - Sprites (.jpeg .jpg .png .webp, ex. givre.jpeg, perche.jpeg, verlan.jpeg) :
//   * le fond est retiré par un remplissage qui part des BORDS de l'image (avec
//     une tolérance de couleur) : seul le fond relié aux bords disparaît. Une
//     couleur proche du fond à l'intérieur du perso (la fumée verte du Perché)
//     est donc gardée, contrairement à une suppression globale du vert ;
//   * l'image est recadrée au plus près du perso ;
//   * puis réduite à 160 px de haut sans lissage (pixels nets) dans
//     <sortie>/avatars/<nom>.png.
// - Arène (fichiers dont le nom commence par « arene », « fond » ou « bg ») :
//   * arene.gif devient <sortie>/arena/arene.webm, une vidéo qui boucle, agrandie
//     sans lissage (pixels nets) ;
//   * arene.jpeg devient <sortie>/arena/arene.png, l'image de secours (même
//     agrandissement), affichée si la vidéo ne se lit pas.
// - Cinématiques de super attaque (givre-cine.mp4, perche-cine.mp4,
//   verlan-cine.mp4) : gardées en entier ; seules les images vraiment vides
//   (noires) ou figées au tout début et à la toute fin sont coupées, 0,5 s
//   maximum de chaque côté. Converties en .webm 720p (VP9 + Opus, bonne
//   qualité, 4 Mo maximum) dans <sortie>/cine/givre.webm, etc. Leurs durées
//   sont écrites dans <sortie>/cine/durations.json (le serveur s'en sert pour
//   mettre le chrono en pause pendant la vidéo).
// - Images des cinématiques (givre-cine.jpeg...) : réduites à 1280 px de large,
//   dans <sortie>/cine/givre.jpg : affichées le temps que la vidéo démarre.
// - Persos animés (givre.gif, perche.gif, verlan.gif) : le fond est retiré
//   IMAGE PAR IMAGE (même remplissage depuis les bords que les sprites fixes),
//   toutes les images sont recadrées sur la même zone (le perso ne saute pas),
//   réduites à 160 px de haut sans lissage, puis réunies en WebP animé
//   transparent qui boucle : <sortie>/avatars/givre.webp. Les .png des .jpeg
//   restent en secours.
// - Mini-cinématiques de coup critique (givre-cine.gif...) : .webm de moins de
//   1,5 Mo, sans son, dans <sortie>/cine/givre-crit.webm.
//
// Pour ne refaire qu'une partie : ONLY=gif npm run assets (filtre sur le nom).
//
// Réglage : BG_TOLERANCE=60 node scripts/prepare-assets.js pour retirer plus
// ou moins de fond autour de TOUS les persos (sinon : voir TOLERANCE_BY_SPRITE).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents/01-Projets/pas-le-mot/assets-src'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public', 'assets'));

const SPRITE_HEIGHT = 160;
const ARENA_MIN_WIDTH = 1280; // l'arène est agrandie (facteur entier) jusqu'à au moins cette largeur
const ARENA_MAX_WIDTH = 2560;
const VIDEO_HEIGHT = 720; // cinématiques en 720p
const VIDEO_MAX_BYTES = 4 * 1024 * 1024; // 4 Mo maximum par cinématique
const AUDIO_KBPS = 96;
const CRIT_MAX_BYTES = 1.5 * 1024 * 1024; // mini-cinématique de coup critique : 1,5 Mo maximum
const MAX_EDGE_TRIM = 0.5; // on ne coupe jamais plus de 0,5 s au début ni à la fin
// Tolérance de couleur pour le remplissage du fond (distance RVB, de 0 à 441).
// 70 retire bien le fond vert et son halo. Le Perché a de la fumée verte proche
// du fond (distance 40 à 55, le bruit du fond allant jusqu'à 30) : 34 la garde.
const DEFAULT_TOLERANCE = 70;
const TOLERANCE_BY_SPRITE = { perche: 34 };
const toleranceFor = (name) => Number(process.env.BG_TOLERANCE) || TOLERANCE_BY_SPRITE[name] || DEFAULT_TOLERANCE;
// Poches de fond enfermées (ex. entre un bras et le corps) : retirées seulement
// si elles sont TRÈS proches du fond (tolérance serrée, 3/4 de celle du fond)
// et assez grandes, pour ne jamais toucher à la fumée verte du Perché.
const HOLE_SHARE_OF_TOLERANCE = 0.75;
const HOLE_MIN_SHARE = 0.0004; // taille minimale d'une poche : 0,04 % de l'image

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ARENA_NAME = /^(fond|arene|arène|bg)/i;
const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm']);

function run(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} a échoué :\n${(res.stderr || '').split('\n').slice(-6).join('\n')}`);
  return res.stdout;
}

function checkFfmpeg() {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const res = spawnSync(tool, ['-version']);
    if (res.error) {
      console.error(`${tool} est introuvable. Installe ffmpeg (ex. : sudo apt install ffmpeg), puis relance.`);
      process.exit(1);
    }
  }
}

// « givre-cine.mp4 » → « givre » : le nom de l'avatar, sans le suffixe -cine.
const cineName = (file) => slug(file).replace(/-cine$/, '');

const slug = (file) => path.basename(file, path.extname(file))
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function sizeOf(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file]);
  const [w, h] = out.trim().split('x').map(Number);
  if (!w || !h) throw new Error(`taille illisible pour ${file}`);
  return { w, h };
}

// Décode une image en pixels bruts RVBA (4 octets par pixel), avec ffmpeg.
function readPixels(file) {
  const { w, h } = sizeOf(file);
  const res = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 1024 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`lecture impossible : ${String(res.stderr).slice(-300)}`);
  if (res.stdout.length !== w * h * 4) throw new Error('taille de pixels inattendue');
  return { w, h, data: res.stdout };
}

// Couleur du fond : la médiane (canal par canal) des pixels du bord de l'image.
function borderColor({ w, h, data }) {
  const r = []; const g = []; const b = [];
  const take = (x, y) => { const i = (y * w + x) * 4; r.push(data[i]); g.push(data[i + 1]); b.push(data[i + 2]); };
  for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y++) { take(0, y); take(w - 1, y); }
  const median = (list) => list.sort((a, c) => a - c)[Math.floor(list.length / 2)];
  return [median(r), median(g), median(b)];
}

// Remplissage depuis les bords : on part de chaque pixel du bord proche de la
// couleur du fond, et on s'étend aux voisins proches de cette couleur. Ce qui
// est atteint devient transparent. Le reste (le perso, et la fumée verte au
// milieu) est gardé. Renvoie le nombre de pixels retirés.
function floodRemoveBackground(img, tolerance) {
  const { w, h, data } = img;
  const [br, bg, bb] = borderColor(img);
  const tol2 = tolerance * tolerance;
  const near = (p, t2) => {
    const i = p * 4;
    const dr = data[i] - br; const dg = data[i + 1] - bg; const db = data[i + 2] - bb;
    return dr * dr + dg * dg + db * db <= t2;
  };
  const removed = new Uint8Array(w * h);
  const stack = [];
  const seed = (x, y) => { const p = y * w + x; if (!removed[p] && near(p, tol2)) { removed[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % w; const y = (p - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
  // Liseré : un pixel gardé, collé au fond retiré et encore assez proche du fond
  // (bavure du JPEG autour du perso), est retiré lui aussi. Un seul passage.
  const fringe = [];
  const tolFringe2 = tol2 * 2.25; // tolérance × 1,5
  for (let p = 0; p < w * h; p++) {
    if (removed[p]) continue;
    const x = p % w; const y = (p - x) / w;
    const touches = (x > 0 && removed[p - 1]) || (x < w - 1 && removed[p + 1])
      || (y > 0 && removed[p - w]) || (y < h - 1 && removed[p + w]);
    if (touches && near(p, tolFringe2)) fringe.push(p);
  }
  fringe.forEach((p) => { removed[p] = 1; });

  // Poches enfermées : morceaux de fond qui ne touchent pas les bords.
  const holeTol = Math.min(32, tolerance * HOLE_SHARE_OF_TOLERANCE);
  const holeTol2 = holeTol * holeTol;
  const minHole = Math.max(50, Math.round(w * h * HOLE_MIN_SHARE));
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (removed[start] || seen[start] || !near(start, holeTol2)) continue;
    const pocket = [start];
    seen[start] = 1;
    for (let k = 0; k < pocket.length; k++) {
      const p = pocket[k];
      const x = p % w; const y = (p - x) / w;
      const visit = (q) => { if (!removed[q] && !seen[q] && near(q, holeTol2)) { seen[q] = 1; pocket.push(q); } };
      if (x > 0) visit(p - 1);
      if (x < w - 1) visit(p + 1);
      if (y > 0) visit(p - w);
      if (y < h - 1) visit(p + w);
    }
    if (pocket.length >= minHole) pocket.forEach((p) => { removed[p] = 1; });
  }

  let count = 0;
  for (let p = 0; p < w * h; p++) {
    if (removed[p]) { data[p * 4 + 3] = 0; count++; }
  }
  return count;
}

// Recadre au plus près des pixels visibles (le perso).
function cropToContent({ w, h, data }) {
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('plus rien après le retrait du fond : baisse BG_TOLERANCE');
  const cw = maxX - minX + 1; const ch = maxY - minY + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    data.copy(out, y * cw * 4, ((minY + y) * w + minX) * 4, ((minY + y) * w + maxX + 1) * 4);
  }
  return { w: cw, h: ch, data: out };
}

// Écrit des pixels RVBA en PNG, réduits à `height` px de haut sans lissage.
function writeScaledPng({ w, h, data }, height, out) {
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-',
    '-vf', `scale=-2:${height}:flags=neighbor`, '-frames:v', '1', '-pix_fmt', 'rgba', out], { input: data, maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`écriture impossible : ${String(res.stderr).slice(-300)}`);
}

function prepareSprite(file) {
  const out = path.join(OUT, 'avatars', `${slug(file)}.png`);
  const img = readPixels(file);
  const tolerance = toleranceFor(slug(file));
  const removed = floodRemoveBackground(img, tolerance);
  const cropped = cropToContent(img);
  writeScaledPng(cropped, SPRITE_HEIGHT, out);
  return { out, detail: `fond retiré (${Math.round((100 * removed) / (img.w * img.h))} %, tolérance ${tolerance}), recadré ${cropped.w}×${cropped.h}, réduit à ${SPRITE_HEIGHT} px de haut` };
}

// Reflets verts : la brume transparente du Givré, posée sur le fond vert,
// ressort vert clair. On ramène le vert au niveau du rouge ou du bleu (le cyan
// et le blanc ne bougent pas). Jamais pour le Perché, dont la fumée EST verte.
const NO_DESPILL = new Set(['perche']);
function despill({ data }) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const limit = Math.max(data[i], data[i + 2]);
    if (data[i + 1] > limit) data[i + 1] = limit;
  }
}

// Décode TOUTES les images d'une animation (GIF) en pixels RVBA.
function readFrames(file) {
  const { w, h } = sizeOf(file);
  const res = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: 2 * 1024 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`lecture impossible : ${String(res.stderr).slice(-300)}`);
  const size = w * h * 4;
  const frames = [];
  for (let at = 0; at + size <= res.stdout.length; at += size) frames.push({ w, h, data: res.stdout.subarray(at, at + size) });
  if (!frames.length) throw new Error('aucune image dans l\'animation');
  return frames;
}

// Images par seconde d'une animation (ex. « 10/1 » → 10).
function fpsOf(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file]);
  const [a, b] = out.trim().split('/').map(Number);
  return a && b ? a / b : 10;
}

// Zone qui contient le perso dans TOUTES les images (pour un cadrage fixe).
function unionBox(frames) {
  let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
  for (const { w, h, data } of frames) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (maxX < 0) throw new Error('plus rien après le retrait du fond : baisse BG_TOLERANCE');
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Perso animé : fond retiré image par image, cadrage commun, WebP animé
// transparent (sans perte, pixels nets) qui boucle.
function prepareAnimatedSprite(file) {
  const name = slug(file);
  const out = path.join(OUT, 'avatars', `${name}.webp`);
  const frames = readFrames(file);
  const tolerance = toleranceFor(name);
  let removed = 0;
  for (const frame of frames) {
    removed += floodRemoveBackground(frame, tolerance);
    if (!NO_DESPILL.has(name)) despill(frame);
  }
  const box = unionBox(frames);
  const row = box.w * 4;
  const raw = Buffer.alloc(frames.length * box.h * row);
  frames.forEach(({ w, data }, i) => {
    for (let y = 0; y < box.h; y++) {
      data.copy(raw, (i * box.h + y) * row, ((box.y + y) * w + box.x) * 4, ((box.y + y) * w + box.x + box.w) * 4);
    }
  });
  const fps = fpsOf(file);
  const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${box.w}x${box.h}`,
    '-r', String(fps), '-i', '-', '-vf', `scale=-2:${SPRITE_HEIGHT}:flags=neighbor`,
    '-c:v', 'libwebp_anim', '-lossless', '1', '-compression_level', '6', '-loop', '0', '-pix_fmt', 'bgra', out],
  { input: raw, maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`écriture impossible : ${String(res.stderr).slice(-300)}`);
  const share = Math.round((100 * removed) / (frames.length * frames[0].w * frames[0].h));
  return {
    out,
    detail: `${frames.length} images à ${fps} i/s, fond retiré image par image (${share} %, tolérance ${tolerance}), cadré ${box.w}×${box.h}, ${SPRITE_HEIGHT} px de haut, ${(fs.statSync(out).size / 1024).toFixed(0)} Ko`,
  };
}

// Mini-cinématique de coup critique (givre-cine.gif) : .webm sans son, < 1,5 Mo.
function prepareCritClip(file) {
  const out = path.join(OUT, 'cine', `${cineName(file)}-crit.webm`);
  let crf = 32;
  for (let attempt = 1; attempt <= 6; attempt++) {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'format=yuv420p',
      '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-an', out]);
    const size = fs.statSync(out).size;
    if (size <= CRIT_MAX_BYTES) return { out, detail: `coup critique, ${durationOf(out).toFixed(2)} s, ${(size / 1024 / 1024).toFixed(2)} Mo (crf ${crf})` };
    crf += 4;
  }
  throw new Error(`impossible de passer ${path.basename(file)} sous 1,5 Mo`);
}

// Facteur d'agrandissement entier (pixels nets) pour que l'arène fasse au
// moins ARENA_MIN_WIDTH de large, sans dépasser ARENA_MAX_WIDTH.
function arenaFactor(width) {
  const factor = Math.max(1, Math.ceil(ARENA_MIN_WIDTH / width));
  return width * factor > ARENA_MAX_WIDTH ? Math.max(1, Math.floor(ARENA_MAX_WIDTH / width)) : factor;
}

// arene.jpeg : l'image de secours, à la largeur de l'arène (1280 px), sans
// lissage : agrandie par un facteur entier si elle est petite, réduite si elle
// est grande. En .jpg pour rester légère (c'est une illustration détaillée).
function prepareArenaImage(file) {
  const out = path.join(OUT, 'arena', `${slug(file)}.jpg`);
  const { w } = sizeOf(file);
  const scale = w < ARENA_MIN_WIDTH ? `iw*${arenaFactor(w)}:-2` : `${ARENA_MIN_WIDTH}:-2`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `scale=${scale}:flags=neighbor`, '-frames:v', '1', '-q:v', '3', out]);
  return { out, detail: `image de secours, ${ARENA_MIN_WIDTH} px de large, sans lissage` };
}

// Image d'une cinématique (givre-cine.jpeg) : l'image d'attente de la vidéo.
function prepareCinePoster(file) {
  const out = path.join(OUT, 'cine', `${cineName(file)}.jpg`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=1280:-2', '-frames:v', '1', '-q:v', '4', out]);
  return { out, detail: 'image d\'attente de la cinématique, 1280 px' };
}

// arene.gif : une vidéo .webm qui boucle (la boucle se fait dans la page), agrandie sans lissage.
function prepareArenaLoop(file) {
  const out = path.join(OUT, 'arena', `${slug(file)}.webm`);
  const { w } = sizeOf(file);
  const f = arenaFactor(w);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `scale=trunc(iw*${f}/2)*2:trunc(ih*${f}/2)*2:flags=neighbor,format=yuv420p`,
    '-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-an', out]);
  return { out, detail: `boucle vidéo, agrandie ×${f} sans lissage` };
}

function durationOf(file) {
  const out = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const seconds = parseFloat(out);
  if (!seconds) throw new Error(`durée illisible pour ${file}`);
  return seconds;
}

function hasAudio(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
  return out.trim().length > 0;
}

// Repère les passages noirs ou figés qui touchent le tout début ou la toute
// fin de la vidéo. Renvoie combien de secondes couper de chaque côté
// (0,5 s au maximum). Le reste de la vidéo est gardé en entier.
function edgeTrims(file, duration) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf',
    'blackdetect=d=0.04:pix_th=0.08,freezedetect=n=0.002:d=0.08', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const log = res.stderr || '';
  const spans = [];
  for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) spans.push([+m[1], +m[2]]);
  const starts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => +m[1]);
  starts.forEach((start, i) => spans.push([start, ends[i] !== undefined ? ends[i] : duration]));
  let head = 0;
  let tail = 0;
  for (const [start, end] of spans) {
    if (start <= 0.05) head = Math.max(head, end); // vide ou figé dès la première image
    if (end >= duration - 0.05) tail = Math.max(tail, duration - start); // jusqu'à la dernière image
  }
  return { head: Math.min(MAX_EDGE_TRIM, head), tail: Math.min(MAX_EDGE_TRIM, tail) };
}

// Encode en VP9 deux passes, 720p, avec le meilleur débit qui tient sous 4 Mo ;
// si le fichier dépasse quand même, on réessaie un peu plus bas.
function prepareVideo(file) {
  const out = path.join(OUT, 'cine', `${cineName(file)}.webm`);
  const total = durationOf(file);
  const { head, tail } = edgeTrims(file, total);
  const seconds = total - head - tail;
  const audio = hasAudio(file);
  const audioKbps = audio ? AUDIO_KBPS : 0;
  let videoKbps = Math.floor(((VIDEO_MAX_BYTES * 8) / 1000 / seconds) * 0.92) - audioKbps;
  const passlog = path.join(os.tmpdir(), `prepare-assets-${process.pid}`);

  for (let attempt = 1; attempt <= 4; attempt++) {
    if (videoKbps < 100) throw new Error(`${path.basename(file)} est trop longue pour tenir sous 4 Mo (${seconds.toFixed(1)} s)`);
    const common = ['-y', '-loglevel', 'error', '-i', file,
      '-ss', head.toFixed(3), '-t', seconds.toFixed(3),
      '-vf', `scale=-2:${VIDEO_HEIGHT}`,
      // -deadline good -cpu-used 2 : bonne qualité, encodage raisonnablement rapide.
      '-c:v', 'libvpx-vp9', '-b:v', `${videoKbps}k`, '-deadline', 'good', '-cpu-used', '2',
      '-row-mt', '1', '-passlogfile', passlog];
    run('ffmpeg', [...common, '-pass', '1', '-an', '-f', 'webm', os.platform() === 'win32' ? 'NUL' : '/dev/null']);
    run('ffmpeg', [...common, '-pass', '2', ...(audio ? ['-c:a', 'libopus', '-b:a', `${audioKbps}k`] : ['-an']), out]);
    const size = fs.statSync(out).size;
    if (size <= VIDEO_MAX_BYTES) {
      for (const f of fs.readdirSync(os.tmpdir())) {
        if (f.startsWith(path.basename(passlog))) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
      }
      return {
        out, size, seconds: durationOf(out), head, tail,
      };
    }
    videoKbps = Math.floor(videoKbps * 0.9 * (VIDEO_MAX_BYTES / size));
  }
  throw new Error(`impossible de passer ${path.basename(file)} sous 4 Mo`);
}

// Durées des cinématiques, lues par le serveur pour la pause du chrono.
function writeDurations(durations) {
  const file = path.join(OUT, 'cine', 'durations.json');
  let current = {};
  try { current = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* pas encore de fichier */ }
  fs.writeFileSync(file, `${JSON.stringify({ ...current, ...durations }, null, 2)}\n`);
}

function main() {
  checkFfmpeg();
  if (!fs.existsSync(SRC)) {
    console.error(`Dossier source introuvable : ${SRC}`);
    process.exit(1);
  }
  for (const dir of ['avatars', 'arena', 'cine']) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

  const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null;
  const files = fs.readdirSync(SRC).filter((f) => !f.startsWith('.') && (!only || only.test(f))).sort();
  if (files.length === 0) {
    console.log(`Rien à préparer : ${SRC} est vide.`);
    return;
  }
  let errors = 0;
  const durations = {};
  for (const name of files) {
    const file = path.join(SRC, name);
    const ext = path.extname(name).toLowerCase();
    try {
      if (ext === '.gif') {
        let result;
        if (ARENA_NAME.test(name)) result = prepareArenaLoop(file);
        else if (/-cine$/.test(slug(file))) result = prepareCritClip(file);
        else result = prepareAnimatedSprite(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), result.out)} (${result.detail})`);
      } else if (IMAGE_EXT.has(ext)) {
        let result;
        if (ARENA_NAME.test(name)) result = prepareArenaImage(file);
        else if (/-cine$/.test(slug(file))) result = prepareCinePoster(file);
        else result = prepareSprite(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), result.out)} (${result.detail})`);
      } else if (VIDEO_EXT.has(ext)) {
        const {
          out, size, seconds, head, tail,
        } = prepareVideo(file);
        durations[cineName(file)] = Math.round(seconds * 1000) / 1000;
        console.log(`✓ ${name} → ${path.relative(process.cwd(), out)} (${seconds.toFixed(2)} s, coupé ${head.toFixed(2)} s au début et ${tail.toFixed(2)} s à la fin, ${(size / 1024 / 1024).toFixed(2)} Mo)`);
      } else {
        console.log(`- ${name} ignoré (format non pris en charge)`);
      }
    } catch (err) {
      errors++;
      console.error(`✗ ${name} : ${err.message}`);
    }
  }
  if (Object.keys(durations).length) writeDurations(durations);
  if (errors) process.exit(1);
}

main();
