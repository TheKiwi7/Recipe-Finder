import { createHash } from 'node:crypto';
import { getMeta, loadAliases, setMeta, type Db } from '../db.ts';
import { seedAliases } from './seed-ingredients.ts';
import { cleanName, recipeType } from './recipe.ts';
import { withNameDevices } from './utensils.ts';
import { resolveBase, type IngredientLine } from './ingredients.ts';
import type { ParsedRecipe } from './recipe.ts';
import { normalizeKey } from './text.ts';

type Aliases = ReadonlyMap<string, string | null>;

/** Résout les bases ; les termes inconnus sont mis de côté dans unknown_terms pour Claude. */
function resolveLines(db: Db, lines: Omit<IngredientLine, 'base'>[], aliases: Aliases) {
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
  return { resolved, unresolved };
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
    const { resolved, unresolved } = resolveLines(db, r.ingredients, aliases);
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
  const rows = db.prepare(`SELECT id, ingredients FROM recipes ${all ? '' : 'WHERE unresolved > 0'}`).all() as Array<{ id: number; ingredients: string }>;
  const update = db.prepare('UPDATE recipes SET ingredients = ?, unresolved = ? WHERE id = ?');
  let fixed = 0;
  db.exec('BEGIN');
  for (const row of rows) {
    const { resolved, unresolved } = resolveLines(db, JSON.parse(row.ingredients), aliases);
    update.run(JSON.stringify(resolved), unresolved, row.id);
    writeIngredients(db, row.id, resolved);
    if (unresolved === 0) fixed++;
  }
  db.exec('COMMIT');
  return fixed;
}

/** Si le dictionnaire de départ a changé depuis le dernier lancement, recalcule les bases de toutes les recettes. */
export function syncSeed(db: Db): void {
  const hash = createHash('sha1').update(JSON.stringify(seedAliases())).digest('hex');
  if (getMeta(db, 'seed_hash') === hash) return;
  canonicalizeClaudeBases(db);
  reresolveRecipes(db, true);
  setMeta(db, 'seed_hash', hash);
}

const CATALOG_MIGRATION = '3';

/** Applique aux recettes déjà importées les corrections faites depuis (titres, types, appareils cités dans le titre). */
export function migrateCatalog(db: Db): void {
  if (getMeta(db, 'catalog_migration') === CATALOG_MIGRATION) return;
  const rows = db.prepare('SELECT id, name, category_raw, utensils FROM recipes').all() as Array<{ id: number; name: string; category_raw: string | null; utensils: string }>;
  const update = db.prepare('UPDATE recipes SET name = ?, type = ?, utensils = ? WHERE id = ?');
  db.exec('BEGIN');
  for (const r of rows) {
    const name = cleanName(r.name);
    update.run(name, recipeType(r.category_raw, name), JSON.stringify(withNameDevices(JSON.parse(r.utensils), name)), r.id);
  }
  db.exec('COMMIT');
  setMeta(db, 'catalog_migration', CATALOG_MIGRATION);
}

/**
 * Les bases créées par Claude qui existent déjà dans le dictionnaire sous une autre graphie ou comme variante
 * (« bœuf haché », « rôti de boeuf ») reprennent la base du dictionnaire.
 */
function canonicalizeClaudeBases(db: Db): void {
  const seed = new Map((db.prepare(`SELECT key, base FROM ingredient_aliases WHERE origin = 'seed'`).all() as Array<{ key: string; base: string | null }>).map(r => [r.key, r.base]));
  const bases = (db.prepare(`SELECT DISTINCT base FROM ingredient_aliases WHERE origin = 'claude' AND base IS NOT NULL`).all() as Array<{ base: string }>).map(r => r.base);
  const update = db.prepare(`UPDATE ingredient_aliases SET base = ? WHERE origin = 'claude' AND base = ?`);
  db.exec('BEGIN');
  for (const b of bases) {
    const target = seed.get(normalizeKey(b));
    if (target && target !== b) update.run(target, b);
  }
  db.exec('COMMIT');
}
