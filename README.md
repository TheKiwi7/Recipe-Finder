# Recipe Finder

App perso, locale, qui recommande des **recettes réelles** (Marmiton) selon les ingrédients disponibles et les goûts, avec Claude en appui (profil, chat), sans exploser l'usage de l'abonnement.

La spécification complète est dans [docs/SPEC.md](docs/SPEC.md).

## Lancer l'app

Double-clic sur le raccourci **Recipe Finder** du bureau. Il démarre le serveur en arrière-plan (si besoin) et ouvre Brave en mode application.

Pour recréer le raccourci : `npm run shortcut`.

Prérequis : Node 24+, et le CLI `claude` connecté à l'abonnement (utilisé pour le profil, le chat et la normalisation des ingrédients). Sans Claude, l'app reste utilisable : seuls le chat et la mise à jour du profil sont en pause.

## Commandes

| Commande | Rôle |
|---|---|
| `npm start` | Serveur sur http://127.0.0.1:5317 (sert l'interface construite) |
| `npm run dev` | Développement : serveur + Vite avec rechargement (http://localhost:5318) |
| `npm run build` | Construit l'interface (`client/dist`) |
| `npm test` | Tests (analyseur d'ingrédients, pages Marmiton, classement, mise en forme) |
| `npm run typecheck` | Vérification TypeScript serveur + client |
| `npm run import -- --target 3000` | Import du catalogue en ligne de commande (reprend où il s'était arrêté) |
| `npm run import -- --normalize-only` | Envoie à Claude les ingrédients non reconnus en attente |
| `npm run import -- --renormalize-ignored` | Refait examiner les termes ignorés et les correspondances « X de Y → X » douteuses |
| `npm run audit` | Rapport de qualité du catalogue importé |

L'app importe aussi en tâche de fond : jusqu'à 3 000 recettes, puis ~100 nouvelles par semaine. Un seul import tourne à la fois (verrou `data/import.lock`).

## Organisation

- `server/` — serveur Node (Hono + `node:sqlite`, TypeScript exécuté directement par Node)
  - `catalog/` — import Marmiton (JSON-LD), analyse des lignes d'ingrédients, ustensiles, normalisation par Claude
  - `reco/` — classement local des recettes (`rank.ts`, sans base ni Claude) et accès aux données (`service.ts`)
  - `claude.ts` — seul point d'appel à Claude (CLI `claude -p`) ; à remplacer pour passer à une clé API
  - `profile.ts`, `chat.ts` — profil (Sonnet) et chat par recette (Haiku)
- `client/` — interface React (Vite)
- `scripts/` — lanceur et création du raccourci
- `data/` — base SQLite, images des favoris, journaux (hors git)

## Données

Tout est local, dans `data/recipe-finder.db`. Réglages → « Exporter mes données » produit un JSON (stock, favoris avec copie complète, rejets, préférences, profil, conversations).
