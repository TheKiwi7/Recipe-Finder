# Développement

*English version [below](#development).*

Prérequis : Node.js 24 ou plus. Pour l'IA : Claude Code connecté à un abonnement, et/ou Ollama.

```bash
npm install
npm run dev     # serveur + interface avec rechargement : http://localhost:5318
```

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
| `npm run import -- --normalize-only` | Envoie à l'IA les ingrédients non reconnus en attente |
| `npm run import -- --consolidate` | Fusionne les ingrédients de base en double |
| `npm run export-aliases` | Exporte le vocabulaire d'ingrédients appris (termes génériques de 4 mots au plus, sans marque) vers `server/catalog/learned-aliases.json`, livré avec l'app : une nouvelle installation reconnaît presque tout dès le premier import |
| `npm run shortcut` | Recrée le raccourci du bureau |

Variables d'environnement utiles : `PORT` (5317 par défaut), `RF_DB` (autre fichier de base, pour tester sur une copie), `RF_NO_IMPORT=1` (pas d'import en tâche de fond), `RF_KEEP_ALIVE=1` (le serveur ne s'arrête pas quand aucune fenêtre n'est ouverte).

Sécurité : le serveur n'écoute que sur 127.0.0.1 et l'API refuse les requêtes dont l'hôte ou l'origine n'est pas locale (protection contre les sites tiers et le DNS rebinding). Le CLI `claude` est lancé sans aucun outil (`--tools ''`).

## Organisation du code

```
server/            Serveur Node (Hono + node:sqlite), TypeScript exécuté directement par Node 24
  catalog/         Import Marmiton, analyse des lignes d'ingrédients, ustensiles, normalisation
  reco/            Classement local (rank.ts, sans base ni IA) et accès aux données
  ai.ts            Seul point d'appel à l'IA : abonnement Claude (CLI) ou modèle local (Ollama), routage et repli
  setup.ts         Installation et connexion de l'IA en un clic (winget, Ollama)
  profile.ts       Profil et réglages structurés
  chat.ts          Chat par recette
  shopping.ts      « Je la fais » : ce qui manque (unités converties) → liste de courses → stock
  guard.ts         L'API ne répond qu'à l'app (sites tiers, DNS rebinding)
  update.ts        Mises à jour par git (fetch, pull --ff-only, npm ci si besoin, build, redémarrage)
  i18n.ts          Langue de l'app, traductions par l'IA (termes, noms, recettes) gardées en base
client/            Interface React (Vite) ; textes FR/EN dans le code via L('fr', 'en') (client/src/i18n.ts)
scripts/           Installation, lanceur (navigateur par défaut, taille de la fenêtre retenue) et création du raccourci
docs/SPEC.md       Spécification détaillée et décisions de conception (français, puis anglais)
data/              Base SQLite, images des favoris, journaux (hors git)
```

## Publier une version

Pousser sur `main` ne publie rien : les installations ne proposent que les **versions taguées** (`vX.Y.Z`), avec leurs notes de version. Pour publier :

1. `npm run typecheck`, `npm test`, `npm run build` (et `npm run export-aliases` si le vocabulaire a beaucoup grandi) ;
2. monte `version` dans `package.json` (puis `npm install --package-lock-only`) ;
3. ajoute en tête de `releases.json` une entrée `{ "version", "date": "AAAA-MM-JJ", "fr": [...], "en": [...] }` : quelques phrases pour les utilisateurs, dans les deux langues ;
4. commit, puis `npm run release` : vérifie que tout concorde, crée le tag, pousse `main` et le tag, et crée la *Release* GitHub (si l'outil `gh` est installé).

Les installations la proposent ensuite dans Réglages → Mises à jour (vérification au lancement puis toutes les 6 h), avec les notes dans leur langue.

---

<a id="development"></a>

# Development

Requirements: Node.js 24 or later. For the AI: Claude Code signed in to a subscription, and/or Ollama.

```bash
npm install
npm run dev     # server + interface with hot reload: http://localhost:5318
```

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Server on http://127.0.0.1:5317 (serves the built interface) |
| `npm run dev` | Development: server + Vite with hot reload (http://localhost:5318) |
| `npm run build` | Builds the interface (`client/dist`) |
| `npm test` | Tests (ingredient parsing, Marmiton pages, ranking, shopping, AI fallback, formatting) |
| `npm run typecheck` | TypeScript check, server and client |
| `npm run audit` | Quality report of the imported catalogue |
| `npm run import` | Command-line import up to the Settings goal (`-- --target N` for another goal) |
| `npm run import -- --normalize-only` | Sends pending unrecognised ingredients to the AI |
| `npm run import -- --consolidate` | Merges duplicate base ingredients |
| `npm run export-aliases` | Exports the learned ingredient vocabulary (generic terms of at most 4 words, no brands) to `server/catalog/learned-aliases.json`, shipped with the app: a new install recognises almost everything from the first import |
| `npm run shortcut` | Recreates the desktop shortcut |

Useful environment variables: `PORT` (5317 by default), `RF_DB` (another database file, to test on a copy), `RF_NO_IMPORT=1` (no background import), `RF_KEEP_ALIVE=1` (the server doesn't stop when no window is open).

Security: the server only listens on 127.0.0.1 and the API rejects requests whose host or origin isn't local (protection against third-party sites and DNS rebinding). The `claude` CLI runs without any tools (`--tools ''`).

## Code layout

```
server/            Node server (Hono + node:sqlite), TypeScript run directly by Node 24
  catalog/         Marmiton import, ingredient line parsing, equipment, normalisation
  reco/            Local ranking (rank.ts, no database or AI) and data access
  ai.ts            Single entry point to the AI: Claude subscription (CLI) or local model (Ollama), routing and fallback
  setup.ts         One-click AI install and sign-in (winget, Ollama)
  profile.ts       Profile and structured settings
  chat.ts          Per-recipe chat
  shopping.ts      “I'll make it”: what's missing (units converted) → shopping list → pantry
  guard.ts         The API only answers the app (third-party sites, DNS rebinding)
  update.ts        Git updates (fetch, pull --ff-only, npm ci if needed, build, restart)
  i18n.ts          App language, AI translations (terms, names, recipes) stored in the database
client/            React interface (Vite); FR/EN texts in the code via L('fr', 'en') (client/src/i18n.ts)
scripts/           Install, launcher (default browser, window size remembered) and shortcut creation
docs/SPEC.md       Detailed specification and design decisions (French, then English)
data/              SQLite database, favourite images, logs (not in git)
```

Code comments and commit titles are in French.

## Publishing a version

Pushing to `main` publishes nothing: installs only offer **tagged versions** (`vX.Y.Z`), with their release notes. To publish:

1. `npm run typecheck`, `npm test`, `npm run build` (and `npm run export-aliases` if the vocabulary has grown a lot);
2. bump `version` in `package.json` (then `npm install --package-lock-only`);
3. add an entry at the top of `releases.json`: `{ "version", "date": "YYYY-MM-DD", "fr": [...], "en": [...] }`, a few sentences for users, in both languages;
4. commit, then `npm run release`: checks everything matches, creates the tag, pushes `main` and the tag, and creates the GitHub *Release* (if the `gh` tool is installed).

Installs then offer it in Settings → Updates (checked at launch, then every 6 hours), with the notes in their language.
