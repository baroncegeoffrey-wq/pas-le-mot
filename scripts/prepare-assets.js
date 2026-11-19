#!/usr/bin/env node
// Prépare les images et vidéos du jeu à partir des fichiers bruts.
//
//   node scripts/prepare-assets.js [dossier-source] [dossier-sortie]
//
// Par défaut : source = ~/Documents/01-Projets/pas-le-mot/assets-src/
//              sortie = public/assets/
//
// Ce que fait le script (il utilise ffmpeg, qui doit être installé) :
// - Images (.png .jpg .jpeg .webp) :
//   * un fichier dont le nom commence par « fond », « arene » ou « bg » est un
//     décor d'arène : il est réduit à 1280 px de large au maximum (sans lissage)
//     et rangé dans <sortie>/arena/ ;
//   * tous les autres sont des sprites : le fond vert est retiré (transparent),
//     l'image est réduite à 160 px de haut sans lissage (pixels nets) et rangée
//     dans <sortie>/avatars/. Nomme-les givre.png, perche.png, verlan.png pour
//     qu'ils remplacent les silhouettes provisoires.
// - Vidéos (.mp4 .mov .mkv .webm) : converties en .webm (VP9 + Opus), 1280 px
//   de large au maximum, moins de 2 Mo, rangées dans <sortie>/cine/. Nomme-les
//   givre.mp4, perche.mp4, verlan.mp4 pour les super attaques.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SRC = path.resolve(process.argv[2] || path.join(os.homedir(), 'Documents/01-Projets/pas-le-mot/assets-src'));
const OUT = path.resolve(process.argv[3] || path.join(__dirname, '..', 'public', 'assets'));

const SPRITE_HEIGHT = 160;
const ARENA_MAX_WIDTH = 1280;
const VIDEO_MAX_WIDTH = 1280;
const VIDEO_MAX_BYTES = 2 * 1024 * 1024; // 2 Mo
const AUDIO_KBPS = 64;
const GREEN = '0x00FF00'; // le vert à retirer
const GREEN_SIMILARITY = 0.32; // tolérance autour du vert (0 à 1)
const GREEN_BLEND = 0.08; // adoucissement du bord (petit = net)

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
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

function prepareSprite(file) {
  const out = path.join(OUT, 'avatars', `${slug(file)}.png`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `format=rgba,colorkey=${GREEN}:${GREEN_SIMILARITY}:${GREEN_BLEND},scale=-2:${SPRITE_HEIGHT}:flags=neighbor`,
    '-frames:v', '1', '-pix_fmt', 'rgba', out]);
  return out;
}

function prepareArena(file) {
  const out = path.join(OUT, 'arena', `${slug(file)}.png`);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `scale='min(${ARENA_MAX_WIDTH},iw)':-2:flags=neighbor`, '-frames:v', '1', out]);
  return out;
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
      if (IMAGE_EXT.has(ext)) {
        const isArena = /^(fond|arene|arène|bg)/i.test(name);
        const out = isArena ? prepareArena(file) : prepareSprite(file);
        console.log(`✓ ${name} → ${path.relative(process.cwd(), out)}${isArena ? ' (décor)' : ' (sprite, fond vert retiré)'}`);
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
