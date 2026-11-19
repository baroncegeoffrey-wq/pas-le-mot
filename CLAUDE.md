# Projet : C'est pas le mot que tu crois

Un jeu de mots croisés multijoueur en temps réel : 2 joueurs font la course sur la même grille, avec des mots classiques et des mots d'argot. La règle complète du jeu est dans `docs/brief.md`, et l'avancement dans `docs/roadmap.md`.

## Où trouver quoi
- `docs/brief.md` : les règles du jeu (ce qui fait foi)
- `docs/roadmap.md` : les lots, à cocher quand un lot est livré ET en ligne
- `data/mots.json` : la bibliothèque de mots (mot, affichage, définition, type)
- `server.js` : Express + Socket.io, branche les événements
- `game.js` : la logique d'une partie (grille, validation, score, chrono, pouvoirs), sans Socket.io
- `grid.js` : le placement des mots dans une grille qui se croise
- `matchmaking.js` : la file d'attente et les salons (repris du morpion)
- `public/` : index.html, style.css, client.js

## Stack
- Node.js + Express : serveur HTTP, sert les fichiers statiques
- Socket.io : temps réel
- HTML / CSS / JavaScript natifs côté client, pas de framework
- Pas de base de données : les parties vivent en mémoire, les mots dans `data/mots.json`
- Pas d'API d'IA dans le jeu
- Déploiement sur Render (Web Service), jamais sur Vercel, Netlify ou GitHub Pages : le jeu a besoin d'un serveur qui reste allumé

## Règles
1. Le serveur fait autorité. Il valide chaque mot, calcule les scores, gère le chrono et les pouvoirs. Le client ne fait qu'afficher.
2. **Le serveur n'envoie jamais les solutions au client.** Le client reçoit la grille vide (positions, longueurs, numéros, définitions). Une lettre n'est envoyée que lorsqu'un mot est trouvé (aux deux joueurs) ou achetée (à l'acheteur seul).
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
| `find-game` | client → serveur | `{ pseudo, avatar }` |
| `play-solo` | client → serveur | `{ pseudo }` (mode solo) |
| `waiting` | serveur → client | |
| `game-start` | serveur → clients | `{ roomId, grid, clues, you, opponent, endsAt, serverNow }` (sans solutions ; `opponent` vaut `null` en solo) |
| `submit-word` | client → serveur | `{ roomId, wordId, letters }` |
| `word-claimed` | serveur → clients | `{ wordId, letters, by, scores }` |
| `word-wrong` | serveur → client fautif | `{ wordId, scores, lockedUntil, serverNow }` |
| `word-locked` | serveur → client fautif | `{ wordId, lockedUntil, serverNow }` (renvoi pendant le blocage, sans pénalité) |
| `scores` | serveur → adversaire | `{ scores }` (après une erreur ou un achat de l'autre joueur) |
| `buy-letter` | client → serveur | `{ roomId, wordId }` |
| `letter-revealed` | serveur → acheteur | `{ wordId, index, letter, scores }` |
| `use-power` | client → serveur | `{ roomId }` |
| `power-hit` | serveur → cible | `{ power, duration, payload }` |
| `game-over` | serveur → clients | `{ scores, winner }` (en solo : `{ scores: [score], winner: null, found, total }`) |
| `opponent-left` | serveur → client | |

## Conventions
- Commentaires de code en français
- Noms de variables et de fonctions en anglais

## Charte graphique (provisoire, à remplacer)
- Fond sombre `#14161F`, cases claires `#F2EEE3`, texte `#1A1A1A`
- Joueur 1 : bleu `#3A7BD5` / Joueur 2 : rouge `#D64545`
- Police : système, sans-serif
- Direction prévue pour plus tard : JRPG rétro au tour par tour, avec des fenêtres de menu bleues à bord clair, une police pixel et des avatars originaux. Ne reprendre aucun personnage ni visuel d'un jeu existant.

## À ne pas faire
- Ne jamais faire confiance au client pour valider un mot ou un score
- Ne jamais envoyer les solutions au navigateur
- Pas de framework frontend, pas de base de données
- Pas de console.log de débogage laissé dans le code final (garder connexion/déconnexion)
