// Les avatars et leurs pouvoirs (règles dans docs/brief.md, lot L3).
// Les durées vivent ici : le serveur les envoie au navigateur avec chaque pouvoir.
const AVATARS = {
  givre: { power: 'freeze' }, // Le Givré : 3 cases gelées
  perche: { power: 'trip' }, // Le Perché : écran flou, seul un cercle net suit la souris
  verlan: { power: 'verlan' }, // Le Verlan : écran retourné, mots à remplir par la fin
};

const DEFAULT_AVATAR = 'givre';
const USES_PER_GAME = 2;
const POWER_DURATION_MS = 10000;
const FREEZE_CELLS = 3;

// N'accepte qu'un avatar de la liste (le client peut envoyer n'importe quoi).
function cleanAvatar(raw) {
  return typeof raw === 'string' && Object.hasOwn(AVATARS, raw) ? raw : DEFAULT_AVATAR;
}

module.exports = { AVATARS, USES_PER_GAME, POWER_DURATION_MS, FREEZE_CELLS, cleanAvatar };
