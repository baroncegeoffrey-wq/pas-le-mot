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
- [x] Chrono 4 min affiché, fin au chrono ou grille pleine
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
- [x] Le Givré : Freeze (adversaire bloqué jusqu'à ce qu'il racle le givre de son avatar, 20 s max, vérifié par le serveur)
- [x] Le Perché : Trip (écran flou et psychédélique, un cercle net suit la souris, 10 s)
- [x] Le Verlan : Verlan (écran retourné en miroir, mots à remplir par la fin, 10 s)
- [x] 2 utilisations par partie, compteur affiché, pas de pouvoir en solo
- [x] **En ligne sur Render**, testé avec 2 joueurs simulés sur le site en ligne (nouveau Freeze compris)

## Après le rendu
- [ ] Direction artistique JRPG rétro
- [ ] Petits personnages 8 bits originaux (animations très simples) à la place des badges : les deux joueurs se font face, s'affrontent, et on voit les pouvoirs partir avec des effets spéciaux
- [ ] Mobile
- [ ] Salons privés avec code
- [ ] Agrandir la bibliothèque de mots
