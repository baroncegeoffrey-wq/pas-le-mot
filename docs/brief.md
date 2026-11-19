# C'est pas le mot que tu crois

**En 5 lignes**
1. Un combat de mots croisés en ligne, façon JRPG : 2 joueurs, face à face dans une arène, sur la même grille de 12 mots très croisés (chaque mot trouvé donne des lettres à ceux qu'il croise).
2. La moitié des mots est classique, l'autre moitié vient de l'argot d'aujourd'hui (vulgaire autorisé). Ce sont des mots qui existent, avec de vraies définitions.
3. Chacun a 100 PV. Tu remplis les cases d'un mot puis tu appuies sur Entrée : juste = tu frappes l'adversaire (3 dégâts par lettre), faux = 5 dégâts de recul pour toi.
4. Un mot validé s'affiche chez les deux joueurs dans la couleur de celui qui l'a trouvé, et ses lettres aident pour les mots qui le croisent.
5. K.O. dès qu'un joueur tombe à 0 PV. Sinon, au bout de 2 minutes (ou grille pleine), celui qui a le plus de PV gagne.

---

## Règles détaillées

**Déroulé**
- Le joueur choisit un pseudo, clique « Trouver une partie », et il est apparié avec le prochain joueur en attente (même système que le morpion).
- Les deux joueurs reçoivent la même grille, tirée au hasard dans la bibliothèque de mots.
- Avant de jouer, un compte à rebours « 3, 2, 1, GO ! » (3,5 s) : rien ne compte avant le GO.
- Chrono : 2 minutes. Les 30 dernières secondes deviennent de plus en plus stressantes (30 s, 20 s, puis compte à rebours géant sur les 10 dernières).

**La grille partagée**
- Les deux joueurs jouent sur la même grille.
- Ce que tu tapes reste chez toi tant que tu n'as pas validé (sinon l'adversaire verrait tes réponses en direct).
- Dès qu'un mot est validé, il est révélé chez les deux, dans la couleur du joueur qui l'a trouvé. Il est verrouillé et plus personne ne peut le jouer.
- Ses lettres apparaissent dans les mots qui le croisent.

**Combat (points de vie)**
| Action | Effet |
|---|---|
| Départ | 100 PV chacun |
| Mot juste | Dégâts à l'adversaire = lettres × 3 (FLEX = 12, CHAUSSETTE = 30) |
| Mot faux | 5 PV de dégâts de recul pour toi, et ce mot est bloqué 3 secondes pour toi (anti-spam) |
| Acheter une lettre (révélée pour toi seul) | 3 PV |

- Les PV ne descendent jamais sous 0. À 0 PV : K.O., la partie s'arrête tout de suite (on peut aussi se mettre K.O. tout seul à force d'erreurs).
- Au chrono (ou grille pleine) : le plus de PV gagne. Égalité : affichée comme telle.
- Le serveur calcule tout ; le navigateur ne fait qu'afficher.

**Ressenti des coups**
- Chaque coup : arrêt sur image de 80 ms, tremblement de l'écran proportionnel aux dégâts, flash blanc et recul de la cible, chiffre de dégâts qui jaillit, étincelles et sang stylisé (pixels).
- K.O. : ralenti, zoom sur celui qui tombe, grand « K.O. », puis l'écran de fin.

**Comparaison des réponses**
- Sans tenir compte des majuscules ni des accents : « frérot » = « FREROT ».

