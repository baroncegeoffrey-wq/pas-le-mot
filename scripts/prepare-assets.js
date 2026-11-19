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
// - Vidéos de super attaque (.mp4 .mov .mkv .webm, ex. givre.mp4) : converties
//   en .webm (VP9 + Opus), 1280 px de large au maximum, moins de 2 Mo, dans
//   <sortie>/cine/.
//
// Réglage : BG_TOLERANCE=60 node scripts/prepare-assets.js (défaut 70) pour
// retirer plus ou moins de fond autour du perso.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents/01-Projets/pas-le-mot/assets-src'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public', 'assets'));

const SPRITE_HEIGHT = 160;
const ARENA_MIN_WIDTH = 1280; // l'arène est agrandie (facteur entier) jusqu'à au moins cette largeur
const ARENA_MAX_WIDTH = 2560;
const VIDEO_MAX_WIDTH = 1280;
const VIDEO_MAX_BYTES = 2 * 1024 * 1024; // 2 Mo
const AUDIO_KBPS = 64;
// Tolérance de couleur pour le remplissage du fond (distance RVB, de 0 à 441).
const BG_TOLERANCE = Number(process.env.BG_TOLERANCE) || 70;

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
  const removed = floodRemoveBackground(img, BG_TOLERANCE);
  const cropped = cropToContent(img);
  writeScaledPng(cropped, SPRITE_HEIGHT, out);
  return { out, detail: `fond retiré (${Math.round((100 * removed) / (img.w * img.h))} %), recadré ${cropped.w}×${cropped.h}, réduit à ${SPRITE_HEIGHT} px de haut` };
}

// Facteur d'agrandissement entier (pixels nets) pour que l'arène fasse au
// moins ARENA_MIN_WIDTH de large, sans dépasser ARENA_MAX_WIDTH.
function arenaFactor(width) {
  const factor = Math.max(1, Math.ceil(ARENA_MIN_WIDTH / width));
  return width * factor > ARENA_MAX_WIDTH ? Math.max(1, Math.floor(ARENA_MAX_WIDTH / width)) : factor;
}

// arene.jpeg (ou .png) : l'image de secours, agrandie sans lissage.
function prepareArenaImage(file) {
  const out = path.join(OUT, 'arena', `${slug(file)}.png`);
  const { w } = sizeOf(file);
  const f = arenaFactor(w);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', `scale=iw*${f}:ih*${f}:flags=neighbor`, '-frames:v', '1', out]);
  return { out, detail: `image de secours, agrandie ×${f} sans lissage` };
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

// Encode en VP9 deux passes avec un débit calculé pour tenir sous 2 Mo ;
// si le fichier dépasse quand même, on réessaie avec un débit plus bas.
function prepareVideo(file) {
  const out = path.join(OUT, 'cine', `${slug(file)}.webm`);
  const seconds = durationOf(file);
  const audio = hasAudio(file);
  const audioKbps = audio ? AUDIO_KBPS : 0;
  let videoKbps = Math.floor(((VIDEO_MAX_BYTES * 8) / 1000 / seconds) * 0.9) - audioKbps;
  const passlog = path.join(os.tmpdir(), `prepare-assets-${process.pid}`);

  for (let attempt = 1; attempt <= 4; attempt++) {
    if (videoKbps < 50) throw new Error(`${path.basename(file)} est trop longue pour tenir sous 2 Mo (${seconds.toFixed(1)} s)`);
    const common = ['-y', '-loglevel', 'error', '-i', file,
      '-vf', `scale='min(${VIDEO_MAX_WIDTH},iw)':-2`,
      // -deadline good -cpu-used 4 : bonne qualité, encodage plusieurs fois plus rapide.
      '-c:v', 'libvpx-vp9', '-b:v', `${videoKbps}k`, '-deadline', 'good', '-cpu-used', '4',
      '-row-mt', '1', '-passlogfile', passlog];
    run('ffmpeg', [...common, '-pass', '1', '-an', '-f', 'webm', os.platform() === 'win32' ? 'NUL' : '/dev/null']);
    run('ffmpeg', [...common, '-pass', '2', ...(audio ? ['-c:a', 'libopus', '-b:a', `${audioKbps}k`] : ['-an']), out]);
    const size = fs.statSync(out).size;
    if (size <= VIDEO_MAX_BYTES) {
      for (const f of fs.readdirSync(os.tmpdir())) {
        if (f.startsWith(path.basename(passlog))) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
      }
      return { out, size };
    }
    videoKbps = Math.floor(videoKbps * 0.75 * (VIDEO_MAX_BYTES / size));
  }
  throw new Error(`impossible de passer ${path.basename(file)} sous 2 Mo`);
}

function main() {
  checkFfmpeg();
  if (!fs.existsSync(SRC)) {
    console.error(`Dossier source introuvable : ${SRC}`);
    process.exit(1);
  }
  for (const dir of ['avatars', 'arena', 'cine']) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

  const files = fs.readdirSync(SRC).filter((f) => !f.startsWith('.')).sort();
  if (files.length === 0) {
    console.log(`Rien à préparer : ${SRC} est vide.`);
    return;
  }
  let errors = 0;
  for (const name of files) {
    const file = path.join(SRC, name);
    const ext = path.extname(name).toLowerCase();
    try {
      if (ext === '.gif' && ARENA_NAME.test(name)) {
        const { out, detail } = prepareArenaLoop(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), out)} (${detail})`);
      } else if (IMAGE_EXT.has(ext)) {
        const { out, detail } = ARENA_NAME.test(name) ? prepareArenaImage(file) : prepareSprite(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), out)} (${detail})`);
      } else if (VIDEO_EXT.has(ext)) {
        const { out, size } = prepareVideo(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), out)} (${(size / 1024 / 1024).toFixed(2)} Mo)`);
      } else {
        console.log(`- ${name} ignoré (format non pris en charge)`);
      }
    } catch (err) {
      errors++;
      console.error(`✗ ${name} : ${err.message}`);
    }
  }
  if (errors) process.exit(1);
}

main();
