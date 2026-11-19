// Attaques visibles à chaque mot trouvé, en 3 temps :
//   1. Charge (200 ms) : l'attaquant s'illumine, une aura de sa couleur grossit
//      autour de lui, l'arène s'assombrit un peu.
//   2. Tir (400 ms) : un projectile énorme traverse l'arène avec une traînée
//      lumineuse et des particules (lance de glace, boule de fumée, cassette).
//   3. Impact : explosion de la taille du perso adverse et onde de choc ; à cet
//      instant, client.js déclenche l'impact habituel (hit-stop, tremblement...).
// Tout est dessiné sur un canvas posé sur l'arène, en mode additif ('lighter')
// pour que les couleurs s'additionnent et brillent. Les halos sont des images
// préparées une seule fois (dessiner une image coûte peu) : on tient 60 i/s.
// Les couleurs viennent des variables CSS de style.css (--fx-...).
const Attack = (() => {
  const CHARGE_MS = 200;
  const SHOT_MS = 400;
  const BOOM_MS = 560;
  const MAX_PARTICLES = 900;

  let arena = null;
  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  const attacks = [];
  const particles = [];
  let inFlight = 0; // attaques qui n'ont pas encore touché
  let idleWaiters = [];
  const C = {}; // couleurs [r, v, b]
  const glowCache = new Map();

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const lerp = (a, b, t) => a + (b - a) * t;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  function readColor(name) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = raw.replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((h) => h + h).join('') : hex;
    const n = parseInt(full, 16);
    return Number.isNaN(n) ? [255, 255, 255] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function readColors() {
    const names = ['ice', 'ice-white', 'smoke-green', 'smoke-violet', 'shroom', 'tape-r', 'tape-g', 'tape-b', 'tape-body'];
    names.forEach((n) => { C[n] = readColor(`--fx-${n}`); });
    C.white = [255, 255, 255];
  }

  // Halo rond (centre blanc, puis la couleur, puis transparent), préparé une fois.
  function glow(color, hot = true) {
    const key = `${color.join(',')}|${hot}`;
    if (glowCache.has(key)) return glowCache.get(key);
    const g = document.createElement('canvas');
    g.width = 128;
    g.height = 128;
    const c = g.getContext('2d');
    const grad = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (hot) grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(hot ? 0.18 : 0, rgba(color, 0.95));
    grad.addColorStop(0.5, rgba(color, 0.35));
    grad.addColorStop(1, rgba(color, 0));
    c.fillStyle = grad;
    c.fillRect(0, 0, 128, 128);
    glowCache.set(key, g);
    return g;
  }

  function drawGlow(color, x, y, r, alpha, hot = true) {
    if (r <= 0 || alpha <= 0) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(glow(color, hot), x - r, y - r, r * 2, r * 2);
  }

  function init(arenaEl) {
    arena = arenaEl;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    arena.appendChild(canvas);
    ctx = canvas.getContext('2d');
    readColors();
    // Halos préparés dès le chargement : pas d'à-coup au premier tir.
    Object.values(C).forEach((color) => { glow(color, true); glow(color, false); });
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!arena) return;
    W = arena.clientWidth;
    H = arena.clientHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  // Centre d'un perso dans l'arène (en px de l'arène, même si elle est zoomée).
  function centerOf(el) {
    const a = arena.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const zoom = a.width / arena.clientWidth || 1;
    return {
      x: (b.left - a.left + b.width / 2) / zoom,
      y: (b.top - a.top + b.height * 0.5) / zoom,
      h: b.height / zoom,
    };
  }

  /* ---------- Particules ---------- */

  function spawn(p) {
    if (particles.length >= MAX_PARTICLES) return;
    particles.push({
      vx: 0, vy: 0, ax: 0, ay: 0, drag: 0, age: 0, life: 500, size: 6, grow: 0, rot: 0, vr: 0, alpha: 1, shape: 'glow', ...p,
    });
  }

  function drawShard(p, s, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(p.color, 1);
    ctx.beginPath();
    ctx.moveTo(s * 1.6, 0);
    ctx.lineTo(-s * 0.6, -s * 0.5);
    ctx.lineTo(-s * 0.3, s * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Petit champignon lumineux (chapeau + pied).
  function drawShroom(p, s, alpha) {
    drawGlow(p.color, p.x, p.y, s * 2.4, alpha * 0.6, false);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba(p.color, 1);
    ctx.beginPath();
    ctx.arc(0, 0, s, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = rgba(C['ice-white'], 1);
    ctx.fillRect(-s * 0.25, 0, s * 0.5, s * 0.9);
    ctx.restore();
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      const k = dt / 16.67;
      p.vx += p.ax * k;
      p.vy += p.ay * k;
      if (p.drag) { p.vx *= (1 - p.drag) ** k; p.vy *= (1 - p.drag) ** k; }
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.vr * k;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = p.age / p.life;
      const alpha = p.alpha * (1 - t) * (t < 0.1 ? t / 0.1 : 1);
      const s = Math.max(0.5, p.size + p.grow * p.age / 1000);
      if (p.shape === 'glow') drawGlow(p.color, p.x, p.y, s, alpha, p.hot !== false);
      else if (p.shape === 'shard') drawShard(p, s, alpha);
      else if (p.shape === 'shroom') drawShroom(p, s, alpha);
      else if (p.shape === 'square') {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = rgba(p.color, 1);
        ctx.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), s, s);
      } else if (p.shape === 'band') {
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = rgba(p.color, 1);
        ctx.fillRect(p.x - p.len / 2, p.y - s / 2, p.len, s);
      }
    }
  }

  /* ---------- Les 3 projectiles ---------- */

  // Le Givré : une lance de glace géante cyan, sillage de givre et éclats.
  const ice = {
    color: () => C.ice,
    draw(x, y, size, dir, t) {
      const L = size * 1.7;
      const T = size * 0.26;
      drawGlow(C.ice, x, y, size * 1.05, 0.9);
      drawGlow(C['ice-white'], x + dir * L * 0.25, y, size * 0.45, 0.9);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(dir, 1);
      ctx.globalAlpha = 1;
      const grad = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
      grad.addColorStop(0, rgba(C.ice, 0.1));
      grad.addColorStop(0.55, rgba(C.ice, 0.85));
      grad.addColorStop(1, rgba(C['ice-white'], 1));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.lineTo(L * 0.12, -T / 2);
      ctx.lineTo(-L / 2, -T * 0.12);
      ctx.lineTo(-L / 2, T * 0.12);
      ctx.lineTo(L * 0.12, T / 2);
      ctx.closePath();
      ctx.fill();
      // Arête brillante et cristaux qui hérissent la lance
      ctx.strokeStyle = rgba(C['ice-white'], 0.95);
      ctx.lineWidth = Math.max(2, T * 0.12);
      ctx.beginPath();
      ctx.moveTo(L / 2, 0);
      ctx.lineTo(-L * 0.35, 0);
      ctx.stroke();
      ctx.fillStyle = rgba(C.ice, 0.75);
      for (let i = 0; i < 5; i++) {
        const bx = lerp(L * 0.05, -L * 0.4, i / 4);
        const side = i % 2 ? 1 : -1;
        const spike = T * (0.9 + 0.35 * Math.sin(t / 40 + i));
        ctx.beginPath();
        ctx.moveTo(bx + T * 0.3, side * T * 0.2);
        ctx.lineTo(bx - T * 0.5, side * spike);
        ctx.lineTo(bx - T * 0.1, side * T * 0.1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
    trail(x, y, size, dir) {
      for (let i = 0; i < 3; i++) {
        spawn({
          x: x - dir * size * rand(0.4, 0.9), y: y + rand(-1, 1) * size * 0.15, vx: -dir * rand(1, 4), vy: rand(-1.2, 1.2),
          drag: 0.06, life: rand(300, 600), size: size * rand(0.12, 0.25), grow: -size * 0.2, color: C.ice,
        });
      }
      for (let i = 0; i < 2; i++) {
        spawn({
          shape: 'shard', x: x - dir * size * rand(0.2, 0.8), y: y + rand(-1, 1) * size * 0.2,
          vx: -dir * rand(1, 5), vy: rand(-3, 3), ay: 0.15, drag: 0.03, life: rand(350, 700),
          size: rand(4, 9) * (size / 160 + 0.5), rot: rand(0, 6.28), vr: rand(-0.3, 0.3), color: pick([C.ice, C['ice-white']]),
        });
      }
    },
    explode(x, y, size) {
      drawFlash(C.ice, x, y, size);
      for (let i = 0; i < 48; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(4, 13) * (size / 170 + 0.4);
        spawn({
          shape: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 0.18, drag: 0.04, life: rand(450, 900),
          size: rand(5, 13) * (size / 170 + 0.4), rot: a, vr: rand(-0.25, 0.25), color: pick([C.ice, C['ice-white'], C.ice]),
        });
      }
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(1, 6);
        spawn({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, drag: 0.05, life: rand(500, 1000), size: rand(6, 16), color: C['ice-white'],
        });
      }
    },
  };

  // Le Perché : une énorme boule de fumée verte et violette qui tourbillonne,
  // des volutes et des petits champignons lumineux qui s'en échappent.
  const smoke = {
    color: () => C['smoke-green'],
    draw(x, y, size, dir, t) {
      const R = size * 0.6;
      // Des bouffées vertes et violettes qui tournent autour du centre (pas trop
      // d'additif ici, sinon la boule vire au blanc et on perd les couleurs).
      drawGlow(C['smoke-violet'], x, y, R * 1.7, 0.4, false);
      for (let k = 0; k < 9; k++) {
        const a = t / 90 + (k * Math.PI * 2) / 9;
        const r = R * (0.45 + 0.15 * Math.sin(t / 70 + k));
        const color = k % 2 ? C['smoke-violet'] : C['smoke-green'];
        drawGlow(color, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, R * 0.6, 0.3, false);
      }
      drawGlow(C['smoke-green'], x, y, R * 0.55, 0.45, false);
      drawGlow(C['smoke-green'], x, y, R * 0.18, 0.8);
      // Spirale qui tourne : on voit le tourbillon
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-t / 80);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(3, R * 0.09);
      for (let arm = 0; arm < 3; arm++) {
        ctx.strokeStyle = rgba(arm % 2 ? C['smoke-violet'] : C['smoke-green'], 1);
        ctx.beginPath();
        for (let s = 0; s <= 24; s++) {
          const ang = (arm * Math.PI * 2) / 3 + s * 0.22;
          const rr = (s / 24) * R * 0.95;
          const px = Math.cos(ang) * rr;
          const py = Math.sin(ang) * rr;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
    trail(x, y, size, dir) {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2);
        spawn({
          x: x + Math.cos(a) * size * 0.4, y: y + Math.sin(a) * size * 0.35,
          vx: -dir * rand(0.5, 2) - Math.sin(a) * 2, vy: Math.cos(a) * 2 - 0.4, drag: 0.04,
          life: rand(450, 850), size: size * rand(0.15, 0.3), grow: size * 0.35, hot: false, alpha: 0.6,
          color: pick([C['smoke-green'], C['smoke-violet']]),
        });
      }
      if (Math.random() < 0.45) {
        spawn({
          shape: 'shroom', x: x + rand(-0.4, 0.4) * size, y: y + rand(-0.3, 0.3) * size,
          vx: -dir * rand(0.5, 2.5), vy: rand(-3, -1), ay: 0.05, life: rand(600, 1000),
          size: rand(5, 9) * (size / 170 + 0.5), rot: rand(-0.4, 0.4), vr: rand(-0.05, 0.05), color: C.shroom,
        });
      }
    },
    explode(x, y, size) {
      drawFlash(C['smoke-green'], x, y, size);
      for (let i = 0; i < 26; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(1.5, 6) * (size / 170 + 0.4);
        spawn({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, drag: 0.05, life: rand(600, 1100),
          size: size * rand(0.15, 0.3), grow: size * 0.5, hot: false, alpha: 0.75,
          color: pick([C['smoke-green'], C['smoke-violet']]),
        });
      }
      for (let i = 0; i < 9; i++) {
        const a = rand(-Math.PI, 0);
        const v = rand(2, 6);
        spawn({
          shape: 'shroom', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 0.12, life: rand(700, 1100),
          size: rand(6, 11) * (size / 170 + 0.5), rot: rand(-0.5, 0.5), vr: rand(-0.08, 0.08), color: C.shroom,
        });
      }
    },
  };

  // Le Verlan : une cassette géante qui glitche, bandes RGB, pixels, éclats d'écran.
  const tape = {
    color: () => C['tape-body'],
    cassette(w, h, t) {
      const r = h * 0.12;
      ctx.lineWidth = Math.max(3, h * 0.06);
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, r);
      ctx.stroke();
      ctx.globalAlpha *= 0.35;
      ctx.fill();
      ctx.globalAlpha /= 0.35;
      ctx.strokeRect(-w * 0.36, -h * 0.34, w * 0.72, h * 0.3); // étiquette
      ctx.strokeRect(-w * 0.2, h * 0.02, w * 0.4, h * 0.2); // fenêtre
      for (const side of [-1, 1]) { // les deux bobines qui tournent
        const cx = side * w * 0.22;
        const cy = h * 0.12;
        const rr = h * 0.15;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        for (let s = 0; s < 3; s++) {
          const a = t / 60 + (s * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          ctx.stroke();
        }
      }
      ctx.beginPath(); // la bande qui sort, en vrac
      ctx.moveTo(-w * 0.3, h / 2);
      ctx.quadraticCurveTo(-w * 0.1, h * (0.75 + 0.1 * Math.sin(t / 50)), w * 0.15, h * 0.55);
      ctx.stroke();
    },
    draw(x, y, size, dir, t) {
      const w = size * 1.25;
      const h = size * 0.8;
      drawGlow(C['tape-body'], x, y, size * 1.1, 0.75);
      // Séparation RGB : la cassette dessinée 3 fois, décalée, en additif.
      const jitter = () => rand(-1, 1) * size * 0.05;
      const channels = [[C['tape-r'], -size * 0.05], [C['tape-g'], 0], [C['tape-b'], size * 0.05]];
      for (const [color, off] of channels) {
        ctx.save();
        ctx.translate(x + off + jitter(), y + jitter() * 0.5);
        ctx.rotate(Math.sin(t / 90) * 0.12 * dir);
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = rgba(color, 1);
        ctx.fillStyle = rgba(color, 1);
        this.cassette(w, h, t);
        ctx.restore();
      }
      // Glitch : des tranches de la cassette qui sautent de côté
      ctx.globalAlpha = 0.8;
      for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.55) {
          const by = y + rand(-0.5, 0.5) * h;
          ctx.fillStyle = rgba(pick([C['tape-r'], C['tape-g'], C['tape-b'], C.white]), 1);
          ctx.fillRect(x - w / 2 + rand(-0.3, 0.3) * w, by, w * rand(0.4, 1.1), rand(2, 7));
        }
      }
    },
    trail(x, y, size, dir) {
      // Bandes RGB derrière la cassette
      [C['tape-r'], C['tape-g'], C['tape-b']].forEach((color, i) => {
        spawn({
          shape: 'band', x: x - dir * size * rand(0.6, 1.1), y: y + (i - 1) * size * 0.22 + rand(-4, 4),
          vx: -dir * rand(0.5, 2), life: rand(180, 320), size: rand(3, 8), len: size * rand(0.5, 1.2), color,
        });
      });
      for (let i = 0; i < 4; i++) {
        spawn({
          shape: 'square', x: x - dir * size * rand(0.3, 0.8), y: y + rand(-0.5, 0.5) * size,
          vx: -dir * rand(1, 5), vy: rand(-2, 2), drag: 0.03, life: rand(300, 650), size: Math.round(rand(4, 10)),
          color: pick([C['tape-r'], C['tape-g'], C['tape-b'], C.white]),
        });
      }
      if (Math.random() < 0.5) {
        spawn({
          shape: 'shard', x: x - dir * size * 0.5, y: y + rand(-0.4, 0.4) * size, vx: -dir * rand(2, 6), vy: rand(-3, 3), ay: 0.15,
          life: rand(400, 700), size: rand(6, 12), rot: rand(0, 6.28), vr: rand(-0.2, 0.2), color: pick([C.white, C['tape-b']]),
        });
      }
    },
    explode(x, y, size) {
      drawFlash(C['tape-body'], x, y, size);
      for (let i = 0; i < 90; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(2, 12) * (size / 170 + 0.4);
        spawn({
          shape: 'square', x: x + rand(-0.2, 0.2) * size, y: y + rand(-0.2, 0.2) * size, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          ay: 0.1, drag: 0.04, life: rand(450, 950), size: Math.round(rand(5, 14) * (size / 170 + 0.5)),
          color: pick([C['tape-r'], C['tape-g'], C['tape-b'], C.white]),
        });
      }
      for (let i = 0; i < 14; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(4, 10);
        spawn({
          shape: 'shard', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: 0.2, drag: 0.03, life: rand(500, 900),
          size: rand(8, 16), rot: a, vr: rand(-0.3, 0.3), color: pick([C.white, C['tape-b'], C['tape-r']]),
        });
      }
      for (let i = 0; i < 6; i++) {
        spawn({
          shape: 'band', x: x + rand(-0.3, 0.3) * size, y: y + rand(-0.6, 0.6) * size, life: rand(150, 300),
          size: rand(4, 10), len: size * rand(1, 2.2), color: pick([C['tape-r'], C['tape-g'], C['tape-b']]),
        });
      }
    },
  };

  const KINDS = { givre: ice, perche: smoke, verlan: tape };

  // Gros éclat de lumière au point d'impact (une particule qui s'éteint vite).
  function drawFlash(color, x, y, size) {
    spawn({ x, y, life: 260, size: size * 1.1, grow: size * 1.5, color: C.white, alpha: 1 });
    spawn({ x, y, life: 420, size: size * 0.9, grow: size * 1.2, color, alpha: 1 });
  }

  /* ---------- Une attaque ---------- */

  // from / to : les éléments des persos ; avatar : givre, perche ou verlan ;
  // letters : longueur du mot (plus il est long, plus c'est gros) ;
  // big : coup critique (encore plus gros) ; onShot / onImpact : rappels.
  function fire({
    from, to, avatar, letters = 5, big = false, onShot, onImpact,
  }) {
    const kind = KINDS[avatar];
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!ctx || !kind || reduce) {
      if (onShot) onShot();
      if (onImpact) onImpact();
      return;
    }
    if (arena.clientWidth !== W || arena.clientHeight !== H) resize();
    const a = centerOf(from);
    const b = centerOf(to);
    const growth = 1 + Math.max(0, letters - 3) * 0.14;
    // Taille : au moins celle du perso, plus grosse pour un mot long, plafonnée
    // pour rester lisible dans l'arène (qui est moins haute que large).
    const size = Math.min(H * (big ? 1.05 : 0.85), Math.max(110, a.h) * growth * (big ? 1.45 : 1));
    const boomSize = Math.min(H * (big ? 1.1 : 0.9), Math.max(110, b.h) * (0.9 + Math.max(0, letters - 3) * 0.1) * (big ? 1.4 : 1));
    const color = kind.color();
    from.style.setProperty('--aura', rgba(color, 1));
    from.classList.add('charging');
    inFlight++;
    attacks.push({
      kind, a, b, size, boomSize, color, t: 0, emit: 16.67, dir: Math.sign(b.x - a.x) || 1, shot: false, hit: false, onShot, onImpact, from,
    });
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  function impact(atk) {
    atk.hit = true;
    atk.from.classList.remove('charging');
    atk.kind.explode(atk.b.x, atk.b.y, atk.boomSize);
    if (atk.onImpact) atk.onImpact();
    inFlight--;
    if (inFlight === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((fn) => fn());
    }
  }

  function updateAttack(atk, dt) {
    atk.t += dt;
    const { t } = atk;
    if (t >= CHARGE_MS && !atk.shot) {
      atk.shot = true;
      atk.emit = 16.67;
      atk.from.classList.remove('charging');
      if (atk.onShot) atk.onShot();
    }
    if (atk.shot && !atk.hit) {
      const p = Math.min(1, (t - CHARGE_MS) / SHOT_MS);
      const e = p * p * (3 - 2 * p) * 0.35 + p * 0.65; // départ un peu plus lent
      atk.x = lerp(atk.a.x, atk.b.x, e);
      atk.y = lerp(atk.a.y, atk.b.y, e) - Math.sin(Math.PI * e) * atk.size * 0.06;
      // Traînée : un lot de particules toutes les 16 ms de jeu, quelle que soit
      // la vitesse de l'écran (même rendu à 60 ou 144 i/s).
      atk.emit += dt;
      while (atk.emit >= 16.67) {
        atk.emit -= 16.67;
        atk.kind.trail(atk.x, atk.y, atk.size, atk.dir);
      }
      if (p >= 1) impact(atk);
    }
    if (!atk.shot) {
      // Charge : des étincelles aspirées vers l'attaquant
      atk.emit += dt;
      const count = Math.floor(atk.emit / 16.67) * 3;
      atk.emit %= 16.67;
      for (let i = 0; i < count; i++) {
        const ang = rand(0, Math.PI * 2);
        const r = atk.size * rand(0.7, 1.1);
        spawn({
          x: atk.a.x + Math.cos(ang) * r, y: atk.a.y + Math.sin(ang) * r,
          vx: -Math.cos(ang) * r / 9, vy: -Math.sin(ang) * r / 9, life: 160, size: rand(4, 9), color: atk.color,
        });
      }
    }
    return t < CHARGE_MS + SHOT_MS + BOOM_MS;
  }

  // Assombrissement de l'arène : monte pendant la charge, retombe après l'impact.
  function dimOf(atk) {
    const { t } = atk;
    if (t < CHARGE_MS) return 0.3 * (t / CHARGE_MS);
    if (t < CHARGE_MS + SHOT_MS) return 0.3;
    return 0.3 * Math.max(0, 1 - (t - CHARGE_MS - SHOT_MS) / 300);
  }

  function drawAttack(atk) {
    const { t } = atk;
    if (t < CHARGE_MS + 120) {
      // L'aura grossit autour de l'attaquant (et s'éteint juste après le tir)
      const grow = Math.min(1, t / CHARGE_MS);
      const fade = t < CHARGE_MS ? 1 : 1 - (t - CHARGE_MS) / 120;
      drawGlow(atk.color, atk.a.x, atk.a.y, atk.size * (0.4 + 0.75 * grow), 0.85 * fade);
      drawGlow(atk.color, atk.a.x, atk.a.y, atk.size * 0.3 * grow, 0.9 * fade);
    }
    if (atk.shot && !atk.hit) atk.kind.draw(atk.x, atk.y, atk.size, atk.dir, t);
    if (atk.hit) {
      // Onde de choc circulaire
      const p = (t - CHARGE_MS - SHOT_MS) / BOOM_MS;
      const r = atk.boomSize * (0.2 + 1.3 * Math.sqrt(p));
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.lineWidth = Math.max(1, 14 * (1 - p));
      ctx.strokeStyle = rgba(atk.color, 1);
      ctx.beginPath();
      ctx.ellipse(atk.b.x, atk.b.y, r, r * 0.75, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = rgba(C.white, 1);
      ctx.lineWidth = Math.max(1, 5 * (1 - p));
      ctx.beginPath();
      ctx.ellipse(atk.b.x, atk.b.y, r * 0.8, r * 0.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function frame(now) {
    // Pendant l'arrêt sur image (hit-stop), les effets se figent aussi.
    const frozen = document.body.classList.contains('hitstop');
    const dt = frozen ? 0 : Math.min(50, now - last);
    last = now;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);

    for (let i = attacks.length - 1; i >= 0; i--) {
      if (!updateAttack(attacks[i], dt)) attacks.splice(i, 1);
    }
    updateParticles(dt);

    const dim = attacks.reduce((m, atk) => Math.max(m, dimOf(atk)), 0);
    if (dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dim})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'lighter';
    attacks.forEach(drawAttack);
    drawParticles();
    ctx.globalAlpha = 1;

    if (attacks.length || particles.length) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
    }
  }

  // Lance fn quand toutes les attaques en vol ont touché (ex. avant le K.O.).
  function whenIdle(fn) {
    if (inFlight === 0) fn();
    else idleWaiters.push(fn);
  }

  // Coupe tout (nouvelle partie, fin de partie).
  function clear() {
    attacks.forEach((atk) => {
      atk.from.classList.remove('charging');
      if (!atk.hit && atk.onImpact) atk.onImpact();
    });
    attacks.length = 0;
    particles.length = 0;
    inFlight = 0;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((fn) => fn());
  }

  return {
    init, fire, whenIdle, clear, busy: () => inFlight > 0,
  };
})();
