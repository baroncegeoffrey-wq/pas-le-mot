# Projet : C'est pas le mot que tu crois

Un jeu de mots croisés multijoueur en temps réel : 2 joueurs font la course sur la même grille, avec des mots classiques et des mots d'argot. La règle complète du jeu est dans `docs/brief.md`, et l'avancement dans `docs/roadmap.md`.

## Où trouver quoi
- `docs/brief.md` : les règles du jeu (ce qui fait foi)
- `docs/roadmap.md` : les lots, à cocher quand un lot est livré ET en ligne
- `data/mots.json` : la bibliothèque de mots (mot, affichage, définition, type)
- `server.js` : Express + Socket.io, branche les événements
- `game.js` : la logique d'une partie (grille, validation, combat en PV, K.O., pouvoirs), sans Socket.io
- `grid.js` : le placement des mots dans une grille qui se croise
- `matchmaking.js` : la file d'attente et les salons (repris du morpion)
- `powers.js` : les avatars, leurs pouvoirs et leurs durées
- `public/` : index.html, style.css, client.js, attack.js (les attaques à chaque mot : charge, projectile, explosion, sur un canvas), sounds.js (les sons, fabriqués avec Web Audio, et la musique de combat : objet `Music`)
- `public/assets/` : `avatars/<avatar>.png` (un visuel fixe par avatar, tourné vers la droite) et `avatars/<avatar>.webp` (le même, animé, utilisé en combat) + `avatars/sprites.json` (où est le corps dans chaque image, pour poser les persos au sol), `music/musique-combat.ogg` (+ `.mp3` pour Safari), `cine/<avatar>-crit.webm` (mini-cinématique de coup critique, 3 s), `cine/<avatar>.webm` (vidéos de super attaque) + `cine/<avatar>.jpg` (image d'attente) + `cine/durations.json` (durées en secondes, lues par powers.js), `arena/arene.webm` (fond en boucle) et `arena/arene.jpg` (secours)
- `scripts/prepare-assets.js` : prépare images et vidéos depuis `assets-src/` (`npm run assets`, nécessite ffmpeg)

## Stack
- Node.js + Express : serveur HTTP, sert les fichiers statiques
- Socket.io : temps réel
- HTML / CSS / JavaScript natifs côté client, pas de framework
- Pas de base de données : les parties vivent en mémoire, les mots dans `data/mots.json`
- Pas d'API d'IA dans le jeu
- Déploiement sur Render (Web Service), jamais sur Vercel, Netlify ou GitHub Pages : le jeu a besoin d'un serveur qui reste allumé

## Règles
1. Le serveur fait autorité. Il valide chaque mot, calcule les PV et les dégâts, décide du K.O., gère le chrono et les pouvoirs. Le client ne fait qu'afficher.
2. **Le serveur n'envoie jamais les solutions au client pendant la partie.** Le client reçoit la grille vide (positions, longueurs, numéros, définitions). Une lettre n'est envoyée que lorsqu'un mot est trouvé (aux deux joueurs) ou achetée (à l'acheteur seul). Toutes les réponses ne partent qu'avec `game-over`, une fois la partie terminée.
3. Les réponses sont comparées sans majuscules ni accents.
4. Un mot trouvé est verrouillé : aucun des deux joueurs ne peut plus le jouer.
5. Si deux joueurs valident le même mot en même temps, le premier message reçu par le serveur gagne.
6. Une info vit à un seul endroit : les règles dans le brief, les mots dans `data/mots.json`. Pas de mot codé en dur ailleurs.
7. Un lot à la fois. Avant de coder, tu expliques ton plan en 5 lignes et tu attends mon accord.
8. Après chaque modification, tu m'expliques ce que tu as changé comme à un débutant, en indiquant les fichiers et les fonctions concernés.
9. Un commit par étape qui marche, avec un message clair en français.
10. Tu ne retires ni ne modifies un mot de `data/mots.json` sans me le demander. Tu n'inventes jamais de mot ni de définition.

