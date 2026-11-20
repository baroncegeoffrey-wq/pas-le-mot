# Roadmap

Un lot est coché seulement quand il est livré ET en ligne sur Render.

## L1 · Le cœur jouable (jeudi) [x]
- [x] Projet initialisé (git, npm, express, socket.io), CLAUDE.md et docs/ commités
- [x] Serveur + matchmaking repris du morpion, avec pseudo
- [x] `grid.js` : pioche 12 mots (moitié classique, moitié argot) et les place dans une grille très croisée
- [x] Affichage de la grille + liste des définitions numérotées
- [x] Saisie lettre par lettre dans les cases, Entrée pour valider le mot
- [x] Validation serveur : un point par lettre / -1, mot révélé chez les deux dans la couleur du joueur
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

## Combat JRPG (branche `combat`, pas encore sur main ni en ligne) [ ]
- [x] 100 PV par joueur, dégâts = lettres × 3, recul de 5 PV sur erreur, lettre achetée = 3 PV, calculés par le serveur
- [x] Fin au K.O. ou au chrono (le plus de PV gagne)
- [x] Arène : avatars face à face, barres de PV animées, fond d'arène
- [x] Un seul visuel par avatar (silhouettes provisoires, puis les vrais sprites)
- [x] Impacts : hit-stop 80 ms, tremblement proportionnel, flash blanc, recul, chiffres de dégâts, étincelles et sang stylisé
- [x] K.O. au ralenti avec zoom
- [x] Une super attaque par partie, vidéo plein écran synchronisée par le serveur (flash blanc si la vidéo manque)
- [x] `scripts/prepare-assets.js` (`npm run assets`) : sources .jpeg, fond retiré depuis les bords (garde la fumée verte du Perché), recadrage, sprites 160 px nets, arène GIF → .webm en boucle (+ image de secours), vidéos gardées entières en .webm 720p < 4 Mo (seuls les bords noirs ou figés coupés, 0,5 s max)
- [x] Fond d'arène : vidéo en boucle, sinon image de secours, sinon la ville CSS ; perso de droite en miroir
- [x] Vrais sprites des avatars, vrai fond d'arène, vraies vidéos de super attaque
- [x] Pendant une vidéo : chrono en pause et saisies bloquées chez les deux joueurs, reprise à la fin (flash blanc)
- [x] Les 3 vidéos sont préchargées au début de la partie
- [x] Verlan : après sa vidéo, le décor de l'arène se retourne (fissures et débris) pendant l'effet
- [x] Persos animés : GIF détourés image par image (fumée du Perché gardée), WebP animé transparent, .png en secours
- [x] Attaque visible à chaque mot trouvé : charge, projectile géant propre à chaque perso, explosion et onde de choc (canvas en mode additif, 60 i/s)
- [x] Coup critique : 7 lettres ou plus = dégâts × 1,5, mini-cinématique dans l'arène avec « CRITIQUE ! », projectile encore plus gros
- [x] Soin : un mot trouvé rend lettres × 2 PV à celui qui l'a trouvé (plafond 100), « +X » vert et halo
- [x] 72 nouveaux mots (247 au total : 132 argot, 115 classiques), sans doublon
- [x] Anti-répétition : les mots des 5 dernières grilles sont évités
- [x] Nouvelle super attaque du Perché (perche-cine-v2)
- [x] En partie, tout tient dans la fenêtre sans défilement (1366×768 et 1920×1080)
- [x] Persos sur la même ligne de sol, centrés dans leur moitié d'arène, même hauteur
- [x] Interface façon jeu de combat dans les coins du haut de l'arène, plus rien sur les persos
- [x] Voir où joue l'adversaire (mot entouré, définition surlignée, badge)
- [x] Mini-cinématiques critiques cadrées sur la tête des persos
- [x] Musique de combat en boucle (partie et menu), suit SON ON/OFF, baisse pendant les cinématiques
- [ ] Tester le rendu animé (ralenti, impacts) sur un écran visible, à deux
- [ ] Fusionner dans main et mettre en ligne

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
