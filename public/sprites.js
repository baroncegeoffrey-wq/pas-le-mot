// Les personnages 8 bits (originaux), dessinés pixel par pixel : 16 × 16.
// Chaque lettre d'une ligne est un pixel, sa couleur vient de la palette ;
// un point = transparent. Utilisé par client.js via drawSprite().
const SPRITES = {
  givre: {
    name: 'Le Givré',
    map: [
      '......b..b......',
      '.....bwbbwb.....',
      '....kkkkkkkk....',
      '...kbbbbbbbbk...',
      '..kbwwwwwwwwbk..',
      '..kwwwwwwwwwwk..',
      '..kwwkwwwwkwwk..',
      '..kwwkwwwwkwwk..',
      '..kwpwwwwwwpwk..',
      '..kwwwwkkwwwwk..',
      '...kwwwwwwwwk...',
      '..kddddddddddk..',
      '.kbkddbddbddkbk.',
      '..kkddddddddkk..',
      '...kwwk..kwwk...',
      '...kkkk..kkkk...',
    ],
    palette: { k: '#14243a', b: '#7fd3f5', w: '#f4fbff', d: '#3a7bd5', p: '#f6a5b8' },
  },
  perche: {
    name: 'Le Perché',
    map: [
      '..........ccc...',
      '.........ccccc..',
      '....kkkkkk.cc...',
      '...khhhhhhk.....',
      '..khhhhhhhhk....',
      '..khkkkkkkhhk...',
      '..khsssssskhk...',
      '..ksswksswkhk...',
      '..kswkwswkskk...',
      '..ksswksswsk....',
      '..kssssmmssk....',
      '...kkssssskk....',
      '..khhhhhhhhhk...',
      '.kshhHhhhHhhsk..',
      '..kkhhhhhhhkk...',
      '...kHHk..kHHk...',
    ],
    palette: { k: '#2a1838', h: '#b57bf0', H: '#7a48b8', s: '#f2c79b', w: '#ffffff', c: '#d9d2ea', m: '#c2566f' },
  },
  verlan: {
    name: 'Le Verlan',
    map: [
      '................',
      '....kkkkkkk.....',
      '...kooooooook...',
      '..kOoooooooook..',
      'kkkOOOOOOOOOk...',
      'kOOkkkkkkkkkk...',
      '..ksssssssssk...',
      '..kssksssskssk..',
      '..ksswsssswssk..',
      '..ksssssssssk...',
      '...ksskkkssk....',
      '..kttttttttttk..',
      '.ksttwttttttstk.',
      '..kkjjjjjjjjkk..',
      '...kjjk..kjjk...',
      '...kkkk..kkkk...',
    ],
    palette: { k: '#2b1a0e', o: '#f5a442', O: '#c46d12', s: '#e8b48a', w: '#ffffff', t: '#3fb6a8', j: '#3a4f8a' },
  },
};

// Dessine le personnage `who` dans un <canvas>, agrandi `px` fois (pixels nets).
function drawSprite(canvas, who, px) {
  const sprite = SPRITES[who] || SPRITES.givre;
  canvas.width = 16;
  canvas.height = 16;
  canvas.style.width = `${16 * px}px`;
  canvas.style.height = `${16 * px}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', sprite.name);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 16, 16);
  sprite.map.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const color = sprite.palette[ch];
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });
  });
}
