# Recipe Finder — Spécification

App perso, locale, qui recommande des recettes **réelles** (trouvées en ligne) selon le stock d'ingrédients et les préférences de l'utilisateur, en utilisant Claude avec parcimonie.

## Architecture

- App web locale : **React (Vite)** + serveur **Node** + **SQLite**, tout en **TypeScript**.
- Lancement : raccourci bureau qui démarre le serveur et ouvre **Brave en mode app** (`--app=http://localhost:…`).
- Claude : appelé via le CLI officiel en headless (`claude -p --model …`) → consomme l'abonnement **Pro** de l'utilisateur. La couche d'appel est isolée (une interface) pour pouvoir passer à une clé API plus tard.
- Base SQLite hors git (`data/`). Bouton « Exporter mes données » (stock, favoris, rejets, profil → JSON).

## Catalogue de recettes

- Source v1 : **Marmiton** (JSON-LD schema.org/Recipe, sitemap `wsitemap_recipes_index.xml`). Import organisé en **adaptateurs par site** pour ajouter CuisineAZ plus tard.
- Usage strictement personnel : respect de `robots.txt`, 1 requête / 2-3 s.
- Import initial ~**8 000 recettes** en tâche de fond (quelques heures, reprend à chaque ouverture de l'app, barre de progression, app utilisable dès les premières centaines). Puis ~**100 nouvelles / semaine** quand l'app est ouverte. Recettes dont la page a disparu supprimées, sauf favoris.
- Sélection aléatoire dans le sitemap ; rejet si note < 4/5. Peu ou pas d'avis : acceptée ; au classement, la note est ramenée vers la moyenne quand il y a peu d'avis (moyenne bayésienne) et les recettes sans note ont un léger malus.
- **Normalisation des ingrédients** : parseur local (quantités, unités, adjectifs, synonymes) → ingrédient de base. Termes inconnus envoyés à Claude par lots de quelques centaines, résultat mis en cache définitivement.
- **Ustensiles** : section « Ustensiles » de Marmiton en priorité, sinon déduction locale par mots-clés dans les étapes. Estimation du nombre de pièces à laver.
- **Images** : chargées depuis le site d'origine (hotlink), sauf favoris (copie locale).

## Onglet Ingrédients

- Saisie libre avec **autocomplétion** sur le vocabulaire normalisé du catalogue.
- Quantité **indicative** (nombre + unité), modifiable ; suppression possible. Le matching ne regarde que la présence.
- Badge **« à finir vite »** → bonus pour les recettes qui l'utilisent. Pas de dates de péremption.
- **Placard de base** (sel, poivre, huile, eau, sucre, farine…) pré-rempli, modifiable, toujours considéré disponible.
- Bouton **« Mes ingrédients sont à jour »** : requis si non confirmé dans les **12 dernières heures**. Sans confirmation, Recettes et Presque sont verrouillés ; Favoris reste accessible.

## Onglet Recettes

- Uniquement des recettes **faisables** (0 ingrédient manquant hors placard).
- **10** au départ, **+10** par « Charger plus », ajoutées sous les précédentes, sans limite.
- Filtres stricts : type (Plat par défaut, Entrée, Dessert, Apéro, Petit-déj.) et temps (≤ 20 min, ≤ 45 min, tous).
- Moins de 10 faisables → afficher ce qui existe + message renvoyant vers Presque.
- **Changement du stock** → recalcul immédiat : les recettes devenues infaisables disparaissent, la liste est complétée au même nombre, les recettes encore faisables restent à leur place.
- Une recette vue sans réaction ne réapparaît qu'après ~**2 semaines** (sauf dans la même session : vue il y a moins de 6 h, elle peut revenir, par ex. en revenant sur un filtre).

## Onglet Presque

- Recettes avec **1 à 3** ingrédients manquants (hors placard), manquants affichés en rouge.
- Même mécanique que Recettes (10 + « Charger plus », filtres, classement), avec un bonus si les manquants sont des ingrédients courants.

## Like / dislike

- **Like** → favori (copie locale complète : ingrédients, étapes, image) + léger bonus aux recettes similaires.
- **Dislike recette** → cachée définitivement + pénalité aux recettes similaires.
- **Dislike ingrédient** (depuis Presque et la page détail) → **exclusion stricte**.
- Retirer un favori est **neutre**.
- Page « Mes rejets » dans les réglages pour annuler un dislike.

## Page détail

- Image, ingrédients **recalculés pour le nombre de personnes** (+/-), temps, ustensiles, lien vers la recette, étapes **telles que publiées**.
- **Chat Claude** (Haiku) : contexte automatique = recette + stock + profil. Conversation mémorisée par recette.

## Profil et classement

- **Questionnaire au premier lancement** (modifiable dans les réglages) : allergies/régime, temps max habituel, nombre de personnes, ustensiles possédés, tolérance à la vaisselle.
  - Allergies et régime : exclusion stricte **par mot** avec familles d'allergènes (« arachide » exclut aussi huile d'arachide et cacahuète ; « fruits à coque », « gluten », « lactose »…).
  - Appareils optionnels (four, micro-ondes, robot, robot cuiseur type Thermomix, Airfryer, friteuse…) : une recette qui demande un appareil absent est exclue ; l'appareil est aussi détecté dans le titre (« … au Thermomix »).
