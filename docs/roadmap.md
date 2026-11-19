# Roadmap

Un lot est coché seulement quand il est livré ET en ligne sur Render.

## L1 · Le cœur jouable (jeudi) [ ]
- [x] Projet initialisé (git, npm, express, socket.io), CLAUDE.md et docs/ commités
- [x] Serveur + matchmaking repris du morpion, avec pseudo
- [x] `grid.js` : pioche 8 à 10 mots (moitié classique, moitié argot) et les place dans une grille qui se croise
- [x] Affichage de la grille + liste des définitions numérotées
- [x] Saisie lettre par lettre dans les cases, Entrée pour valider le mot
- [x] Validation serveur : +1 / -1, mot révélé chez les deux dans la couleur du joueur
- [x] Les solutions ne partent jamais au navigateur (vérifié par `tests/game.test.js`, qui inspecte chaque message reçu par 2 joueurs simulés)
- [ ] **En ligne sur Render**, testé à deux onglets

## L2 · Une vraie partie (jeudi soir) [ ]
- [x] Chrono 4 min affiché, fin au chrono ou grille pleine
- [x] Écran de fin (gagné / perdu / égalité) + Rejouer
- [x] Anti-spam : mot bloqué 3 s après une erreur
- [x] Acheter une lettre (-1)
- [x] Adversaire déconnecté géré
- [x] Tests « casser le jeu » passés
- [x] README

## L2 bis · Mode solo [ ]
- [x] Bouton « Jouer seul » : partie à un joueur, mêmes règles
- [x] Écran de fin solo (score et mots trouvés) + Rejouer en solo
- [x] Tests à un joueur simulé

## L3 · Avatars et pouvoirs (vendredi matin, si L1 et L2 sont en ligne) [ ]
- [ ] Choix de l'avatar avant la partie
- [ ] Le Givré : Freeze (3 cases gelées 10 s)
- [ ] Le Perché : Flou (définitions floues 8 s)
- [ ] Le Pickpocket : Vol (une définition cachée 15 s)
- [ ] 2 utilisations par partie, compteur affiché

## Après le rendu
- [ ] Direction artistique JRPG rétro
- [ ] Mobile
- [ ] Salons privés avec code
- [ ] Agrandir la bibliothèque de mots
