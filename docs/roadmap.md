# Roadmap

Un lot est coché seulement quand il est livré ET en ligne sur Render.

## L1 · Le cœur jouable (jeudi) [x]
- [x] Projet initialisé (git, npm, express, socket.io), CLAUDE.md et docs/ commités
- [x] Serveur + matchmaking repris du morpion, avec pseudo
- [x] `grid.js` : pioche 8 à 10 mots (moitié classique, moitié argot) et les place dans une grille qui se croise
- [x] Affichage de la grille + liste des définitions numérotées
- [x] Saisie lettre par lettre dans les cases, Entrée pour valider le mot
- [x] Validation serveur : +1 / -1, mot révélé chez les deux dans la couleur du joueur
- [x] Les solutions ne partent jamais au navigateur (vérifié par `tests/game.test.js`, qui inspecte chaque message reçu par 2 joueurs simulés)
- [x] **En ligne sur Render** (https://pas-le-mot.onrender.com/), testé avec 2 joueurs simulés sur le site en ligne

## L2 · Une vraie partie (jeudi soir) [x]
- [x] Chrono 2 min affiché (montée de stress à 30, 20 et 10 s), fin au chrono ou grille pleine
- [x] Écran de fin (gagné / perdu / égalité) + Rejouer
- [x] Anti-spam : mot bloqué 3 s après une erreur
- [x] Acheter une lettre (-1)
- [x] Adversaire déconnecté géré
- [x] Tests « casser le jeu » passés
- [x] README

## L2 bis · Mode solo [x]
- [x] Bouton « Jouer seul » : partie à un joueur, mêmes règles
- [x] Écran de fin solo (score et mots trouvés) + Rejouer en solo
- [x] Tests à un joueur simulé

## L3 · Avatars et pouvoirs (vendredi matin, si L1 et L2 sont en ligne) [x]
- [x] Choix de l'avatar avant la partie (badges provisoires)
- [x] Le Givré : Freeze (adversaire bloqué jusqu'à ce qu'il racle le givre de son avatar (30 coups, repousse chaque seconde), 45 s max, vérifié par le serveur)
- [x] Le Perché : Trip (écran flou et psychédélique, un cercle net suit la souris, 20 s)
- [x] Le Verlan : Verlan (écran retourné en miroir, mots à remplir par la fin, 20 s)
- [x] 2 utilisations par partie, compteur affiché, pas de pouvoir en solo
- [x] **En ligne sur Render**, testé avec 2 joueurs simulés sur le site en ligne (nouveau Freeze compris)

## Après le rendu
- [x] Direction artistique « Néon acide » (dark, ville isométrique, néons, glitchs), d'après la maquette D
- [x] Petits personnages 8 bits originaux, face à face sur des plateformes isométriques, qui respirent
- [x] Super attaque vue par les deux joueurs : cinématique (1,2 s) puis rayon géant avec éclairs et impact (1,5 s), puis l'effet du pouvoir
- [x] Stats de fin de partie (mots trouvés, erreurs, lettres achetées, super attaques)
- [x] Réponses de la partie sur l'écran de fin (mot, définition, qui l'a trouvé)
- [x] Compte à rebours « 3, 2, 1, GO ! » au début
- [x] Aide « Comment jouer ? » sur l'accueil
- [x] Écran d'attente (personnage qui patiente, lien à copier, annuler)
- [x] Sons (avec bouton pour couper)
- [x] Téléphone (grille adaptée à l'écran, cartes compactes, Trip et Freeze au doigt)
- [x] Salons privés avec un code ou un lien d'invitation
- [x] Agrandir la bibliothèque de mots (175 mots : 95 argot dont verlan et gros mots, 80 classiques ; définitions plus difficiles)
