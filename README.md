# C'est pas le mot que tu crois

**Jouer en ligne : https://pas-le-mot.onrender.com/**

Mots croisés multijoueur en temps réel : deux joueurs font la course sur la même grille de 8 à 10 mots, moitié mots classiques, moitié argot. Mot juste +1, mot faux -1, 2 minutes de chrono.

## Jouer en local
```bash
npm install
npm run dev
```
Puis ouvrir http://localhost:3000 dans deux onglets (un par joueur), choisir un pseudo dans chacun et cliquer « Trouver une partie ».

## Comment jouer
- Clique une case ou une définition pour choisir un mot. Un deuxième clic sur une case de croisement change de direction.
- Tape les lettres (les accents sont ignorés), Retour arrière pour effacer, flèches pour te déplacer.
- Entrée valide le mot : juste = +1 et le mot prend ta couleur chez les deux joueurs ; faux = -1 et ce mot est bloqué 3 secondes pour toi.
- « Acheter une lettre (-1) » révèle une lettre du mot sélectionné, à toi seul.
- La partie s'arrête au bout de 2 minutes ou quand la grille est pleine. Le plus gros score gagne.
- Avant la partie, choisis un avatar. Son pouvoir (bouton à côté de « Acheter une lettre ») sert 2 fois par partie : Freeze (Le Givré), Trip (Le Perché) ou Verlan (Le Verlan). Pas de pouvoir en solo.
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
| `game.js` | Une partie : validation des mots, scores, blocage, achat de lettre, pouvoirs |
| `powers.js` | Les avatars et leurs pouvoirs |
| `grid.js` | Pioche les mots et les place dans une grille qui se croise |
| `data/mots.json` | La bibliothèque de mots et de définitions |
| `public/` | La page du jeu (HTML, CSS, JS sans framework), avec `sprites.js` pour les personnages 8 bits |
| `tests/` | Les tests automatiques |

## Mise en ligne (Render)
Web Service Node : commande de build `npm install`, commande de démarrage `npm start`. Le port est fourni par Render (`PORT`).

Variable facultative : `GAME_DURATION_MS` (durée d'une partie en millisecondes, 120000 par défaut).

Règles du jeu : `docs/brief.md`. Avancement : `docs/roadmap.md`.
