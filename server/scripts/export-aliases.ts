// Exporte le vocabulaire d'ingrédients appris (termes → ingrédient de base, normalisés par l'IA au fil des imports)
// dans server/catalog/learned-aliases.json, livré avec l'app : une nouvelle installation reconnaît ainsi presque
// tous les ingrédients dès le premier import, même sans IA. Du vocabulaire culinaire, pas du contenu de recettes.
import { writeFileSync } from 'node:fs';
import { openDb } from '../db.ts';

const db = openDb();
const rows = db.prepare(`SELECT key, base FROM ingredient_aliases WHERE origin IN ('claude', 'learned') ORDER BY key`).all() as Array<{ key: string; base: string | null }>;
// Termes courts seulement : les phrases (« rose oubliée après une Saint-Valentin… ») n'apprennent rien de réutilisable.
const kept = rows.filter(r => r.key.split(' ').length <= 6 && r.key.length <= 50 && !/^\d/.test(r.key));
const out = Object.fromEntries(kept.map(r => [r.key, r.base]));
writeFileSync(new URL('../catalog/learned-aliases.json', import.meta.url), `${JSON.stringify(out, null, 0).replace(/,"/g, ',\n"')}\n`);
console.log(`${kept.length} termes exportés (${rows.length - kept.length} phrases écartées)`);
