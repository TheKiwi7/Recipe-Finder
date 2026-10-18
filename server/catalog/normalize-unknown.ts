import { askAI, parseJsonReply } from '../ai.ts';
import { loadAliases, type Db } from '../db.ts';
import { reresolveRecipes } from './store.ts';
import { normalizeKey } from './text.ts';
import { isAmbiguousTail } from './ingredients.ts';

const BATCH = 100;

const SYSTEM = `Tu normalises des ingrédients de recettes françaises pour une app qui compare les recettes au stock de l'utilisateur : une recette n'est proposée comme faisable que si la personne a chaque ingrédient de base.
Pour chaque terme, donne l'ingrédient de base tel qu'on l'achète et le range dans sa cuisine : court, en minuscules, au singulier sauf usage (« pâtes », « lentilles »), sans quantité ni préparation.
- Réutilise une base existante dès qu'elle désigne bien le même produit (« bouillon de volaille » → bouillon, « sucre de canne » → sucre).
- Garde distinct ce qui s'achète séparément (« eau de fleur d'oranger » → fleur d'oranger, « œufs de saumon » → œufs de saumon, « farine de châtaigne » → farine de châtaigne, « huile d'arachide » → huile d'arachide).
- Une marque devient le produit générique (« Vache qui rit » → fromage fondu, « Boursin » → fromage frais aux herbes, « Nutella » → pâte à tartiner).
- Les produits tout prêts, alcools, sauces et condiments sont des ingrédients (béchamel, pesto, rhum, sauce soja, compote, glace, fumet de poisson).
- Un terme vague mais comestible reçoit une base générique (« fruits rouges », « fruits secs », « épices », « herbes aromatiques »).
- null UNIQUEMENT pour ce qui ne s'achète pas ou ne se mange pas : glaçons, eau de cuisson, jus de cuisson, restes, décoration non comestible.
Réponds uniquement par un objet JSON {"terme": "base" | null}, avec exactement les termes reçus comme clés.`;

const CONSOLIDATE_SYSTEM = `Tu nettoies la liste des ingrédients de base d'une app de recettes françaises. Une recette est « faisable » si la personne a chacun de ses ingrédients de base : deux noms pour un même produit font croire qu'il manque quelque chose.
Repère les doublons : des noms différents pour un produit qu'on achète et range de la même façon (« blanc de poulet » et « poulet », « boisson aux amandes » et « lait végétal », « beurre de cacahuète » et « purée de cacahuète », « thon à l'huile » et « thon »).
Ne fusionne PAS des produits distincts (« huile d'olive » ≠ « huile », « sucre glace » ≠ « sucre », « pâte brisée » ≠ « pâte feuilletée », « crème de coco » ≠ « crème fraîche »).
Réponds uniquement par un objet JSON {"doublon": "nom canonique"}, où chaque nom canonique est un nom de la liste reçue. N'inclus que les doublons à fusionner.`;

/** Fusionne les ingrédients de base qui désignent le même produit (un appel Claude Sonnet). Renvoie les fusions faites. */
export async function consolidateBases(db: Db): Promise<Array<[dup: string, canon: string]>> {
  const rows = db.prepare('SELECT base, COUNT(*) n FROM recipe_ingredients GROUP BY base ORDER BY n DESC').all() as Array<{ base: string; n: number }>;
  const seedBases = new Set((db.prepare(`SELECT DISTINCT base FROM ingredient_aliases WHERE origin = 'seed' AND base IS NOT NULL`).all() as Array<{ base: string }>).map(r => r.base));
  const all = new Set(rows.map(r => r.base));
  const prompt = `Ingrédients de base (nombre de recettes) :\n${rows.map(r => `${r.base} (${r.n})`).join('\n')}`;
  const reply = parseJsonReply<Record<string, string>>(await askAI(prompt, { tier: 'strong', system: CONSOLIDATE_SYSTEM, timeoutMs: 300_000, lane: 'background', json: true }));

  const merged: Array<[string, string]> = [];
  db.exec('BEGIN');
  for (const [dup, canon] of Object.entries(reply)) {
    // Le dictionnaire de départ fait foi : on ne renomme jamais une de ses bases.
    if (dup === canon || !all.has(dup) || !all.has(canon) || seedBases.has(dup)) continue;
    db.prepare('UPDATE ingredient_aliases SET base = ? WHERE base = ?').run(canon, dup);
    db.prepare(`INSERT INTO ingredient_aliases (key, base, origin) VALUES (?, ?, 'claude') ON CONFLICT(key) DO UPDATE SET base = excluded.base WHERE origin = 'claude'`).run(normalizeKey(dup), canon);
    for (const table of ['pantry', 'staples', 'banned_ingredients']) db.prepare(`UPDATE OR IGNORE ${table} SET base = ? WHERE base = ?`).run(canon, dup);
    merged.push([dup, canon]);
  }
  db.exec('COMMIT');
  if (merged.length) reresolveRecipes(db, true);
  return merged;
}

