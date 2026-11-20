# C'est pas le mot que tu crois

**Jouer en ligne : https://pas-le-mot.onrender.com/**

Mots croisés multijoueur en temps réel : deux joueurs font la course sur la même grille de 12 mots très croisés, moitié mots classiques, moitié argot. Mot juste = un point par lettre, mot faux -1, 2 minutes de chrono.

## Jouer en local
```bash
npm install
npm run dev
```
Puis ouvrir http://localhost:3000 dans deux onglets (un par joueur), choisir un pseudo dans chacun et cliquer « Trouver une partie ».

## Comment jouer
- Clique une case ou une définition pour choisir un mot. Un deuxième clic sur une case de croisement change de direction.
- Tape les lettres (les accents sont ignorés), Retour arrière pour effacer, flèches pour te déplacer.
- Entrée valide le mot : juste = un point par lettre et le mot prend ta couleur chez les deux joueurs ; faux = -1 et ce mot est bloqué 3 secondes pour toi.
- « Acheter une lettre (-1) » révèle une lettre du mot sélectionné, à toi seul.
- C'est un combat : chacun a 100 PV. Un mot trouvé frappe l'adversaire (3 dégâts par lettre), une erreur te coûte 5 PV, une lettre achetée 3 PV. K.O. à 0 PV ; au bout de 2 minutes, le plus de PV gagne.
- Avant la partie, choisis un avatar. Sa super attaque (bouton à côté de « Acheter une lettre ») sert 1 fois par partie : Freeze (Le Givré), Trip (Le Perché) ou Verlan (Le Verlan). Une vidéo plein écran se joue chez les deux joueurs. Pas de super attaque en solo.
- Gelé par un Freeze ? Racle le givre de ton avatar en passant vite ta souris d'un bord à l'autre, plusieurs fois.
- Pour jouer contre un ami précis : « Créer un salon privé », puis envoie-lui le code ou le lien. Il clique « Rejoindre ».
- Le bouton « SON : ON/OFF » en haut à droite coupe les sons.

## Tests
```bash
npm test
```
Les tests lancent le vrai serveur et simulent deux joueurs avec `socket.io-client` : matchmaking, validation, chrono, anti-spam, achat de lettre, déconnexion, envois absurdes (« casser le jeu »), et vérification qu'aucune solution n'est envoyée au navigateur.

## Organisation du code
| Fichier | Rôle |
|---|---|
| `server.js` | Express + Socket.io : reçoit les événements et répond |
| `matchmaking.js` | File d'attente et salons (repris du morpion) |
| `game.js` | Une partie : validation des mots, PV et dégâts, K.O., blocage, achat de lettre, pouvoirs |
| `powers.js` | Les avatars et leurs pouvoirs |
| `grid.js` | Pioche les mots et les place dans une grille qui se croise |
| `data/mots.json` | La bibliothèque de mots et de définitions |
| `public/` | La page du jeu (HTML, CSS, JS sans framework) ; `public/assets/` : visuels des avatars, vidéos de super attaque |
| `scripts/prepare-assets.js` | Prépare images et vidéos (`npm run assets`, nécessite ffmpeg) |
| `tests/` | Les tests automatiques |

## Mise en ligne (Render)
Web Service Node : commande de build `npm install`, commande de démarrage `npm start`. Le port est fourni par Render (`PORT`).

Variable facultative : `GAME_DURATION_MS` (durée d'une partie en millisecondes, 120000 par défaut).

Règles du jeu : `docs/brief.md`. Avancement : `docs/roadmap.md`.

## Préparer les images et vidéos
1. Dépose les fichiers bruts dans `~/Documents/01-Projets/pas-le-mot/assets-src/` :
   - `givre.jpeg`, `perche.jpeg`, `verlan.jpeg` : les avatars, tournés vers la droite, sur un fond uni ;
   - `givre.gif`, `perche.gif`, `verlan.gif` : les mêmes, animés (boucle), sur fond vert ;
   - `givre-cine.gif`, `perche-cine.gif`, `verlan-cine.gif` : les mini-cinématiques de coup critique (3 s) ;
   - `givre-cine.mp4`, `perche-cine.mp4`, `verlan-cine.mp4` : les vidéos de super attaque (une dizaine de secondes), et si tu veux `givre-cine.jpeg`... : l'image affichée le temps que la vidéo démarre ;
   - `arene.gif` : le fond d'arène animé, et `arene.jpeg` : son image de secours ;
   - `musique-combat.mp3` : la musique (convertie en .ogg compressé + .mp3 pour Safari, dans `public/assets/music/`).

Nouvelle version d'une vidéo : ajoute `-v2`, `-v3`... au nom (ex. `perche-cine-v2.mp4`). Le script prend toujours la version la plus récente. Les persos animés produisent aussi `avatars/sprites.json` (où est le corps dans chaque image), dont le jeu se sert pour les poser au sol à la même taille.
2. Lance (ffmpeg doit être installé) :
```bash
npm run assets
```
3. Les fichiers prêts arrivent dans `public/assets/` :
   - persos animés : `avatars/givre.webp`... (WebP animé transparent, fond retiré image par image, même cadrage pour toutes les images, reflets verts du Givré et du Verlan corrigés) ;
   - coups critiques : `cine/givre-crit.webm`... (moins de 1,5 Mo, sans son) ;
   - avatars : le fond est retiré par un remplissage qui part des bords de l'image (la fumée verte du Perché, au milieu, est gardée), puis recadrés au plus près du perso et réduits à 160 px de haut, pixels nets ;
   - arène : `arene.webm` (boucle vidéo agrandie sans lissage) et `arene.jpg` (secours) ;
   - vidéos de super attaque : gardées entières (on ne coupe que les images noires ou figées tout au début et à la fin, 0,5 s maximum de chaque côté), en .webm 720p de moins de 4 Mo, plus `cine/durations.json` (la durée de chaque vidéo, lue par le serveur pour mettre le chrono en pause juste le temps qu'il faut).

Remplacer une vidéo (par exemple celle du Perché) : dépose le nouveau fichier sous le même nom dans `assets-src/` et relance `npm run assets`. Les navigateurs la rechargent d'eux-mêmes.

Pour ne refaire qu'une partie (plus rapide) : `ONLY=gif npm run assets` (ne traite que les fichiers dont le nom contient « gif »).

Trop ou pas assez de fond retiré ? Règle la tolérance : `BG_TOLERANCE=50 npm run assets` (défaut 70, 34 pour le Perché pour garder sa fumée verte).

Dans l'arène, le perso de droite est affiché en miroir pour que les deux se fassent face : dessine-les tous les deux tournés vers la droite.
