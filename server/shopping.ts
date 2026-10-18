import type { Db } from './db.ts';
import type { IngredientLine } from './catalog/ingredients.ts';
import { normalizeKey } from './catalog/text.ts';
import { addPantryItem, baseFor, listPantry, updatePantryItem, type PantryItem } from './pantry.ts';
import { availableBases } from './reco/service.ts';
import { isGeneric } from './reco/generic.ts';
import { recordSignal } from './preferences.ts';
import { L } from './i18n.ts';

// « Je fais cette recette » : ce qui manque (absent du stock, ou en quantité insuffisante) va dans la liste de courses.
// « Acheté » range l'article dans le stock.

export type ShoppingItem = { id: number; base: string; qty: number | null; unit: string | null; recipes: Array<{ id: number; name: string }> };
export type Need = { base: string; qty: number | null; unit: string | null };

// ---------- unités ----------

type UnitInfo = { family: string; factor: number };
const MASS: Record<string, number> = { mg: 0.001, g: 1, gr: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, cl: 10, dl: 100, l: 1000 };

/** Famille d'unité (masse, volume, nombre, ou contenant : sachet, boîte…) et facteur vers l'unité de base de la famille. */
export function unitInfo(unit: string | null): UnitInfo {
  if (!unit) return { family: 'count', factor: 1 };
  const u = normalizeKey(unit.replace(/\(s\)/g, ''));
  if (u in MASS) return { family: 'mass', factor: MASS[u] };
  if (u in VOLUME) return { family: 'volume', factor: VOLUME[u] };
  if (/^(c a soupe|cuillere a soupe|cs|c s)$/.test(u)) return { family: 'volume', factor: 15 };
  if (/^(c a cafe|cuillere a cafe|cc|c c)$/.test(u)) return { family: 'volume', factor: 5 };
  if (u === 'piece') return { family: 'count', factor: 1 };
  return { family: `other:${u}`, factor: 1 };
}

/** Quantité à acheter arrondie vers le haut (en grammes / millilitres) : on n'achète pas 1,4 œuf ni 137 g de farine. */
function roundUp(qty: number, unit: string | null): number {
  const { family, factor } = unitInfo(unit);
  if (family === 'mass' || family === 'volume') {
    if (factor === 5 || factor === 15) return Math.ceil(qty * 2 - 1e-9) / 2; // cuillères : à la demi-cuillère
    const base = qty * factor;
    const step = base >= 100 ? 10 : base >= 20 ? 5 : 1;
    return (Math.ceil(base / step - 1e-9) * step) / factor;
  }
  return Math.ceil(qty - 1e-9);
}

// ---------- ce qui manque pour une recette ----------

/**
 * Besoins d'une recette pour `factor` fois ses portions, face au stock. Absent du stock (et du placard) : tout est
 * à acheter. Présent avec une quantité comparable (même famille d'unité) : seulement la différence. Présent sans
 * quantité, dans une autre unité, ou ingrédient générique (« fromage ») couvert par le stock : on suppose qu'il y en a assez.
 */
export function shoppingNeeds(lines: IngredientLine[], factor: number, pantry: PantryItem[], available: Set<string>): Need[] {
  const wanted = new Map<string, Need>();
  for (const l of lines) {
    if (!l.base) continue;
    const qty = l.qty === null ? null : l.qty * factor;
    const cur = wanted.get(l.base);
    if (!cur) { wanted.set(l.base, { base: l.base, qty, unit: l.unit }); continue; }
    // Même ingrédient sur deux lignes : quantités additionnées si les unités sont comparables.
    const a = unitInfo(cur.unit), b = unitInfo(l.unit);
    if (cur.qty !== null && qty !== null && a.family === b.family) cur.qty += (qty * b.factor) / a.factor;
  }
  const needs: Need[] = [];
  for (const w of wanted.values()) {
    if (!available.has(w.base)) { needs.push({ ...w, qty: w.qty === null ? null : roundUp(w.qty, w.unit) }); continue; }
    if (w.qty === null || isGeneric(w.base)) continue;
    const want = unitInfo(w.unit);
    const stock = pantry.filter(p => p.base === w.base);
    const comparable = stock.filter(p => p.qty !== null && unitInfo(p.unit).family === want.family);
    // Au placard (sel, huile…), sans quantité notée, ou dans une autre unité : on ne peut pas comparer, on suppose assez.
    if (!stock.length || comparable.length < stock.length) continue;
    const have = comparable.reduce((s, p) => s + (p.qty! * unitInfo(p.unit).factor) / want.factor, 0);
    if (have + 1e-9 < w.qty) needs.push({ base: w.base, qty: roundUp(w.qty - have, w.unit), unit: w.unit });
  }
  return needs;
}

// ---------- liste de courses ----------

type Row = { id: number; base: string; qty: number | null; unit: string | null; recipes: string };
const toItem = (r: Row): ShoppingItem => ({ id: r.id, base: r.base, qty: r.qty, unit: r.unit, recipes: JSON.parse(r.recipes) });

export function listShopping(db: Db): ShoppingItem[] {
  return (db.prepare('SELECT id, base, qty, unit, recipes FROM shopping ORDER BY base COLLATE NOCASE').all() as Row[]).map(toItem);
}

