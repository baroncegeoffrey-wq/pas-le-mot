// Les sons du jeu, fabriqués à la volée avec Web Audio : aucun fichier son,
// aucun service extérieur. Un bouton permet de les couper (choix retenu).
const Sound = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('muted') === '1'; } catch (e) { /* stockage indisponible */ }

  // Le navigateur n'autorise le son qu'après un clic : on crée le contexte au besoin.
  function audio() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Une note : type d'onde, fréquence de départ et d'arrivée, durée, volume, décalage.
  function tone({ type = 'square', from = 440, to = from, dur = 0.12, vol = 0.12, delay = 0 }) {
    const ac = muted ? null : audio();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Un souffle de bruit (impact, raclage), filtré.
  function noise({ dur = 0.3, vol = 0.2, freq = 1200, delay = 0 }) {
    const ac = muted ? null : audio();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t);
  }

  const sounds = {
    tick: () => tone({ from: 660, dur: 0.1, vol: 0.1 }), // 3, 2, 1
    go: () => { tone({ from: 523, dur: 0.12 }); tone({ from: 784, dur: 0.12, delay: 0.1 }); tone({ from: 1046, dur: 0.3, delay: 0.2 }); },
    good: () => { tone({ type: 'triangle', from: 660, dur: 0.1, vol: 0.15 }); tone({ type: 'triangle', from: 990, dur: 0.18, vol: 0.15, delay: 0.08 }); },
    theirs: () => tone({ type: 'triangle', from: 330, to: 260, dur: 0.18, vol: 0.1 }),
    bad: () => tone({ type: 'sawtooth', from: 180, to: 90, dur: 0.25, vol: 0.12 }),
    blip: () => tone({ type: 'sine', from: 880, to: 1320, dur: 0.12, vol: 0.1 }),
    heart: () => { tone({ type: 'sine', from: 70, to: 45, dur: 0.12, vol: 0.35 }); tone({ type: 'sine', from: 65, to: 40, dur: 0.12, vol: 0.25, delay: 0.16 }); },
    alert: () => { tone({ type: 'square', from: 880, dur: 0.12, vol: 0.1 }); tone({ type: 'square', from: 660, dur: 0.12, vol: 0.1, delay: 0.14 }); tone({ type: 'square', from: 880, dur: 0.12, vol: 0.1, delay: 0.28 }); },
    countdown: () => tone({ type: 'square', from: 1200, dur: 0.06, vol: 0.08 }), // 10 dernières secondes
    whoosh: () => { noise({ dur: 0.5, vol: 0.25, freq: 2500 }); tone({ type: 'sawtooth', from: 200, to: 900, dur: 0.45, vol: 0.06 }); },
    charge: () => tone({ type: 'sawtooth', from: 120, to: 1400, dur: 0.6, vol: 0.08 }),
    impact: () => { noise({ dur: 0.8, vol: 0.45, freq: 900 }); tone({ type: 'sine', from: 110, to: 30, dur: 0.7, vol: 0.4 }); },
    scrape: () => noise({ dur: 0.12, vol: 0.18, freq: 4000 }),
    thaw: () => { [784, 988, 1175, 1568].forEach((f, i) => tone({ type: 'triangle', from: f, dur: 0.15, vol: 0.1, delay: i * 0.07 })); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'square', from: f, dur: i === 3 ? 0.45 : 0.14, vol: 0.1, delay: i * 0.13 })); },
    lose: () => { [392, 330, 262].forEach((f, i) => tone({ type: 'square', from: f, to: f * 0.97, dur: i === 2 ? 0.5 : 0.2, vol: 0.1, delay: i * 0.22 })); },
  };

  return {
    play(name) {
      try { if (sounds[name]) sounds[name](); } catch (e) { /* le son n'est jamais bloquant */ }
    },
    isMuted: () => muted,
    toggle() {
      muted = !muted;
      try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (e) { /* tant pis */ }
      if (!muted) audio();
      return muted;
    },
    unlock: () => { if (!muted) audio(); }, // à appeler sur un clic
  };
})();

// La musique de combat (assets/music/, préparée par scripts/prepare-assets.js),
// en boucle pendant les parties et sur le menu (un peu moins fort).
// - Elle démarre au premier clic ou à la première touche : les navigateurs
//   bloquent le son tant que le joueur n'a rien fait.
// - Elle suit le bouton SON ON/OFF (Sound.isMuted()).
// - Elle baisse pendant les cinématiques (duck), puis remonte.
const Music = (() => {
  const VOLUME = { game: 0.4, menu: 0.28, ducked: 0.08 }; // volume de base : 40 % en partie
  const FADE_MS = 500;
  const FILE = 'assets/music/musique-combat';
  let el = null;
  let mode = 'menu';
  let ducked = false;
  let fadeTimer = null;

  function target() {
    if (Sound.isMuted()) return 0;
    if (ducked) return VOLUME.ducked;
    return VOLUME[mode];
  }

  // Fondu doux vers le bon volume ; à 0, la musique est mise en pause.
  function apply() {
    if (!el) return;
    const goal = target();
    if (goal > 0 && el.paused) el.play().catch(() => {});
    clearInterval(fadeTimer);
    const from = el.volume;
    const start = performance.now();
    fadeTimer = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / FADE_MS);
      el.volume = from + (goal - from) * t;
      if (t === 1) {
        clearInterval(fadeTimer);
        if (goal === 0) el.pause();
      }
    }, 40);
  }

  return {
    // À appeler sur chaque clic ou touche : ne fait quelque chose que la 1re fois.
    start() {
      if (el) return;
      el = new Audio();
      // Ogg (plus léger) si le navigateur le lit, sinon MP3 (Safari).
      el.src = el.canPlayType('audio/ogg; codecs="vorbis"') ? `${FILE}.ogg` : `${FILE}.mp3`;
      el.loop = true;
      el.volume = 0;
      apply();
    },
    setMode(next) { mode = next === 'game' ? 'game' : 'menu'; apply(); },
    duck(on) { ducked = Boolean(on); apply(); },
    refresh: apply, // après un clic sur SON ON/OFF
  };
})();
