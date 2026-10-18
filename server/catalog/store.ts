import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getMeta, loadAliases, setMeta, type Db } from '../db.ts';
import { seedAliases } from './seed-ingredients.ts';
import { cleanName, realImage, recipeType } from './recipe.ts';
import { countDishes, deduceUtensils, devicesInName, utensilsFor, withNameDevices } from './utensils.ts';
import { parseIngredientLine, resolveBase, type IngredientLine } from './ingredients.ts';
import type { ParsedRecipe } from './recipe.ts';
import { normalizeKey } from './text.ts';
import { familyOf, isGeneric } from '../reco/generic.ts';

type Aliases = ReadonlyMap<string, string | null>;

/**
 * Ingrédient générique précisé par le titre : « 100 g de fromages » dans une « Sauce au bleu d'Auvergne » est du
 * fromage bleu, « 1 kg de viande » dans un « Rôti de porc » est du porc. Seulement si la recette ne le liste pas déjà.
 */
function refineFromTitle(lines: IngredientLine[], title: string, aliases: Aliases): IngredientLine[] {
  const words = normalizeKey(title).split(' ').filter(Boolean);
  const present = new Set(lines.map(l => l.base));
  return lines.map(l => {
    if (!l.base || !isGeneric(l.base)) return l;
    for (let n = Math.min(4, words.length); n > 0; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const b = aliases.get(words.slice(i, i + n).join(' '));
        if (b && familyOf(b) === l.base && !present.has(b)) return { ...l, base: b };
      }
    }
    return l;
  });
}

/** Résout les bases ; les termes inconnus sont mis de côté dans unknown_terms pour Claude. */
function resolveLines(db: Db, lines: Omit<IngredientLine, 'base'>[], aliases: Aliases, title = '') {
  const note = db.prepare(`INSERT INTO unknown_terms (key, example) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET occurrences = occurrences + 1`);
  let unresolved = 0;
  const resolved: IngredientLine[] = lines.map(l => {
    const base = resolveBase(l.name, aliases);
    if (base === undefined) {
      unresolved++;
      if (l.name) note.run(normalizeKey(l.name), l.raw);
    }
    return { ...l, base: base ?? null };
  });
  return { resolved: title ? refineFromTitle(resolved, title, aliases) : resolved, unresolved };
}

function writeIngredients(db: Db, recipeId: number | bigint, lines: IngredientLine[]) {
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);
  const ins = db.prepare('INSERT OR IGNORE INTO recipe_ingredients (recipe_id, base) VALUES (?, ?)');
  for (const l of lines) if (l.base) ins.run(recipeId, l.base);
}

