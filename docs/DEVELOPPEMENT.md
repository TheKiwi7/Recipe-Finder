# Développement

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
| `npm run export-aliases` | Exporte le vocabulaire d'ingrédients appris vers `server/catalog/learned-aliases.json` (livré avec l'app : une nouvelle installation reconnaît presque tout dès le premier import) |
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
  i18n.ts          Langue de l'app, traductions par l'IA (termes, noms, recettes) gardées en base
client/            Interface React (Vite) ; textes FR/EN dans le code via L('fr', 'en') (client/src/i18n.ts)
scripts/           Installation, lanceur (navigateur par défaut, taille de la fenêtre retenue) et création du raccourci
docs/SPEC.md       Spécification détaillée et décisions de conception
data/              Base SQLite, images des favoris, journaux (hors git)
```
