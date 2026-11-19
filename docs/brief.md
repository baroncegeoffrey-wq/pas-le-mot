# C'est pas le mot que tu crois

**En 5 lignes**
1. Un jeu de mots croisés en ligne, à 2 joueurs, en mode course, sur la même grille de 8 à 10 mots.
2. La moitié des mots est classique, l'autre moitié vient de l'argot d'aujourd'hui (vulgaire autorisé). Ce sont des mots qui existent, avec de vraies définitions.
3. Tu remplis les cases d'un mot puis tu appuies sur Entrée : juste = +1 et le mot est à toi, faux = -1.
4. Un mot validé s'affiche chez les deux joueurs dans la couleur de celui qui l'a trouvé, et ses lettres aident pour les mots qui le croisent.
5. Au bout de 2 minutes, ou quand la grille est pleine, le plus gros score gagne.

---

## Règles détaillées

**Déroulé**
- Le joueur choisit un pseudo, clique « Trouver une partie », et il est apparié avec le prochain joueur en attente (même système que le morpion).
- Les deux joueurs reçoivent la même grille, tirée au hasard dans la bibliothèque de mots.
- Chrono : 2 minutes. Les 30 dernières secondes deviennent de plus en plus stressantes (30 s, 20 s, puis compte à rebours géant sur les 10 dernières).

**La grille partagée**
- Les deux joueurs jouent sur la même grille.
- Ce que tu tapes reste chez toi tant que tu n'as pas validé (sinon l'adversaire verrait tes réponses en direct).
- Dès qu'un mot est validé, il est révélé chez les deux, dans la couleur du joueur qui l'a trouvé. Il est verrouillé et plus personne ne peut le jouer.
- Ses lettres apparaissent dans les mots qui le croisent.

**Score**
| Action | Points |
|---|---|
| Mot juste | +1 |
| Mot faux | -1, et ce mot est bloqué 3 secondes pour toi (anti-spam) |
| Acheter une lettre (révélée pour toi seul) | -1 |

- Le score peut être négatif.
- Égalité : affichée comme telle.

**Comparaison des réponses**
- Sans tenir compte des majuscules ni des accents : « frérot » = « FREROT ».

**Fin de partie**
- Chrono à zéro, ou tous les mots trouvés.
- Écran de résultat, puis bouton « Rejouer ».
- Si un joueur se déconnecte, l'autre est prévenu (« Adversaire déconnecté »).

## Mode solo

- Bouton « Jouer seul » à l'accueil : la partie démarre tout de suite, sans adversaire.
- Mêmes règles qu'à deux : même grille, chrono de 2 minutes, +1 / -1, mot bloqué 3 s après une erreur, achat de lettre à -1.
- Fin au chrono ou quand la grille est pleine. Pas de gagné ni de perdu : l'écran de fin affiche le score et le nombre de mots trouvés.
- « Rejouer » relance une partie solo.

## Avatars et pouvoirs (lot 3)

Avant la partie, chaque joueur choisit un avatar. Chaque avatar a un pouvoir, utilisable 2 fois par partie. Pas de pouvoir en mode solo.

| Avatar | Pouvoir | Effet chez l'adversaire |
|---|---|---|
| Le Givré | Freeze | Il est gelé : il ne peut plus rien faire (ni taper, ni valider, ni acheter, ni lancer son pouvoir). Son avatar apparaît en grand, couvert de 30 couches de givre. Il doit le racler avec la souris : chaque passage rapide d'un bord à l'autre enlève une couche. S'il arrête de racler, une couche repousse chaque seconde. Pas de dégivrage avant 2 s, et dégivrage automatique au bout de 45 s. On ne peut pas geler quelqu'un qui l'est déjà |
| Le Perché | Trip | Pendant 20 s, tout son écran devient flou et psychédélique (couleurs qui ondulent). Seul un petit cercle net suit sa souris (et la case où il tape) : il doit se promener pour lire |
| Le Verlan | Verlan | Pendant 20 s, tout son écran est retourné comme dans un miroir (grille et définitions à lire à l'envers) et il doit remplir les mots en partant de la fin |

- Si un Trip ou un Verlan touche alors que le même effet est déjà en cours, l'effet repart pour 20 s.
- Pour l'instant, les avatars sont de simples badges de couleur. Plus tard : des petits personnages 8 bits originaux (voir « Après le rendu » dans la roadmap).

## Les mots

- Ils viennent d'une bibliothèque écrite à l'avance (`data/mots.json`). Pas d'API, pas d'IA pendant la partie.
- À chaque partie, on pioche des mots au hasard (moitié classique, moitié argot) et un algorithme les place dans une grille qui se croise.
- Règle absolue : pas de mot inventé, pas de fausse définition.

## Design

- Direction « Néon acide » : maquette https://claude.ai/artifact/PYEdxibqoKmARi29Gpj1wJ (direction D ; privée, à partager depuis la page si besoin).
- Une arène en haut de l'écran : moi à gauche sur une plateforme verte, l'adversaire à droite sur une plateforme rose, devant une ville de nuit.
- Quand un pouvoir est lancé, les deux joueurs voient la super attaque : une cinématique (bande diagonale, le personnage en gros plan, le nom de l'attaque) puis un rayon géant avec éclairs et explosion à l'impact. L'effet du pouvoir commence juste après (environ 2,7 s).

## Hors périmètre du rendu (vendredi)
- Le confort sur téléphone
- Les salons privés avec un code
