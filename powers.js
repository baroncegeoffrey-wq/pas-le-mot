// Les avatars et leurs pouvoirs (règles dans docs/brief.md, lot L3).
// Les durées vivent ici : le serveur les envoie au navigateur avec chaque pouvoir.
const AVATARS = {
  givre: { power: 'freeze' }, // Le Givré : l'adversaire est gelé jusqu'à ce qu'il racle son givre
  perche: { power: 'trip' }, // Le Perché : écran flou, seul un cercle net suit la souris
  verlan: { power: 'verlan' }, // Le Verlan : écran retourné, mots à remplir par la fin
};

const DEFAULT_AVATAR = 'givre';
const USES_PER_GAME = 2;
const POWER_DURATION_MS = 10000; // Trip et Verlan

// Freeze : le joueur gelé ne peut plus jouer. Il racle le givre de son avatar
// avec la souris : un coup de raclette rapide enlève une couche.
const FREEZE = {
  layers: 8, // couches de givre au départ
  minMs: 2000, // pas de dégivrage avant 2 s, même en raclant très vite
  // sécurité : dégivrage automatique au bout de 20 s (réglable pour les tests)
  maxMs: Number(process.env.FREEZE_MAX_MS) || 20000,
  regrowMs: 2000, // s'il arrête de racler, une couche repousse toutes les 2 s
  minScrapeGapMs: 80, // deux coups de raclette ne peuvent pas être plus rapprochés
};

// N'accepte qu'un avatar de la liste (le client peut envoyer n'importe quoi).
function cleanAvatar(raw) {
  return typeof raw === 'string' && Object.hasOwn(AVATARS, raw) ? raw : DEFAULT_AVATAR;
}

module.exports = {
  AVATARS, USES_PER_GAME, POWER_DURATION_MS, FREEZE, cleanAvatar,
};
