import { getMeta, loadAliases, setMeta, type Db } from './db.ts';
import { resolveBase } from './catalog/ingredients.ts';
import { normalizeKey } from './catalog/text.ts';

export const DEFAULT_STAPLES = ['sel', 'poivre', 'huile', "huile d'olive", 'eau', 'sucre', 'farine'];
/** Durée de validité de la confirmation « Mes ingrédients sont à jour » (Q10). */
export const CONFIRM_TTL_MS = 12 * 3600 * 1000;

export type PantryItem = { id: number; label: string; base: string; qty: number | null; unit: string | null; urgent: boolean; showBase: boolean };

export function ensureStaples(db: Db): void {
  if (getMeta(db, 'staples_seeded')) return;
  const ins = db.prepare('INSERT OR IGNORE INTO staples (base) VALUES (?)');
  for (const s of DEFAULT_STAPLES) ins.run(s);
  setMeta(db, 'staples_seeded', '1');
}

export function listPantry(db: Db): PantryItem[] {
  const rows = db.prepare('SELECT id, label, base, qty, unit, urgent FROM pantry ORDER BY urgent DESC, label COLLATE NOCASE').all() as Array<Omit<PantryItem, 'urgent' | 'showBase'> & { urgent: number }>;
  // On n'affiche « compte comme » que si la base diffère vraiment de la saisie (pas pour un simple pluriel).
  return rows.map(r => ({ ...r, urgent: !!r.urgent, showBase: normalizeKey(r.label) !== normalizeKey(r.base) }));
}

export function listStaples(db: Db): string[] {
  return (db.prepare('SELECT base FROM staples ORDER BY base').all() as Array<{ base: string }>).map(r => r.base);
}

/** Ce qu'on tape (« tomates cerises ») → ingrédient de base (« tomate ») ; inconnu → le texte lui-même. */
export function baseFor(db: Db, label: string): string {
  const base = resolveBase(label, loadAliases(db));
  return base ?? label.trim().toLowerCase();
}

function touch(db: Db) {
  setMeta(db, 'pantry_version', String(Number(getMeta(db, 'pantry_version') ?? 0) + 1));
}

export function addPantryItem(db: Db, input: { label: string; qty?: number | null; unit?: string | null; urgent?: boolean }): PantryItem {
  const label = input.label.trim();
  if (!label) throw new Error('Nom vide');
  const now = new Date().toISOString();
  const row = db.prepare(`INSERT INTO pantry (label, base, qty, unit, urgent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .get(label, baseFor(db, label), input.qty ?? null, input.unit ?? null, input.urgent ? 1 : 0, now, now) as { id: number };
  touch(db);
  return listPantry(db).find(i => i.id === row.id)!;
}

export function updatePantryItem(db: Db, id: number, patch: Partial<Pick<PantryItem, 'qty' | 'unit' | 'urgent' | 'label'>>): void {
  const cur = db.prepare('SELECT * FROM pantry WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!cur) throw new Error('Introuvable');
  const label = patch.label?.trim() || (cur.label as string);
  db.prepare('UPDATE pantry SET label = ?, base = ?, qty = ?, unit = ?, urgent = ?, updated_at = ? WHERE id = ?').run(
    label,
    patch.label ? baseFor(db, label) : (cur.base as string),
    patch.qty !== undefined ? patch.qty : (cur.qty as number | null),
    patch.unit !== undefined ? patch.unit : (cur.unit as string | null),
    patch.urgent !== undefined ? (patch.urgent ? 1 : 0) : (cur.urgent as number),
    new Date().toISOString(),
    id,
  );
  touch(db);
}

export function deletePantryItem(db: Db, id: number): void {
  db.prepare('DELETE FROM pantry WHERE id = ?').run(id);
  touch(db);
}

export function setStaples(db: Db, staples: string[]): void {
  db.exec('BEGIN');
  db.exec('DELETE FROM staples');
  const ins = db.prepare('INSERT OR IGNORE INTO staples (base) VALUES (?)');
  for (const s of staples) if (s.trim()) ins.run(baseFor(db, s));
  db.exec('COMMIT');
  touch(db);
}

export function confirmPantry(db: Db): void {
  setMeta(db, 'pantry_confirmed_at', new Date().toISOString());
}

export function pantryState(db: Db) {
  const confirmedAt = getMeta(db, 'pantry_confirmed_at');
  return {
    confirmedAt,
    gateOpen: !!confirmedAt && Date.now() - Date.parse(confirmedAt) < CONFIRM_TTL_MS,
    version: Number(getMeta(db, 'pantry_version') ?? 0),
  };
}

/** Autocomplétion : ingrédients de base connus, les plus fréquents dans le catalogue d'abord. */
export function suggestIngredients(db: Db, query: string, limit = 8): string[] {
  const q = normalizeKey(query);
  if (!q) return [];
  const rows = db.prepare(`SELECT base, SUM(n) n FROM (
      SELECT base, COUNT(*) n FROM recipe_ingredients GROUP BY base
      UNION ALL SELECT DISTINCT base, 0 FROM ingredient_aliases WHERE base IS NOT NULL
    ) GROUP BY base`).all() as Array<{ base: string; n: number }>;
  return rows
    .map(r => ({ ...r, key: normalizeKey(r.base) }))
    .filter(r => r.key.includes(q))
    .sort((a, b) => Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) || b.n - a.n || a.base.localeCompare(b.base))
    .slice(0, limit)
    .map(r => r.base);
}
