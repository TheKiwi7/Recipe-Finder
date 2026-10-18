# Recipe Finder — Spécification

*English version [below](#specification).*

App perso, 100 % locale, qui recommande des recettes **réelles** (Marmiton) selon le stock d'ingrédients et les goûts de l'utilisateur, en utilisant l'IA avec parcimonie. Ce document décrit l'app telle qu'elle est (version 1.0) et les décisions de conception.

## Architecture

- App web locale : **React (Vite)** + serveur **Node 24** (Hono, `node:sqlite`) + **SQLite**, tout en **TypeScript** (exécuté directement par Node, sans compilation côté serveur).
- **Installation** (`install.cmd`) : installe Node.js et Git via winget si besoin, transforme un dossier téléchargé en ZIP en copie du dépôt (pour les mises à jour), `npm ci`, build, raccourcis bureau et menu Démarrer, lancement.
- **Lancement** (raccourci) : démarre le serveur en arrière-plan (sans fenêtre) et ouvre l'app dans le **navigateur par défaut** : fenêtre dédiée `--app` pour Chrome / Edge / Brave / Vivaldi (le lanceur retient sa taille, sa position et son état agrandi, que ces navigateurs ne restituent pas), nouvelle fenêtre pour Firefox.
- **Vie de l'app** : chaque page ouverte donne signe de vie ; le serveur s'arrête, avec l'import, les requêtes IA et Ollama, quand plus aucune page n'est ouverte. Fermer un onglet ne coupe pas l'app dans un autre.
- **Données** : base SQLite hors git (`data/`). Réglages → « Exporter mes données » (stock, placard, favoris, rejets, préférences, profil, conversations → JSON).
- **Sécurité** : serveur sur 127.0.0.1 uniquement ; l'API refuse les requêtes dont l'hôte ou l'origine n'est pas locale (sites tiers, DNS rebinding) ; le CLI `claude` est lancé sans outils ni connecteurs ; photos des favoris téléchargées en HTTPS uniquement, taille limitée.

## Catalogue de recettes

- Source : **Marmiton** (données structurées schema.org/Recipe des pages, liste des recettes via le sitemap `wsitemap_recipes_index.xml`, relu chaque semaine).
- **Usage strictement personnel**, conforme aux conditions de Marmiton (extraction pour usage privé autorisée, usage commercial interdit) : seules les pages autorisées par `robots.txt`, une page par seconde au plus (**1 s** entre deux requêtes), User-Agent qui identifie l'app, ralentissement automatique si le site le demande (429, erreurs serveur). Rien n'est redistribué.
- **Objectif** : **5 000 recettes** au premier lancement (~3 h d'import, app utilisable dès les premières centaines), puis ~**100 nouvelles / semaine**. Relevable dans les Réglages (+500 / +1 000 / +2 500), affiché plafonné à ce qui reste réellement importable (~39 000 : les recettes du sitemap moins ~10 % écartées). L'import reprend à chaque ouverture.
- **Ordre d'import** : aléatoire (catalogue varié). **Priorité par type** en option (Réglages) : le type n'est connu qu'une fois la page lue, il est deviné d'après les mots de l'adresse (classifieur bayésien naïf appris sur les recettes déjà importées) ; ce n'est pas un filtre (~8 recettes sur 10 du type voulu au lieu de ~4), et l'import continue avec les autres types une fois les prioritaires épuisés.
- **Sélection** : rejet si note < 4/5 ; peu ou pas d'avis : acceptée (note ramenée vers la moyenne au classement). Recettes sans photo écartées des listes.
- **Types** : Plat, Entrée, Accompagnement, Dessert, Apéro, Petit-déj. (détecté aussi d'après le nom : crêpes, granola…), Boisson, Sauce, Autre.
- **Normalisation des ingrédients** : analyseur local (quantités, unités, adjectifs, synonymes, « X de Y » ambigus laissés à l'IA) → ingrédient de base. Dictionnaire de départ + **vocabulaire appris livré avec l'app** (~2 900 termes génériques, `npm run export-aliases`) ; les termes encore inconnus partent à l'IA par lots, résultat mis en cache. Réparations : lignes cassées par le site (« 2 riz ) d'eau bouillante » → la mesure avant, l'ingrédient après) ; ingrédient générique précisé par le titre (« fromages » dans une « Sauce au bleu » → fromage bleu).
- **Ustensiles** : liste de Marmiton (nettoyée de la publicité, vocabulaire canonique) justifiée par les étapes, sinon déduction par mots-clés ; appareils cités dans le titre (« … au Thermomix ») ; estimation des pièces à laver.
- **Images** : chargées depuis le site (hotlink), sauf favoris (copie locale).

## Onglet Ingrédients

- Saisie libre avec **autocomplétion** sur le vocabulaire du catalogue (en anglais si l'app est en anglais : « garlic » est ramené à « ail »).
- Quantité indicative (nombre + unité), modifiable ; « compte comme : … » quand l'ingrédient reconnu diffère de la saisie.
- Badge **« à finir vite »** : bonus aux recettes qui l'utilisent. Pas de dates de péremption.
- **Placard de base** (sel, poivre, huile, eau, sucre, farine…) pré-rempli, modifiable, toujours disponible ; suggestions en un clic.
- Bouton **« Mes ingrédients sont à jour »** : requis si non confirmé dans les **12 dernières heures** ; sans confirmation, Recettes et Presque sont verrouillés.

## Onglets de recettes

- **Recettes** : uniquement les recettes **faisables** (aucun ingrédient manquant hors placard).
- **Presque** : **1 à 3** ingrédients manquants, affichés ; bonus si les manquants sont courants.
- **Découvrir** : plus de 3 manquants, classées d'après les goûts (profil, likes : leur poids grandit avec leur nombre, un seul like ne tire pas toute la liste) ; le stock n'y compte pas.
- **20** recettes, **+20** par « Charger plus » ; filtres stricts : type (**Tous** par défaut) et temps (≤ 20 min, ≤ 45 min, toutes durées) ; filtre **« Pour : »** (qui mange) dès qu'il y a plusieurs membres.
- **Stock modifié** → liste recalculée entièrement (les nouvelles recettes faisables apparaissent). Rejets modifiés → les recettes encore valides gardent leur place.
- Une recette vue sans réaction ne réapparaît qu'après ~**2 semaines** (sauf dans les 6 h, par ex. en revenant sur un filtre).
- Grille de cartes (5 par ligne sur grand écran) : photo, nom, temps, vaisselle, note, type (en « Tous »), manquants.

## Page recette

- Photo, note, type, tuiles (total, préparation, cuisson, vaisselle), ingrédients **recalculés pour le nombre de personnes** (+/-), ustensiles, étapes telles que publiées, lien vers Marmiton.
- « Je n'aime pas : *ingrédient* » sur chaque ligne → exclusion stricte de cet ingrédient.
- **« Je la fais »** : ce qui manque pour le nombre de personnes choisi (absent, ou en quantité insuffisante : g/kg, ml/cl/l, cuillères converties ; unités incomparables → supposé suffisant) part dans l'onglet **Courses**.
- **Chat avec l'IA** : contexte automatique (recette, stock, profil, qui mange) ; conversation mémorisée par recette.

## Courses

- Liste cumulée (même ingrédient de plusieurs recettes additionné si les unités sont comparables), avec les recettes d'origine ; ajout à la main.
- « Acheté » range l'article dans le stock (quantité ajoutée à l'existant si comparable) ; « Tout est acheté » ; « Vider ».

## Likes, favoris, rejets

- **Like** → favori (copie locale complète : ingrédients, étapes, image) + léger bonus aux recettes similaires.
- **Dislike** → recette cachée définitivement + pénalité aux recettes similaires. Retirer un favori est neutre.
- Réglages → « Mes rejets » pour annuler un rejet de recette ou d'ingrédient.

## Profil et classement

- **Questionnaire au premier lancement** (modifiable) : langue, personnes, temps habituel, tolérance à la vaisselle, régime, allergies, appareils possédés, notes libres pour l'IA.
- **Exclusions strictes par mot**, vérifiées sur les ingrédients et sur le texte des recettes, avec des familles : arachide, fruits à coque, gluten, lactose, œuf, poisson, fruits de mer, crustacés, soja, sésame, fromage fort… ; régimes sans viande, végétarien, végan.
- **Membres de la famille** (Réglages → « Pour qui je cuisine ») : régime, allergies, aversions, notes ; le filtre « Pour : » applique les exclusions de ceux qui mangent et adapte les portions.
- **Classement local, sans IA** : stock, « à finir vite », note (moyenne bayésienne), similarité aux likes / dislikes (ingrédients pondérés par leur rareté, type), préférences (temps, vaisselle), réglages du profil ; ~**30 %** d'exploration par lot.
- **Profil par l'IA** : texte détaillé (visible dans Réglages → Profil) + réglages structurés (poids d'ingrédients, de mots-clés, de types, exclusions fermes). Mise à jour dès **10 nouveaux signaux** (likes, rejets, questions, « Je la fais », questionnaire), **au plus 1 fois / heure**, ou à la demande.

## Intelligence artificielle

- **Sans clé API**, deux fournisseurs (`server/ai.ts`) : **abonnement Claude** via le CLI officiel (`claude -p`, Haiku ou Sonnet), prioritaire pour ce que l'utilisateur attend à l'écran ; **modèle local** via Ollama (Gemma 3 12B, ou 4B conseillé si la carte graphique a moins de 10 Go), prioritaire pour les tâches de fond. Installation et connexion en un clic depuis l'app.
- **Bascule** : un fournisseur absent, en échec, en limite d'usage ou qui renvoie une réponse inutilisable (vide, JSON invalide) → l'autre prend le relais ; pause de 2 min après une panne, 30 min après une limite d'usage ; en dernier recours une panne simple est retentée. Ollama arrêté ou planté → relancé automatiquement (caché, priorité basse).
- **Économie** : appels en file (pas de rafale), traitements par lots et mis en cache ; CLI sans outils, connecteurs ni réglages utilisateur (~2 400 tokens de moins par appel) ; tâches de fond sur le modèle local suivies d'un repos de la carte graphique (≤ ~33 % du temps occupée).
- **Appels (exhaustif)** : chat (à la demande) ; mise à jour du profil ; normalisation des ingrédients inconnus ; traductions en anglais (termes, noms, recettes).
- Sans IA, tout fonctionne sauf le chat, la mise à jour du profil, la reconnaissance des nouveaux ingrédients et la traduction.

## Langues

- Interface en **français** (par défaut) ou en **anglais**, choisie à l'accueil ou dans les Réglages ; textes dans le code via `L('fr', 'en')`.
- En anglais, le catalogue (en français) est traduit par l'IA à la demande puis gardé en base : termes et noms traduits d'avance en tâche de fond, recette complète à sa première ouverture (~15-30 s, unités comprises). Anneau de chargement devant un nom en cours de traduction. L'app est pensée pour le français ; l'anglais passe par ces traductions.
- Pas de bandeau « Traduire cette page » du navigateur.

## Interface

- **Style** : neutre et moderne, police **Inter**, accent vert sauge, rayon 14 px, bordures fines. Thème clair / sombre (suit le système, bouton pour forcer).
  - Clair : fond `#f7f7f5`, surface `#ffffff`, texte `#1c1c1a`, accent `#2f7d5b`. Sombre : fond `#121312`, surface `#1b1c1b`, texte `#ececea`, accent `#5fbf92`.
- **Navigation** : barre latérale (Ingrédients, Recettes, Presque, Découvrir, Favoris, Courses avec compteur ; progression du catalogue, thème, Réglages en bas).
- **Robustesse** : écran « Démarrage… » au lieu d'un écran vide ; écran « Oups » avec bouton Recharger en cas de plantage ; nouvelles tentatives si le serveur redémarre ; aucune connexion bloquée pendant un appel à l'IA.
- Compatibilité testée : Chrome, Edge, Brave, Opera GX, Firefox, WebKit (Safari).

## Mises à jour

- L'app est une copie git du dépôt. Seules les **versions publiées** sont proposées : un tag `vX.Y.Z` sur `main` et ses notes FR / EN dans `releases.json` (`npm run release`).
- Vérification au lancement puis toutes les 6 h ; Réglages → « Mises à jour » : version installée, notes des nouvelles versions dans la langue de l'app, bouton **Mettre à jour** (avance rapide jusqu'au dernier tag, `npm ci` si les dépendances changent, build, redémarrage automatique, rechargement de la page). Fichiers modifiés à la main → mise à jour refusée. Données jamais touchées.

## Qualité et tests

- `npm run audit` : taux d'acceptation, ingrédients non reconnus, termes jugés « pas un ingrédient », correspondances « X de Y → X » à vérifier, fiches incomplètes, échantillon.
- `npm test` : analyse des ingrédients, pages Marmiton, classement (Recettes, Presque, Découvrir), exclusions, courses et conversions d'unités, bascule entre IA, protection de l'API, versions.

---

<a id="specification"></a>

# Recipe Finder — Specification

A personal, 100% local app that recommends **real** recipes (Marmiton) based on the user's pantry and tastes, using AI sparingly. This document describes the app as it is (version 1.0) and its design decisions.

## Architecture

- Local web app: **React (Vite)** + **Node 24** server (Hono, `node:sqlite`) + **SQLite**, all in **TypeScript** (run directly by Node, no server-side build).
- **Install** (`install.cmd`): installs Node.js and Git via winget if needed, turns a folder downloaded as a ZIP into a copy of the repository (for updates), `npm ci`, build, desktop shortcut, launch.
- **Launch** (shortcut): starts the server in the background (no window) and opens the app in the **default browser**: dedicated `--app` window for Chrome / Edge / Brave / Vivaldi (the launcher remembers its size, position and maximised state, which these browsers don't restore), new window for Firefox.
- **App lifetime**: every open page reports in; the server stops, along with the import, AI requests and Ollama, when no page is open anymore. Closing one tab doesn't stop the app in another.
- **Data**: SQLite database outside git (`data/`). Settings → “Export my data” (pantry, cupboard, favourites, rejections, preferences, profile, conversations → JSON).
- **Security**: server on 127.0.0.1 only; the API rejects requests whose host or origin isn't local (third-party sites, DNS rebinding); the `claude` CLI runs with no tools or connectors; favourite photos downloaded over HTTPS only, size limited.

## Recipe catalogue

- Source: **Marmiton** (schema.org/Recipe structured data on its pages, recipe list from the sitemap `wsitemap_recipes_index.xml`, re-read every week).
- **Strictly personal use**, in line with Marmiton's terms (extraction for private use allowed, commercial use forbidden): only pages allowed by `robots.txt`, at most one page per second (**1 s** between requests), a User-Agent identifying the app, automatic slow-down when the site asks (429, server errors). Nothing is redistributed.
- **Goal**: **5,000 recipes** on first launch (~3 h of import, usable after the first few hundred), then ~**100 new ones a week**. Can be raised in Settings (+500 / +1,000 / +2,500), shown capped at what's really left to import (~39,000: the sitemap's recipes minus ~10% skipped). The import resumes at every launch.
- **Import order**: random (a varied catalogue). Optional **priority by type** (Settings): a recipe's type is only known once its page is read, so it is guessed from the words in its address (naive Bayes classifier trained on recipes already imported); it isn't a filter (~8 in 10 recipes of the wanted type instead of ~4), and the import carries on with the other types once the priority ones run out.
- **Selection**: skipped if rated < 4/5; few or no reviews: accepted (rating pulled towards the average when ranking). Recipes without a photo are left out of the lists.
- **Types**: Main, Starter, Side, Dessert, Appetiser, Breakfast (also detected from the name: crêpes, granola…), Drink, Sauce, Other.
- **Ingredient normalisation**: local parser (quantities, units, adjectives, synonyms, ambiguous “X of Y” left to the AI) → base ingredient. Seed dictionary + **learned vocabulary shipped with the app** (~2,900 generic terms, `npm run export-aliases`); terms still unknown go to the AI in batches, cached. Repairs: lines broken by the site (“2 riz ) d'eau bouillante” → measure before, ingredient after); generic ingredient made specific by the title (“cheeses” in a “Blue cheese sauce” → blue cheese).
- **Equipment**: Marmiton's list (cleaned of advertising, canonical vocabulary) justified by the steps, otherwise keyword deduction; appliances named in the title (“… with a Thermomix”); estimate of items to wash.
- **Images**: loaded from the site (hotlink), except favourites (local copy).

## Ingredients tab

- Free input with **autocomplete** on the catalogue vocabulary (in English when the app is in English: “garlic” maps to “ail”).
- Indicative quantity (number + unit), editable; “counts as: …” when the recognised ingredient differs from what was typed.
- **“Use soon”** badge: bonus for recipes using it. No expiry dates.
- **Cupboard basics** (salt, pepper, oil, water, sugar, flour…) prefilled, editable, always available; one-click suggestions.
- **“My ingredients are up to date”** button: required if not confirmed in the **last 12 hours**; until confirmed, Recipes and Almost are locked.

## Recipe tabs

- **Recipes**: only **doable** recipes (no missing ingredient apart from the cupboard).
- **Almost**: **1 to 3** missing ingredients, shown; bonus when the missing ones are common.
- **Discover**: more than 3 missing, ranked by taste (profile, likes: their weight grows with their number, a single like doesn't pull the whole list); the pantry doesn't count there.
- **20** recipes, **+20** per “Load more”; strict filters: type (**All** by default) and time (≤ 20 min, ≤ 45 min, any time); **“For:”** filter (who is eating) as soon as there are several members.
- **Pantry changed** → list fully recomputed (newly doable recipes appear). Rejections changed → still-valid recipes keep their place.
- A recipe seen without a reaction only comes back after ~**2 weeks** (except within 6 h, e.g. when coming back to a filter).
- Card grid (5 per row on a large screen): photo, name, time, washing up, rating, type (under “All”), missing ingredients.

## Recipe page

- Photo, rating, type, tiles (total, prep, cooking, washing up), ingredients **scaled to the number of people** (+/-), equipment, steps as published, link to Marmiton.
- “I don't like: *ingredient*” on each line → strict exclusion of that ingredient.
- **“I'll make it”**: what's missing for the chosen number of people (absent, or not enough: g/kg, ml/cl/l, spoons converted; incomparable units → assumed enough) goes to the **Shopping** tab.
- **Chat with the AI**: automatic context (recipe, pantry, profile, who is eating); conversation kept per recipe.

## Shopping

- Combined list (the same ingredient from several recipes added up when units are comparable), with the recipes it's for; manual additions.
- “Bought” moves the item into the pantry (quantity added to the existing one when comparable); “Bought everything”; “Clear”.

## Likes, favourites, rejections

- **Like** → favourite (full local copy: ingredients, steps, image) + slight bonus to similar recipes.
- **Dislike** → recipe hidden for good + penalty to similar recipes. Removing a favourite is neutral.
- Settings → “My rejections” to undo a recipe or ingredient rejection.

## Profile and ranking

- **First-launch questionnaire** (editable): language, people, usual time, washing-up tolerance, diet, allergies, appliances owned, free notes for the AI.
- **Strict exclusions by word**, checked against ingredients and recipe text, with families: peanut, nuts, gluten, lactose, egg, fish, seafood, shellfish, soy, sesame, strong cheese…; no-meat, vegetarian, vegan diets.
- **Family members** (Settings → “Who I cook for”): diet, allergies, dislikes, notes; the “For:” filter applies the exclusions of those eating and adjusts portions.
- **Local ranking, no AI**: pantry, “use soon”, rating (Bayesian average), similarity to likes / dislikes (ingredients weighted by rarity, type), preferences (time, washing up), profile settings; ~**30%** exploration per batch.
- **AI profile**: detailed text (visible in Settings → Profile) + structured settings (weights for ingredients, keywords, types, firm exclusions). Updated from **10 new signals** (likes, rejections, questions, “I'll make it”, questionnaire), **at most once an hour**, or on demand.

## Artificial intelligence

- **No API key**, two providers (`server/ai.ts`): **Claude subscription** via the official CLI (`claude -p`, Haiku or Sonnet), first for what the user is waiting for on screen; **local model** via Ollama (Gemma 3 12B, or 4B suggested when the graphics card has under 10 GB), first for background tasks. One-click install and sign-in from the app.
- **Fallback**: a provider that is missing, failing, at its usage limit or returning an unusable reply (empty, invalid JSON) → the other takes over; 2-minute pause after a failure, 30 minutes after a usage limit; as a last resort a simple failure is retried. Ollama stopped or crashed → restarted automatically (hidden, low priority).
- **Savings**: queued calls (no bursts), batched and cached work; CLI without tools, connectors or user settings (~2,400 fewer tokens per call); background tasks on the local model followed by a graphics-card rest (≤ ~33% of the time busy).
- **Calls (exhaustive)**: chat (on demand); profile update; normalisation of unknown ingredients; English translations (terms, names, recipes).
- Without AI, everything works except chat, profile updates, recognising new ingredients and translation.

## Languages

- Interface in **French** (default) or **English**, chosen on the welcome screen or in Settings; texts in the code via `L('fr', 'en')`.
- In English, the (French) catalogue is translated by the AI on demand then kept in the database: terms and names translated ahead in the background, a full recipe the first time it opens (~15-30 s, units included). Loading ring in front of a name being translated. The app is designed for French; English goes through these translations.
- No browser “Translate this page” banner.

## Interface

- **Style**: neutral and modern, **Inter** font, sage-green accent, 14 px radius, thin borders. Light / dark theme (follows the system, button to force).
  - Light: background `#f7f7f5`, surface `#ffffff`, text `#1c1c1a`, accent `#2f7d5b`. Dark: background `#121312`, surface `#1b1c1b`, text `#ececea`, accent `#5fbf92`.
- **Navigation**: sidebar (Ingredients, Recipes, Almost, Discover, Favourites, Shopping with a counter; catalogue progress, theme, Settings at the bottom).
- **Robustness**: “Starting…” screen instead of a blank one; “Oops” screen with a Reload button on a crash; retries while the server restarts; no connection held during an AI call.
- Tested compatibility: Chrome, Edge, Brave, Opera GX, Firefox, WebKit (Safari).

## Updates

- The app is a git copy of the repository. Only **published versions** are offered: a `vX.Y.Z` tag on `main` and its FR / EN notes in `releases.json` (`npm run release`).
- Checked at launch, then every 6 hours; Settings → “Updates”: installed version, notes of the new versions in the app's language, **Update** button (fast-forward to the latest tag, `npm ci` if dependencies changed, build, automatic restart, page reload). Hand-edited files → update refused. Data never touched.

## Quality and tests

- `npm run audit`: acceptance rate, unrecognised ingredients, terms judged “not an ingredient”, “X of Y → X” mappings to check, incomplete records, sample.
- `npm test`: ingredient parsing, Marmiton pages, ranking (Recipes, Almost, Discover), exclusions, shopping and unit conversions, AI fallback, API protection, versions.
