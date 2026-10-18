// Exporte le vocabulaire d'ingrédients appris (termes → ingrédient de base, normalisés par l'IA au fil des imports)
// dans server/catalog/learned-aliases.json, livré avec l'app : une nouvelle installation reconnaît ainsi presque
// tous les ingrédients dès le premier import, même sans IA. Du vocabulaire culinaire, pas du contenu de recettes.
import { writeFileSync } from 'node:fs';
import { openDb } from '../db.ts';

const db = openDb();
const rows = db.prepare(`SELECT key, base FROM ingredient_aliases WHERE origin IN ('claude', 'learned') ORDER BY key`).all() as Array<{ key: string; base: string | null }>;
// Vocabulaire générique seulement (4 mots au plus, sans marque ni quantité) : un terme culinaire courant, pas un
// morceau de recette recopié. Les conditions de Marmiton interdisent d'extraire des données de sa base hors usage privé.
const BRAND = /vahine|herta|nestle|carapelli|kub|netto|knacki|philadelphia|president|bonne maman|maggi|knorr|lustucru|panzani|barilla|danone|sojasun|alsa|ancel|francine|nutella|bridelice|elle et vire|saint moret|kiri|babybel|leerdammer|lu |marie|fleury michon|daunat|picard|carrefour|leclerc|auchan|lidl|casino|monoprix|thermomix|cookeo|tupperware/;
const kept = rows.filter(r => r.key.split(' ').length <= 4 && r.key.length <= 40 && !/^\d/.test(r.key) && !BRAND.test(r.key));
const out = Object.fromEntries(kept.map(r => [r.key, r.base]));
writeFileSync(new URL('../catalog/learned-aliases.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
console.log(`${kept.length} termes exportés (${rows.length - kept.length} phrases écartées)`);
