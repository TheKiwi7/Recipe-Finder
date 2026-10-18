# Recipe Finder

**Qu'est-ce qu'on mange ce soir, avec ce qu'il y a dans le frigo ?**

Recipe Finder est une app perso, 100 % locale, qui propose de **vraies recettes** (issues de Marmiton, pas inventées par une IA) faisables avec les ingrédients que tu as chez toi, classées selon tes goûts. Claude sert d'assistant : il tient ton profil à jour et répond à tes questions sur une recette, sans être appelé à chaque clic.

<p align="center">
  <img src="docs/screenshots/ingredients.png" alt="Onglet Ingrédients : stock, quantités, « à finir vite » et placard de base" width="49%">
  <img src="docs/screenshots/questionnaire.png" alt="Questionnaire d'accueil : personnes, temps, vaisselle, régime, allergies, appareils" width="49%">
</p>

## Fonctionnalités

- **Mes ingrédients** : ton stock avec quantités, autocomplétion, badge « à finir vite » pour écouler ce qui va se perdre, et un placard de base (sel, huile, farine…) toujours considéré comme disponible.
- **Recettes** : des recettes faisables **sans rien acheter**, 10 par 10, filtrables par type et par durée. La liste se met à jour dès que ton stock change.
- **Presque** : les recettes où il te manque 1 à 3 ingrédients, de préférence faciles à trouver.
- **Like / dislike** : un like range la recette dans tes favoris (copie locale complète, même si la page disparaît) ; un dislike l'écarte. Tu peux aussi rejeter un ingrédient précis d'un clic.
- **Fiche recette** : quantités recalculées pour ton nombre de personnes, temps, ustensiles, nombre de pièces à laver, étapes, lien vers la source, et un **chat avec Claude** qui connaît déjà la recette, ton stock et tes goûts.
- **Profil** : un questionnaire de départ (personnes, temps, vaisselle, régime, allergies, appareils, goûts), puis un profil que Claude affine à partir de tes likes, rejets et questions. Tes aversions fermes (« rien qui vienne de la mer ») deviennent des exclusions strictes.
- **Catalogue** : plusieurs milliers de recettes bien notées, importées en tâche de fond et extensibles depuis les Réglages.

## Comment ça marche

- **Catalogue local** : les recettes sont lues depuis les données structurées (schema.org/Recipe) des pages Marmiton, puis stockées dans une base SQLite locale. Chaque ligne d'ingrédient (« 2 gousses d'ail hachées ») est ramenée à un ingrédient de base (« ail ») par un analyseur local ; seuls les termes inconnus sont envoyés à Claude, par lots, et le résultat est mis en cache.
- **Classement local, sans IA** : charger ou recalculer une liste ne coûte aucun appel. Le score combine ton stock, ce qui est « à finir vite », la note de la recette (pondérée par le nombre d'avis), la ressemblance avec ce que tu aimes ou rejettes, tes préférences, et ~30 % d'exploration pour ne pas tourner en rond.
- **Claude, avec parcimonie** : uniquement pour le chat (Haiku), la mise à jour du profil (Sonnet, dès 10 nouveaux signaux, au plus une fois par heure, ou à la demande) et la normalisation des nouveaux ingrédients. Les appels passent par le CLI officiel `claude`, donc par ton abonnement Claude, et sont mis en file pour ne jamais partir en rafale.

## Démarrer

**Prérequis** : Windows, [Node.js](https://nodejs.org) 24 ou plus, le navigateur [Brave](https://brave.com), et [Claude Code](https://claude.com/claude-code) connecté à ton compte (la commande `claude` doit fonctionner dans un terminal).

```bash
git clone https://github.com/TheKiwi7/Recipe-Finder.git
cd Recipe-Finder
npm install
npm run build
npm run shortcut   # crée le raccourci « Recipe Finder » sur le bureau
```

Double-clique ensuite sur le raccourci : il démarre le serveur en arrière-plan et ouvre l'app dans une fenêtre Brave dédiée. Au premier lancement, un court questionnaire s'affiche et l'import du catalogue démarre. Les premières recettes arrivent en quelques minutes ; l'app reste utilisable pendant l'import, qui reprend à chaque ouverture.

Sans Claude, l'app reste utilisable : seuls le chat, la mise à jour du profil et la normalisation des nouveaux ingrédients sont en pause.

## Commandes

| Commande | Rôle |
|---|---|
| `npm start` | Serveur sur http://127.0.0.1:5317 (sert l'interface construite) |
| `npm run dev` | Développement : serveur + Vite avec rechargement (http://localhost:5318) |
| `npm run build` | Construit l'interface (`client/dist`) |
| `npm test` | Tests (analyse des ingrédients, pages Marmiton, classement, mise en forme) |
| `npm run typecheck` | Vérification TypeScript, serveur et client |
| `npm run audit` | Rapport de qualité du catalogue importé |
| `npm run import` | Import en ligne de commande jusqu'à l'objectif des Réglages (`-- --target N` pour un autre objectif) |
| `npm run import -- --normalize-only` | Envoie à Claude les ingrédients non reconnus en attente |
| `npm run import -- --consolidate` | Fusionne les ingrédients de base en double |

## Organisation du code

```
server/            Serveur Node (Hono + node:sqlite), TypeScript exécuté directement par Node 24
  catalog/         Import Marmiton, analyse des lignes d'ingrédients, ustensiles, normalisation
  reco/            Classement local (rank.ts, sans base ni Claude) et accès aux données
  claude.ts        Seul point d'appel à Claude (CLI headless) : à remplacer pour passer à une clé API
  profile.ts       Profil et réglages structurés (Sonnet)
  chat.ts          Chat par recette (Haiku)
client/            Interface React (Vite)
scripts/           Lanceur Windows et création du raccourci
docs/SPEC.md       Spécification détaillée et décisions de conception
data/              Base SQLite, images des favoris, journaux (hors git)
```

## Données et vie privée

Tout reste sur ta machine, dans `data/` (exclu de git). Réglages → « Exporter mes données » produit un fichier JSON avec ton stock, tes favoris, tes rejets, tes préférences, ton profil et tes conversations. Claude ne reçoit que ce qui est nécessaire à chaque appel (la recette, ton stock, ton profil), via ton propre compte.

## Sources

Les recettes, photos et textes appartiennent à [Marmiton](https://www.marmiton.org) et à leurs auteurs ; chaque fiche renvoie vers la page d'origine. Ce projet est un outil **personnel** : il ne lit que les pages autorisées par le `robots.txt` du site, à raison d'une page toutes les 2,5 secondes, et ne redistribue aucun contenu (la base reste locale). Merci de respecter ces conditions si tu le réutilises.
