// Audit de la qualité du catalogue importé : npm run audit
// Repère les correspondances d'ingrédients douteuses, les recettes incomplètes et les valeurs aberrantes.
import { openDb } from '../db.ts';
import type { IngredientLine } from '../catalog/ingredients.ts';
import { normalizeKey } from '../catalog/text.ts';

const db = openDb();
const all = <T>(sql: string, ...p: Array<string | number>) => db.prepare(sql).all(...p) as T[];
const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const title = (t: string) => console.log(`\n## ${t}\n`);

type Row = { id: number; name: string; ingredients: string; steps: string; image: string | null; total_min: number; type: string; category_raw: string | null; utensils_from_site: number; dishes: number; unresolved: number };
const recipes = all<Row>('SELECT * FROM recipes');
const lines = recipes.flatMap(r => (JSON.parse(r.ingredients) as IngredientLine[]).map(l => ({ ...l, recipe: r.name })));

title('Import');
const fetched = one(`SELECT COUNT(*) n FROM crawl_queue WHERE status != 'pending'`);
console.log(`${recipes.length} recettes importées sur ${fetched} pages lues (${pct(recipes.length, fetched)} acceptées)`);
for (const r of all<{ status: string; n: number }>(`SELECT status, COUNT(*) n FROM crawl_queue WHERE status NOT IN ('pending', 'imported') GROUP BY status`)) console.log(`- ${r.status} : ${r.n}`);
for (const r of all<{ reason: string; n: number }>(`SELECT reason, COUNT(*) n FROM crawl_queue WHERE status = 'error' GROUP BY reason ORDER BY n DESC LIMIT 5`)) console.log(`  erreur « ${r.reason} » × ${r.n}`);

title('Normalisation des ingrédients');
console.log(`${lines.length} lignes d'ingrédients · ${lines.filter(l => l.base).length} reconnues · ${lines.filter(l => !l.base).length} sans base (ignorées ou inconnues)`);
console.log(`Recettes encore exclues (ingrédient inconnu) : ${recipes.filter(r => r.unresolved > 0).length} · termes en attente de Claude : ${one('SELECT COUNT(*) n FROM unknown_terms')}`);
for (const r of all<{ origin: string; n: number }>('SELECT origin, COUNT(*) n FROM ingredient_aliases GROUP BY origin')) console.log(`- alias ${r.origin} : ${r.n}`);
const ignored = all<{ key: string }>(`SELECT key FROM ingredient_aliases WHERE base IS NULL AND origin = 'claude' ORDER BY key`).map(r => r.key);
console.log(`\nTermes que Claude a jugés « pas un ingrédient » (${ignored.length}) — vérifier qu'il n'y a pas de vrai ingrédient :\n${ignored.join(' · ') || '—'}`);

// Correspondance par préfixe trop courte : « noix de saint-jacques » → « noix », « pomme de ... » → « pomme ».
const pairs = new Map<string, { name: string; base: string; n: number }>();
for (const l of lines) {
  if (!l.base) continue;
  const nk = normalizeKey(l.name), bk = normalizeKey(l.base);
  if (nk !== bk && nk.startsWith(`${bk} `) && /^(de|d|a|au|aux|en)\b/.test(nk.slice(bk.length + 1))) {
    const k = `${nk}→${l.base}`;
    const cur = pairs.get(k) ?? { name: l.name, base: l.base, n: 0 };
    cur.n++;
    pairs.set(k, cur);
  }
}
console.log(`\nCorrespondances par préfixe à vérifier (« X de … » → X), les plus fréquentes :`);
for (const p of [...pairs.values()].sort((a, b) => b.n - a.n).slice(0, 40)) console.log(`- ${p.name} → ${p.base}  (×${p.n})`);

const claudeAliases = all<{ key: string; base: string }>(`SELECT key, base FROM ingredient_aliases WHERE origin = 'claude' AND base IS NOT NULL ORDER BY random() LIMIT 30`);
console.log(`\nÉchantillon d'alias créés par Claude :`);
for (const a of claudeAliases) console.log(`- ${a.key} → ${a.base}`);

const freq = all<{ base: string; n: number }>('SELECT base, COUNT(*) n FROM recipe_ingredients GROUP BY base ORDER BY n DESC');
console.log(`\n${freq.length} ingrédients de base distincts · ${freq.filter(f => f.n === 1).length} n'apparaissent qu'une fois`);
console.log(`Les plus fréquents : ${freq.slice(0, 30).map(f => `${f.base} (${f.n})`).join(', ')}`);
console.log(`Exemples de la longue traîne : ${freq.filter(f => f.n === 1).slice(0, 30).map(f => f.base).join(', ')}`);

title('Qualité des fiches');
const bad = (label: string, rows: Row[]) => console.log(`- ${label} : ${rows.length}${rows.length ? `  (ex. ${rows.slice(0, 3).map(r => r.name).join(' ; ')})` : ''}`);
bad('sans image', recipes.filter(r => !r.image));
bad('sans étapes', recipes.filter(r => JSON.parse(r.steps).length === 0));
bad('durée totale nulle', recipes.filter(r => r.total_min === 0));
bad('durée > 10 h (repos, marinade…)', recipes.filter(r => r.total_min > 600));
bad('type « Autre »', recipes.filter(r => r.type === 'Autre'));
console.log(`Catégories du site classées « Autre » : ${[...new Set(recipes.filter(r => r.type === 'Autre').map(r => r.category_raw))].join(', ') || '—'}`);
console.log(`Types : ${all<{ type: string; n: number }>('SELECT type, COUNT(*) n FROM recipes GROUP BY type ORDER BY n DESC').map(r => `${r.type} ${r.n}`).join(' · ')}`);
console.log(`Ustensiles fournis par le site : ${pct(recipes.filter(r => r.utensils_from_site).length, recipes.length)}`);
console.log(`Pièces à laver : ${all<{ dishes: number; n: number }>('SELECT dishes, COUNT(*) n FROM recipes GROUP BY dishes ORDER BY dishes').map(r => `${r.dishes}→${r.n}`).join(' · ')}`);

title('Échantillon aléatoire (5 recettes)');
for (const r of all<Row>('SELECT * FROM recipes ORDER BY random() LIMIT 5')) {
  console.log(`### ${r.name} [${r.type}, ${r.total_min} min, ${r.dishes} à laver]`);
  for (const l of JSON.parse(r.ingredients) as IngredientLine[]) console.log(`  ${l.raw.padEnd(55)} → ${l.base ?? '∅'}`);
}
