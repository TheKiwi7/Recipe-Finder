# Recipe Finder

**Qu'est-ce qu'on mange ce soir, avec ce qu'il y a dans le frigo ?**

*English version [below](#english).*

Recipe Finder est une app perso, 100 % locale, qui propose de **vraies recettes** (issues de Marmiton, pas inventées par une IA) faisables avec les ingrédients que tu as chez toi, classées selon tes goûts. Une IA sert d'assistant (ton abonnement Claude, ou un modèle gratuit qui tourne sur ton PC) : elle tient ton profil à jour et répond à tes questions sur une recette, sans être appelée à chaque clic.

<p align="center">
  <img src="docs/screenshots/ingredients.png" alt="Onglet Ingrédients : stock, quantités, « à finir vite » et placard de base" width="49%">
  <img src="docs/screenshots/questionnaire.png" alt="Questionnaire d'accueil : personnes, temps, vaisselle, régime, allergies, appareils" width="49%">
</p>

## Fonctionnalités

- **Mes ingrédients** : ton stock avec quantités, autocomplétion, badge « à finir vite » pour écouler ce qui va se perdre, et un placard de base (sel, huile, farine…) toujours considéré comme disponible.
- **Recettes** : des recettes faisables **sans rien acheter**, 10 par 10, filtrables par type (plat, entrée, accompagnement, dessert, apéro, petit-déj., boisson, sauce) et par durée. La liste se met à jour dès que ton stock change.
- **Presque** : les recettes où il te manque 1 à 3 ingrédients, de préférence faciles à trouver.
- **Like / dislike** : un like range la recette dans tes favoris (copie locale complète, même si la page disparaît) ; un dislike l'écarte. Tu peux aussi rejeter un ingrédient précis d'un clic.
- **Fiche recette** : quantités recalculées pour ton nombre de personnes, temps, ustensiles, nombre de pièces à laver, étapes, lien vers la source, et un **chat avec l'IA** (Claude ou le modèle local) qui connaît déjà la recette, ton stock et tes goûts.
- **Profil** : un questionnaire de départ (personnes, temps, vaisselle, régime, allergies, appareils, goûts), puis un profil que l'IA affine à partir de tes likes, rejets et questions. Tes aversions fermes (« rien qui vienne de la mer ») deviennent des exclusions strictes.
- **Pour qui je cuisine** : ajoute les membres de ta famille, chacun avec son régime, ses allergies et ce qu'il n'aime pas. Au moment de choisir, tu coches qui mange : les exclusions de chacun s'appliquent et les portions s'adaptent.
- **Allergies et régimes** : exclusions strictes par famille (gluten, lactose, fruits à coque, poisson…), vérifiées sur les ingrédients mais aussi sur le texte complet des recettes.
- **Français ou anglais** : toute l'interface existe dans les deux langues. En anglais, les recettes (en français sur le site) sont traduites par l'IA la première fois qu'elles s'affichent, unités comprises (c. à soupe → tbsp), puis gardées sur ton PC ; tu peux taper tes ingrédients en anglais.
- **Catalogue** : 5 000 recettes bien notées au premier lancement (environ 5 h d'import, l'app est utilisable dès les premières centaines), extensibles depuis les Réglages.

> **Claude, modèle local ou les deux ?** Toutes les fonctionnalités marchent avec l'un ou l'autre. La différence est la qualité : avec le **modèle local seul**, les réponses du chat sont plus simples et parfois moins sûres (substitutions, conseils de cuisson), et le profil saisit moins finement les nuances de tes notes. Avec **ton abonnement Claude**, le chat et le profil sont nettement meilleurs ; le modèle local, s'il est installé, se charge alors des tâches de fond pour ménager ton abonnement. Sans aucune IA, tout fonctionne sauf le chat, la mise à jour du profil, la reconnaissance des nouveaux ingrédients et la traduction en anglais.

## Comment ça marche

- **Catalogue local** : les recettes sont lues depuis les données structurées (schema.org/Recipe) des pages Marmiton, puis stockées dans une base SQLite locale. Chaque ligne d'ingrédient (« 2 gousses d'ail hachées ») est ramenée à un ingrédient de base (« ail ») par un analyseur local ; seuls les termes inconnus sont envoyés à l'IA, par lots, et le résultat est mis en cache.
- **Classement local, sans IA** : charger ou recalculer une liste ne coûte aucun appel. Le score combine ton stock, ce qui est « à finir vite », la note de la recette (pondérée par le nombre d'avis), la ressemblance avec ce que tu aimes ou rejettes, tes préférences, et ~30 % d'exploration pour ne pas tourner en rond.
- **L'IA, avec parcimonie et sans clé API** : uniquement pour le chat, la mise à jour du profil (dès 10 nouveaux signaux, au plus une fois par heure, ou à la demande), la reconnaissance des nouveaux ingrédients et la traduction. Deux fournisseurs, utilisables ensemble :
  - **ton abonnement Claude** (Pro, Max…), via Claude Code : meilleure qualité, utilisé en priorité pour le chat et le profil ;
  - **un modèle local gratuit** (Gemma 3 via [Ollama](https://ollama.com)) : privé, hors ligne, utilisé en priorité pour les tâches de fond. Il demande une carte graphique correcte ; une version légère existe pour les PC plus modestes.

  Si l'un manque ou échoue, l'autre prend le relais. Les appels sont mis en file pour ne jamais partir en rafale.

## Installer

Sur Windows 10 ou 11, sans rien d'autre à installer au préalable :

1. Télécharge le projet (bouton vert **Code → Download ZIP**) et décompresse-le où tu veux.
2. Double-clique sur **`install.cmd`**.

Le script installe Node.js si besoin, prépare l'app, crée le raccourci **Recipe Finder** sur le bureau et ouvre l'app. Ensuite, le raccourci suffit : il démarre l'app en arrière-plan et l'ouvre dans ton navigateur par défaut (en fenêtre dédiée avec Chrome, Edge, Brave ou Vivaldi).

Au premier lancement :

1. le choix de la langue (français ou anglais) et un court questionnaire (personnes, temps, vaisselle, régime, allergies, appareils, goûts) ;
2. **Connecter une IA**, facultatif, un clic par option :
   - **« Connecter mon abonnement Claude »** : l'app installe Claude Code si besoin et ouvre la connexion à ton compte dans le navigateur (abonnement Pro, Max, Team ou Enterprise ; le plan gratuit ne donne pas accès à Claude Code) ;
   - **« Installer le modèle local »** : l'app installe Ollama et télécharge le modèle (environ 8 Go), avec la progression affichée.

L'import du catalogue démarre aussitôt ; les premières recettes arrivent en quelques minutes et l'app reste utilisable pendant l'import. Sans IA, l'app fonctionne aussi : seuls le chat, la mise à jour du profil, la reconnaissance des nouveaux ingrédients et la traduction sont en pause.

## Données et vie privée

Tout reste sur ton PC, dans le dossier de l'app. Réglages → « Exporter mes données » produit un fichier JSON avec ton stock, tes favoris, tes rejets, tes préférences, ton profil et tes conversations. Avec le modèle local, rien ne sort de ton PC. Avec Claude, seul ce qui est nécessaire à chaque appel (la recette, ton stock, ton profil) est envoyé, via ton propre compte. Le serveur local de l'app ne répond qu'à l'app elle-même : les autres sites ouverts dans ton navigateur ne peuvent ni lire ni modifier tes données.

## Sources

Les recettes, photos et textes appartiennent à [Marmiton](https://www.marmiton.org) et à leurs auteurs ; chaque fiche renvoie vers la page d'origine. Ce projet est un outil **personnel** : il ne lit que les pages autorisées par le `robots.txt` du site, à raison d'une page toutes les 2,5 secondes, s'identifie honnêtement, et ne redistribue aucun contenu (la base reste locale). Merci de respecter ces conditions si tu le réutilises.

---

Pour contribuer ou modifier l'app : [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md).

---

<a id="english"></a>

# Recipe Finder (English)

**What's for dinner tonight, with what's in the fridge?**

Recipe Finder is a personal, 100% local app that suggests **real recipes** (from Marmiton, the French recipe site, not invented by an AI) that you can cook with the ingredients you already have, ranked by your tastes. An AI acts as an assistant (your Claude subscription, or a free model running on your PC): it keeps your profile up to date and answers your questions about a recipe, without being called on every click.

<p align="center">
  <img src="docs/screenshots/ingredients-en.png" alt="Ingredients tab: pantry, quantities, “use soon” and cupboard basics" width="49%">
  <img src="docs/screenshots/questionnaire-en.png" alt="Welcome questionnaire: people, time, washing up, diet, allergies, appliances" width="49%">
</p>

## Features

- **My ingredients**: your pantry with quantities, autocomplete, a “use soon” badge to finish what would go to waste, and cupboard basics (salt, oil, flour…) always counted as available.
- **Recipes**: recipes you can make **without buying anything**, 10 at a time, filterable by type (main, starter, side, dessert, appetiser, breakfast, drink, sauce) and by time. The list updates as soon as your pantry changes.
- **Almost**: recipes where you're missing 1 to 3 ingredients, preferably easy to find.
- **Like / dislike**: a like saves the recipe to your favourites (a full local copy, even if the page disappears); a dislike hides it. You can also reject a specific ingredient in one click.
- **Recipe page**: quantities scaled to the number of people, times, equipment, number of items to wash, steps, link to the source, and a **chat with the AI** (Claude or the local model) that already knows the recipe, your pantry and your tastes.
- **Profile**: a short welcome questionnaire (people, time, washing up, diet, allergies, appliances, tastes), then a profile the AI refines from your likes, rejections and questions. Firm dislikes (“nothing from the sea”) become strict exclusions.
- **Who I cook for**: add your family members, each with their own diet, allergies and dislikes. When choosing, you tick who is eating: everyone's exclusions apply and portions adjust.
- **Allergies and diets**: strict exclusions by family (gluten, lactose, nuts, fish…), checked against the ingredients and the full recipe text.
- **French or English**: the whole interface exists in both languages. In English, recipes (in French on the site) are translated by the AI the first time they are shown, units included (c. à soupe → tbsp), then kept on your PC; you can type your ingredients in English.
- **Catalogue**: 5,000 well-rated recipes on first launch (about 5 hours of import; the app is usable after the first few hundred), expandable from Settings.

> **Claude, local model or both?** Every feature works with either. The difference is quality: with the **local model alone**, chat answers are simpler and sometimes less reliable (substitutions, cooking advice), and the profile captures the nuances of your notes less finely. With **your Claude subscription**, chat and profile are clearly better; the local model, if installed, then handles background tasks to spare your subscription. Without any AI, everything works except chat, profile updates, recognising new ingredients and English translation.

## How it works

- **Local catalogue**: recipes are read from the structured data (schema.org/Recipe) of Marmiton pages, then stored in a local SQLite database. Each ingredient line (“2 gousses d'ail hachées”) is reduced to a base ingredient (“ail”, garlic) by a local parser; only unknown terms are sent to the AI, in batches, and the result is cached.
- **Local ranking, no AI**: loading or recomputing a list costs no AI call. The score combines your pantry, what needs using soon, the recipe rating (weighted by number of reviews), similarity to what you like or reject, your preferences, and ~30% exploration so suggestions don't go round in circles.
- **AI, sparingly and without an API key**: only for chat, profile updates (from 10 new signals, at most once an hour, or on demand), recognising new ingredients and translation. Two providers, usable together:
  - **your Claude subscription** (Pro, Max…), via Claude Code: best quality, used first for chat and profile;
  - **a free local model** (Gemma 3 via [Ollama](https://ollama.com)): private, offline, used first for background tasks. It needs a decent graphics card; a lighter version exists for more modest PCs.

  If one is missing or fails, the other takes over. Calls are queued so they never go out in bursts.

## Install

On Windows 10 or 11, with nothing to install beforehand:

1. Download the project (green **Code → Download ZIP** button) and unzip it wherever you like.
2. Double-click **`install.cmd`**.

The script installs Node.js if needed, sets up the app, creates the **Recipe Finder** shortcut on the desktop and opens the app. After that, the shortcut is all you need: it starts the app in the background and opens it in your default browser (in its own window with Chrome, Edge, Brave or Vivaldi).

On first launch:

1. pick your language and answer a short questionnaire (people, time, washing up, diet, allergies, appliances, tastes);
2. **Connect an AI**, optional, one click per option:
   - **“Connect my Claude subscription”**: the app installs Claude Code if needed and opens the sign-in to your account in the browser (Pro, Max, Team or Enterprise subscription; the free plan does not include Claude Code);
   - **“Install the local model”**: the app installs Ollama and downloads the model (about 8 GB), with progress shown.

The catalogue import starts right away; the first recipes arrive within minutes and the app stays usable during the import. Without AI the app works too: only chat, profile updates, recognising new ingredients and translation are paused.

## Data and privacy

Everything stays on your PC, in the app folder. Settings → “Export my data” produces a JSON file with your pantry, favourites, rejections, preferences, profile and conversations. With the local model, nothing leaves your PC. With Claude, only what each call needs (the recipe, your pantry, your profile) is sent, through your own account. The app's local server only answers the app itself: other websites open in your browser cannot read or change your data.

## Sources

Recipes, photos and texts belong to [Marmiton](https://www.marmiton.org) and their authors; every recipe page links back to the original. This project is a **personal** tool: it only reads pages allowed by the site's `robots.txt`, one page every 2.5 seconds, identifies itself honestly, and redistributes no content (the database stays local). Please respect these conditions if you reuse it.

---

To contribute or modify the app: [docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md) (in French).