export function saveRecipe(db: Db, r: ParsedRecipe, aliases: Aliases): void {
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const { resolved, unresolved } = resolveLines(db, r.ingredients, aliases, r.name);
    const res = db.prepare(`INSERT INTO recipes (source, url, name, image, category_raw, type, total_min, prep_min, cook_min, servings,
        rating, reviews, keywords, ingredients, steps, utensils, utensils_from_site, dishes, unresolved, imported_at, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET checked_at = excluded.checked_at
      RETURNING id`).get(
      r.source, r.url, r.name, r.image, r.categoryRaw, r.type, r.totalMin, r.prepMin, r.cookMin, r.servings,
      r.rating, r.reviews, JSON.stringify(r.keywords), JSON.stringify(resolved), JSON.stringify(r.steps),
      JSON.stringify(r.utensils), r.utensilsFromSite ? 1 : 0, r.dishes, unresolved, now, now,
    ) as { id: number };
    writeIngredients(db, res.id, resolved);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Re-résout les recettes qui avaient des ingrédients inconnus (ou toutes, après un changement du dictionnaire). */
export function reresolveRecipes(db: Db, all = false): number {
  const aliases = loadAliases(db);
  const rows = db.prepare(`SELECT id, name, ingredients FROM recipes ${all ? '' : 'WHERE unresolved > 0'}`).all() as Array<{ id: number; name: string; ingredients: string }>;
  const update = db.prepare('UPDATE recipes SET ingredients = ?, unresolved = ? WHERE id = ?');
  let fixed = 0;
  db.exec('BEGIN');
  for (const row of rows) {
    const { resolved, unresolved } = resolveLines(db, JSON.parse(row.ingredients), aliases, row.name);
    update.run(JSON.stringify(resolved), unresolved, row.id);
    writeIngredients(db, row.id, resolved);
    if (unresolved === 0) fixed++;
  }
  db.exec('COMMIT');
  return fixed;
}

/** Vocabulaire appris livré avec l'app (npm run export-aliases) : termes → ingrédient de base. */
function learnedAliases(): Record<string, string | null> {
  try { return JSON.parse(readFileSync(new URL('./learned-aliases.json', import.meta.url), 'utf8')); } catch { return {}; }
}

/**
 * Si le dictionnaire de départ ou le vocabulaire livré ont changé depuis le dernier lancement : vocabulaire ajouté
 * (sans écraser ce que cette installation a appris elle-même), puis bases de toutes les recettes recalculées.
 */
export function syncSeed(db: Db): void {
  const learned = learnedAliases();
  const hash = createHash('sha1').update(JSON.stringify([seedAliases(), learned])).digest('hex');
  if (getMeta(db, 'seed_hash') === hash) return;
  const ins = db.prepare(`INSERT INTO ingredient_aliases (key, base, origin) VALUES (?, ?, 'learned') ON CONFLICT(key) DO NOTHING`);
  db.exec('BEGIN');
  for (const [key, base] of Object.entries(learned)) ins.run(key, base);
  db.exec('COMMIT');
  canonicalizeClaudeBases(db);
  reresolveRecipes(db, true);
  setMeta(db, 'seed_hash', hash);
}

const CATALOG_MIGRATION = '9';

/** Applique aux recettes déjà importées les corrections faites depuis (titres, types, appareils cités dans le titre, images génériques ou recadrées). */
export function migrateCatalog(db: Db): void {
  if (getMeta(db, 'catalog_migration') === CATALOG_MIGRATION) return;
  const rows = db.prepare('SELECT id, name, category_raw, utensils, utensils_from_site, steps, image, ingredients FROM recipes').all() as Array<{ id: number; name: string; category_raw: string | null; utensils: string; utensils_from_site: number; steps: string; image: string | null; ingredients: string }>;
  const update = db.prepare('UPDATE recipes SET name = ?, type = ?, utensils = ?, dishes = ?, image = ?, ingredients = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of rows) {
    const name = cleanName(r.name);
    // Les lignes d'ingrédients sont ré-analysées depuis le texte d'origine (l'analyseur a pu évoluer).
    const lines = (JSON.parse(r.ingredients) as IngredientLine[]).map(l => ({ ...parseIngredientLine(l.raw), base: l.base }));
    // Ustensiles recalculés : ceux de la liste du site que les étapes justifient, plus ceux que les étapes citent.
    const steps = JSON.parse(r.steps) as string[];
    const nameDevices = devicesInName(name);
    const site = (JSON.parse(r.utensils) as string[]).filter(u => !nameDevices.includes(u));
    const utensils = withNameDevices(r.utensils_from_site ? utensilsFor(site, steps) : deduceUtensils(steps), name);
    update.run(name, recipeType(r.category_raw, name), JSON.stringify(utensils), countDishes(utensils), realImage(r.image), JSON.stringify(lines), r.id);
  }
  db.exec('COMMIT');
  reresolveRecipes(db, true);
  setMeta(db, 'catalog_migration', CATALOG_MIGRATION);
}

/**
 * Les bases créées par Claude qui existent déjà dans le dictionnaire sous une autre graphie ou comme variante
 * (« bœuf haché », « rôti de boeuf ») reprennent la base du dictionnaire.
 */
function canonicalizeClaudeBases(db: Db): void {
  const seed = new Map((db.prepare(`SELECT key, base FROM ingredient_aliases WHERE origin = 'seed'`).all() as Array<{ key: string; base: string | null }>).map(r => [r.key, r.base]));
  const bases = (db.prepare(`SELECT DISTINCT base FROM ingredient_aliases WHERE origin IN ('claude', 'learned') AND base IS NOT NULL`).all() as Array<{ base: string }>).map(r => r.base);
  const update = db.prepare(`UPDATE ingredient_aliases SET base = ? WHERE origin IN ('claude', 'learned') AND base = ?`);
  db.exec('BEGIN');
  for (const b of bases) {
    const target = seed.get(normalizeKey(b));
    if (target && target !== b) update.run(target, b);
  }
  // Profil : les poids d'un ingrédient renommé suivent (sinon « roquefort : -0,55 » ne s'appliquerait plus).
  const raw = getMeta(db, 'profile_weights');
  if (raw) {
    const w = JSON.parse(raw) as { ingredients?: Record<string, number> };
    let changed = false;
    for (const [b, v] of Object.entries(w.ingredients ?? {})) {
      const target = seed.get(normalizeKey(b));
      if (target && target !== b) { delete w.ingredients![b]; w.ingredients![target] ??= v; changed = true; }
    }
    if (changed) setMeta(db, 'profile_weights', JSON.stringify(w));
  }
  // Stock, placard et rejets suivent un ingrédient renommé dans le dictionnaire (« roquefort » → « fromage bleu »).
  for (const table of ['pantry', 'staples', 'banned_ingredients']) {
    for (const { base } of db.prepare(`SELECT DISTINCT base FROM ${table}`).all() as Array<{ base: string }>) {
      const target = seed.get(normalizeKey(base));
      if (target && target !== base) db.prepare(`UPDATE OR IGNORE ${table} SET base = ? WHERE base = ?`).run(target, base);
    }
  }
  db.exec('COMMIT');
}