## Événements Socket.io (noms stables, en anglais)
| Événement | Sens | Contenu |
|---|---|---|
| `find-game` | client → serveur | `{ pseudo, avatar }` (avatar : `givre`, `perche` ou `verlan`) |
| `play-solo` | client → serveur | `{ pseudo }` (mode solo) |
| `waiting` | serveur → client | |
| `game-start` | serveur → clients | `{ roomId, grid, clues, you, opponent, startsAt, endsAt, maxHp, serverNow }` (`startsAt` = le « GO » après le compte à rebours ; rien n'est accepté avant) (sans solutions ; `you` = `{ pseudo, slot, avatar, powersLeft }`, `opponent` = `{ pseudo, slot, avatar }` ou `null` en solo) |
| `submit-word` | client → serveur | `{ roomId, wordId, letters }` |
| `word-claimed` | serveur → clients | `{ wordId, letters, by, target, damage, critical, heal, hp }` (`hp` = PV des deux joueurs, après dégâts et soin ; `critical` = mot de 7 lettres ou plus, dégâts × 1,5 ; `heal` = PV rendus à `by`) |
| `word-wrong` | serveur → client fautif | `{ wordId, target, damage, hp, lockedUntil, serverNow }` |
| `word-locked` | serveur → client fautif | `{ wordId, lockedUntil, serverNow }` (renvoi pendant le blocage de 3 s, sans pénalité) |
| `hp` | serveur → adversaire | `{ target, damage, hp }` (recul ou lettre achetée par l'autre joueur) |
| `buy-letter` | client → serveur | `{ roomId, wordId }` |
| `letter-revealed` | serveur → acheteur | `{ wordId, index, letter, target, damage, hp }` |
| `use-power` | client → serveur | `{ roomId }` |
| `power-hit` | serveur → cible | `{ power, duration, payload, from, cine }` (`cine` = `{ avatar, at, durationMs, resumeAt, endsAt, serverNow }` : la vidéo démarre à l'heure `at` du serveur chez les deux joueurs ; chrono en pause et saisies ignorées jusqu'à `resumeAt` ; `endsAt` = nouvelle fin de partie) (`power` : `freeze`, `trip` ou `verlan` ; `payload.layers` = couches de givre pour le Freeze) |
| `power-used` | serveur → lanceur | `{ power, remaining, duration, cine }` |
| `power-refused` | serveur → lanceur | `{ reason }` (solo, plus d'utilisation, déjà gelé, partie finie) |
| `scrape` | client gelé → serveur | `{ roomId }` (un coup de raclette sur son avatar) |
| `focus-word` | client → serveur | `{ roomId, wordId }` (le mot que je viens de sélectionner ; envoyé seulement quand il change) |
| `opponent-focus` | serveur → adversaire | `{ wordId }` (seulement l'identifiant, jamais les lettres ; un message par changement de mot) |
| `frost` | serveur → client gelé | `{ layers }` (couches de givre restantes, après un coup ou quand ça repousse) |
| `unfrozen` | serveur → clients | `{ slot }` (ce joueur est dégivré et peut rejouer) |
| `game-over` | serveur → clients | `{ hp, winner, ko, stats, solutions }` (`ko` = slot tombé à 0 PV ou null ; en solo : `{ hp, winner, ko, found, total, stats, solutions }`, le slot 1 étant le mannequin) ; `stats[slot]` = `{ found, wrong, bought, powers, damage }`, `solutions` = `[{ number, direction, word, clue, foundBy }]` |
| `opponent-left` | serveur → client | |
| `create-room` | client → serveur | `{ pseudo, avatar }` (salon privé) |
| `room-created` | serveur → client | `{ code }` (4 lettres, à partager) |
| `join-room` | client → serveur | `{ code, pseudo, avatar }` |
| `room-error` | serveur → client | `{ reason }` (code inconnu ou salon fermé) |
| `cancel-search` | client → serveur | (quitte la file d'attente ou le salon privé) |
| `search-cancelled` | serveur → client | |

## Conventions
- Commentaires de code en français
- Noms de variables et de fonctions en anglais

## Charte graphique : « Néon acide »
- Ambiance : nuit, ville isométrique, néons acides, petits glitchs. Maquette de référence : direction D de la maquette (lien dans `docs/brief.md`).
- Couleurs (variables dans `public/style.css`, jamais en dur ailleurs) : fond `#0a0c12`, panneaux `#10131b`, texte `#e8ecf5`, moi = vert acide `#c6ff00`, l'adversaire = rose `#ff2a6d`, accents jaune `#f5e100` et cyan `#00e5ff`.
- Moi toujours à gauche, l'adversaire à droite.
- Polices (Google Fonts) : Silkscreen (titres, étiquettes), VT323 (texte).
- Personnages : un seul visuel par avatar, `public/assets/avatars/<avatar>.png` (fixe) et `.webp` (animé, en combat). Ne reprendre aucun personnage ni visuel d'un jeu ou d'une série existants (l'inspiration se limite à l'ambiance).
- Animations coupées si le système demande de réduire les animations.

## À ne pas faire
- Ne jamais faire confiance au client pour valider un mot, des dégâts ou des PV
- Ne jamais envoyer les solutions au navigateur
- Pas de framework frontend, pas de base de données
- Pas de console.log de débogage laissé dans le code final (garder connexion/déconnexion)