- **Classement local, sans Claude** : score = correspondance au stock + bonus « à finir vite » + similarité aux likes / dislikes (ingrédients principaux, catégorie, temps, vaisselle) + réglages du profil + malus temps au-delà du max habituel. ~**30 %** d'exploration par lot.
- **Claude (Sonnet)** rédige un profil détaillé (non affiché) + des **réglages structurés** consommés par l'algorithme. Mise à jour en tâche de fond quand **≥ 10 nouveaux signaux** (likes, dislikes, questions du chat), **max 1 fois / jour**.
- Claude indisponible (limite, CLI déconnecté) → l'app fonctionne normalement ; chat affiche « Claude indisponible pour le moment », mise à jour du profil reportée.

### Appels Claude (exhaustif)

1. Chat sur une recette (à la demande).
2. Mise à jour du profil (≤ 1 / jour).
3. Normalisation des ingrédients inconnus (rare, par lots).

## Interface

Une UI propre est une priorité. Direction retenue : **variante A « Épuré »** du prototype (branche `prototype/ui-directions`).

- **Style** : neutre et moderne, police **Inter**, accent vert sauge, rayon 14 px, bordures fines, ombre légère au survol.
- **Thème** : suit le système, bouton pour forcer clair / sombre.
  - Clair : fond `#f7f7f5`, surface `#ffffff`, surface 2 `#f0f0ed`, texte `#1c1c1a`, texte secondaire `#6b6b66`, ligne `#e6e6e1`, accent `#2f7d5b`, like `#e0475b`.
  - Sombre : fond `#121312`, surface `#1b1c1b`, surface 2 `#242523`, texte `#ececea`, texte secondaire `#9a9a94`, ligne `#2c2d2b`, accent `#5fbf92`.
- **Navigation** : barre latérale fine à gauche (icône + libellé), Réglages et thème en bas ; passe en barre inférieure sur fenêtre étroite.
- **Cartes** : grille auto (min 250 px), image 16/10 en haut, nom sur 2 lignes, méta (temps, vaisselle, note) ; like / dislike au survol en haut à droite ; une recette rejetée se grise.
- **Filtres** : puces arrondies au-dessus de la grille.
- **Page détail** : image fixe à gauche, à droite titre, tuiles de stats (total, préparation, cuisson, vaisselle), ingrédients avec +/- portions et « Je n'aime pas » au survol de chaque ligne, ustensiles en puces, étapes numérotées.
- **Chat** : bouton flottant « Demander à Claude », panneau repliable à droite (360 px), suggestions de questions quand vide.

## Qualité du catalogue

- `npm run audit` : taux d'acceptation, ingrédients non reconnus, termes ignorés, correspondances « X de Y → X » à vérifier, fiches incomplètes, échantillon.
- Les noms « X de Y » dont seul X est connu (« eau de fleur d'oranger », « œufs de saumon ») ne sont pas ramenés à X : Claude tranche, sauf compléments sûrs (« en poudre », « à température ambiante »).
- Les ustensiles de Marmiton contiennent de la publicité : ils sont ramenés à un vocabulaire canonique ; seules les grosses pièces comptent dans la vaisselle.

## Ordre de construction

1. Import du catalogue (adaptateur Marmiton, normalisation, ustensiles).
2. Onglet Ingrédients.
3. Onglets Recettes + Presque + page détail.
4. Likes, favoris, rejets.
5. Claude : profil, réglages structurés, chat.