**Fin de partie**
- K.O., chrono à zéro, ou tous les mots trouvés.
- Écran de résultat : gagnant (par K.O. ou aux PV) et perdant, PV restants, stats de chacun (dégâts infligés, mots trouvés, erreurs, lettres achetées, super attaques), puis toutes les réponses de la partie (mot, définition, qui l'a trouvé). Boutons « Rejouer » et « Accueil ».
- Si un joueur se déconnecte, l'autre est prévenu (« Adversaire déconnecté »).

## Mode solo

- Bouton « Jouer seul » à l'accueil : la partie démarre tout de suite, sans adversaire.
- On frappe un mannequin d'entraînement (100 PV). Mêmes règles qu'à deux : chrono de 2 minutes, dégâts lettres × 3, recul de 5 PV par erreur, lettre achetée à 3 PV.
- Fin au K.O. du mannequin, au chrono ou quand la grille est pleine. L'écran de fin affiche les dégâts infligés et le nombre de mots trouvés.
- « Rejouer » relance une partie solo.

## Avatars et pouvoirs (lot 3)

Avant la partie, chaque joueur choisit un avatar. Chaque avatar a une **super attaque, une seule fois par partie**. Pas de super attaque en mode solo.

Quand elle est lancée, une **vidéo plein écran** se joue chez les deux joueurs en même temps (le serveur fixe l'heure de départ, 0,6 s après le clic), se termine par un flash blanc, puis l'effet du pouvoir s'applique. Les vidéos : `public/assets/cine/givre.webm`, `perche.webm`, `verlan.webm` (environ 10 s chacune, préchargées au début de la partie). Tant qu'une vidéo n'existe pas, un flash blanc la remplace.

Pendant la vidéo, **le chrono est en pause pour les deux joueurs** et plus rien ne passe (mots, lettres achetées, super attaque adverse) : le serveur repousse la fin de partie de la durée exacte de la vidéo (lue dans `cine/durations.json`) et tout reprend au flash final. Le gel du Givré commence lui aussi à ce moment-là.

| Avatar | Pouvoir | Effet chez l'adversaire |
|---|---|---|
| Le Givré | Freeze | Il est gelé : il ne peut plus rien faire (ni taper, ni valider, ni acheter, ni lancer son pouvoir). Son avatar apparaît en grand, couvert de 30 couches de givre. Il doit le racler avec la souris : chaque passage rapide d'un bord à l'autre enlève une couche. S'il arrête de racler, une couche repousse chaque seconde. Pas de dégivrage avant 2 s, et dégivrage automatique au bout de 45 s. On ne peut pas geler quelqu'un qui l'est déjà |
| Le Perché | Trip | Pendant 20 s, tout son écran devient flou et psychédélique (couleurs qui ondulent). Seul un petit cercle net suit sa souris (et la case où il tape) : il doit se promener pour lire |
| Le Verlan | Verlan | Pendant 20 s, tout son écran est retourné comme dans un miroir (grille et définitions à lire à l'envers) et il doit remplir les mots en partant de la fin. Chez les deux joueurs, le décor de l'arène se retourne la tête en bas (les persos restent debout), avec des fissures et des débris, puis revient à la fin |

- Si un Trip ou un Verlan touche alors que le même effet est déjà en cours, l'effet repart pour 20 s.
- Pour l'instant, les avatars sont de simples badges de couleur. Plus tard : des petits personnages 8 bits originaux (voir « Après le rendu » dans la roadmap).

## Les mots

- Ils viennent d'une bibliothèque écrite à l'avance (`data/mots.json`). Pas d'API, pas d'IA pendant la partie.
- À chaque partie, on pioche des mots au hasard (moitié classique, moitié argot) et un algorithme les place dans une grille qui se croise.
- Règle absolue : pas de mot inventé, pas de fausse définition.

## Design

- Direction « Néon acide » : maquette https://claude.ai/artifact/PYEdxibqoKmARi29Gpj1wJ (direction D ; privée, à partager depuis la page si besoin).
- Une arène en haut de l'écran : moi à gauche sur une plateforme verte, l'adversaire à droite sur une plateforme rose, devant une ville de nuit.
- Arène : les deux avatars face à face au-dessus de la grille, sur leurs plateformes, devant la ville de nuit, avec leurs barres de PV animées (la partie perdue reste blanche un instant).
- Un seul visuel par avatar : `public/assets/avatars/<avatar>.png` (160 px de haut, pixels nets).
- Les avatars sont dessinés tournés vers la droite ; celui de droite est affiché en miroir pour que les deux se fassent face.
- Fond d'arène : `arene.webm` en boucle (pixels nets), sinon l'image de secours `arene.jpg`, sinon la ville de nuit en CSS.
- Les images et vidéos se préparent avec `npm run assets` (voir `scripts/prepare-assets.js`) à partir de `~/Documents/01-Projets/pas-le-mot/assets-src/` (sources en .jpeg) : fond retiré par remplissage depuis les bords (une couleur proche du fond à l'intérieur du perso, comme la fumée verte du Perché, est gardée), recadrage au plus près, sprites réduits à 160 px sans lissage ; `arene.gif` converti en .webm en boucle ; vidéos de super attaque (`<avatar>-cine.mp4`) gardées entières, seules les images noires ou figées tout au début et à la fin sont coupées (0,5 s maximum de chaque côté), en .webm 720p de moins de 4 Mo.

## Salons privés et attente

- « Créer un salon privé » donne un code de 4 lettres (sans I ni O) et un lien d'invitation (`?salon=CODE`). L'ami rejoint avec le code ou en ouvrant le lien ; la partie démarre dès qu'il arrive. Un code ne sert qu'une fois.
- Pendant l'attente (file publique ou salon privé) : le personnage fait les cent pas, un chrono d'attente, « Copier le lien » et « Annuler ».

## Sons et téléphone

- Sons fabriqués dans le navigateur (aucun fichier, aucun service) : compte à rebours, mot juste ou faux, alertes, battement de cœur des 30 dernières secondes, super attaque, givre, fin. Un bouton « SON : ON/OFF » les coupe (choix retenu).
- Sur téléphone : la grille s'adapte à la largeur de l'écran, le Trip suit le doigt et le Freeze se racle au doigt.