/**
 * Remet en file les alias créés par Claude qui ramènent « X de Y » à X (« oeuf de saumon » → oeuf),
 * pour qu'ils soient réexaminés avec la consigne actuelle. Renvoie le nombre d'alias remis en file.
 */
export function requeueSuspiciousAliases(db: Db): number {
  const rows = db.prepare(`SELECT key, base FROM ingredient_aliases WHERE origin = 'claude' AND base IS NOT NULL`).all() as Array<{ key: string; base: string }>;
  const drop = db.prepare('DELETE FROM ingredient_aliases WHERE key = ?');
  let n = 0;
  for (const r of rows) {
    const b = normalizeKey(r.base);
    if (r.key !== b && r.key.startsWith(`${b} `) && isAmbiguousTail(r.key.slice(b.length + 1))) { drop.run(r.key); n++; }
  }
  return n;
}

/** Envoie un lot de termes inconnus à Claude (Haiku) et enregistre les correspondances. Renvoie le nombre de termes traités. */
export async function resolveUnknownTerms(db: Db): Promise<number> {
  const terms = db.prepare('SELECT key, example FROM unknown_terms ORDER BY occurrences DESC LIMIT ?').all(BATCH) as Array<{ key: string; example: string }>;
  if (terms.length === 0) return 0;
  const bases = (db.prepare('SELECT DISTINCT base FROM ingredient_aliases WHERE base IS NOT NULL ORDER BY base').all() as Array<{ base: string }>).map(r => r.base);

  const prompt = `Bases existantes : ${bases.join(', ')}

Termes à normaliser (terme — exemple de ligne de recette) :
${terms.map(t => `${t.key} — ${t.example}`).join('\n')}`;

  const reply = parseJsonReply<Record<string, string | null>>(await askAI(prompt, { tier: 'light', system: SYSTEM, timeoutMs: 300_000, lane: 'background', json: true }));

  const insert = db.prepare(`INSERT INTO ingredient_aliases (key, base, origin) VALUES (?, ?, 'claude') ON CONFLICT(key) DO NOTHING`);
  const known = loadAliases(db);
  const drop = db.prepare('DELETE FROM unknown_terms WHERE key = ?');
  db.exec('BEGIN');
  for (const t of terms) {
    if (!(t.key in reply)) continue; // oublié par Claude : reste en file pour le prochain lot
    const base = reply[t.key];
    // Une base déjà connue sous une autre graphie (« bœuf haché » / « boeuf haché ») reprend celle du dictionnaire.
    const clean = typeof base === 'string' && base.trim() ? base.trim().toLowerCase() : null;
    const canon = clean ? (known.get(normalizeKey(clean)) ?? clean) : null;
    insert.run(t.key, canon);
    // La base elle-même devient un alias, pour que la saisie de l'utilisateur la reconnaisse.
    if (canon) insert.run(normalizeKey(canon), canon);
    drop.run(t.key);
  }
  db.exec('COMMIT');
  reresolveRecipes(db);
  return terms.length;
}