/** Ajoute (ou cumule avec un article déjà sur la liste, si les unités sont comparables). */
function addNeed(db: Db, n: Need, recipe: { id: number; name: string } | null): void {
  const rows = db.prepare('SELECT id, base, qty, unit, recipes FROM shopping WHERE base = ?').all(n.base) as Row[];
  const same = rows.find(r => (r.qty === null || n.qty === null) || unitInfo(r.unit).family === unitInfo(n.unit).family);
  if (!same) {
    db.prepare('INSERT INTO shopping (base, qty, unit, recipes, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(n.base, n.qty, n.unit, JSON.stringify(recipe ? [recipe] : []), new Date().toISOString());
    return;
  }
  const recipes = JSON.parse(same.recipes) as Array<{ id: number; name: string }>;
  if (recipe && !recipes.some(r => r.id === recipe.id)) recipes.push(recipe);
  // Une des deux demandes sans quantité : on garde l'autre ; sinon on additionne dans l'unité déjà sur la liste.
  const qty = same.qty === null ? n.qty : n.qty === null ? same.qty
    : roundUp(same.qty + (n.qty * unitInfo(n.unit).factor) / unitInfo(same.unit).factor, same.unit);
  db.prepare('UPDATE shopping SET qty = ?, unit = ?, recipes = ? WHERE id = ?').run(qty, same.qty === null ? n.unit : same.unit, JSON.stringify(recipes), same.id);
}

export class CookError extends Error {}

/** « Je fais cette recette » pour `persons` personnes : ce qui manque part sur la liste de courses. */
export function cookRecipe(db: Db, recipeId: number, persons: number): { added: Need[]; items: ShoppingItem[] } {
  const row = db.prepare('SELECT id, name, servings, ingredients FROM recipes WHERE id = ?').get(recipeId) as { id: number; name: string; servings: number; ingredients: string } | undefined;
  if (!row) throw new CookError(L('Recette introuvable', 'Recipe not found'));
  const factor = Math.max(1, Math.round(persons)) / (row.servings || Math.max(1, Math.round(persons)));
  const needs = shoppingNeeds(JSON.parse(row.ingredients) as IngredientLine[], factor, listPantry(db), availableBases(db).available);
  db.exec('BEGIN');
  for (const n of needs) addNeed(db, n, { id: row.id, name: row.name });
  db.exec('COMMIT');
  // Vouloir cuisiner une recette en dit long sur les goûts : signal pour le profil.
  recordSignal(db, 'cook', `${row.name} (${persons} pers.)`);
  return { added: needs, items: listShopping(db) };
}

/** Ajout à la main (« + lait »). */
export function addShoppingItem(db: Db, input: { term: string; qty?: number | null; unit?: string | null }): ShoppingItem[] {
  const base = baseFor(db, input.term);
  if (!base) throw new CookError(L('Nom vide', 'Empty name'));
  addNeed(db, { base, qty: input.qty ?? null, unit: input.qty ? input.unit ?? null : null }, null);
  return listShopping(db);
}

export function removeShoppingItem(db: Db, id: number): void {
  db.prepare('DELETE FROM shopping WHERE id = ?').run(id);
}

// Unités du stock (menu de l'onglet Ingrédients) : l'article acheté y est rangé dans une unité que le menu connaît.
const PANTRY_UNIT: Record<string, string> = {
  count: 'pièce(s)', 'other:sachet': 'sachet(s)', 'other:boite': 'boîte(s)', 'other:pot': 'pot(s)',
  'other:tranche': 'tranche(s)', 'other:botte': 'botte(s)', 'other:gousse': 'gousse(s)',
};
function toPantryUnit(qty: number | null, unit: string | null): { qty: number | null; unit: string | null } {
  if (qty === null) return { qty: null, unit: null };
  const info = unitInfo(unit);
  if (info.family === 'mass') return info.factor >= 1000 ? { qty, unit: 'kg' } : { qty: qty * info.factor, unit: 'g' };
  if (info.family === 'volume') {
    if (info.factor === 15) return { qty, unit: 'c. à soupe' };
    if (info.factor === 5) return { qty, unit: 'c. à café' };
    return info.factor >= 1000 ? { qty, unit: 'l' } : { qty: qty * info.factor, unit: 'ml' };
  }
  const u = PANTRY_UNIT[info.family];
  return u ? { qty, unit: u } : { qty: null, unit: null };
}

/** Article acheté : rangé dans le stock (quantité ajoutée à l'existant si comparable), retiré de la liste. */
export function buyShoppingItem(db: Db, id: number): void {
  const row = db.prepare('SELECT id, base, qty, unit, recipes FROM shopping WHERE id = ?').get(id) as Row | undefined;
  if (!row) return;
  const bought = toPantryUnit(row.qty, row.unit);
  const existing = listPantry(db).find(p => p.base === row.base);
  if (!existing) addPantryItem(db, { label: row.base, qty: bought.qty, unit: bought.unit });
  else if (existing.qty !== null && bought.qty !== null && unitInfo(existing.unit).family === unitInfo(bought.unit).family) {
    const qty = existing.qty + (bought.qty * unitInfo(bought.unit).factor) / unitInfo(existing.unit).factor;
    updatePantryItem(db, existing.id, { qty: Math.round(qty * 100) / 100 });
  }
  db.prepare('DELETE FROM shopping WHERE id = ?').run(id);
}

export function buyAllShopping(db: Db): void {
  for (const it of listShopping(db)) buyShoppingItem(db, it.id);
}

export function clearShopping(db: Db): void {
  db.exec('DELETE FROM shopping');
}
