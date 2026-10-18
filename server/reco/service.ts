import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, type Db } from '../db.ts';
import type { IngredientLine } from '../catalog/ingredients.ts';
import { containsWord, DEFAULT_QUESTIONNAIRE, getQuestionnaire, getWeights, recordSignal } from '../preferences.ts';
import { mealContext } from '../members.ts';
import { normalizeKey } from '../catalog/text.ts';
import { withGenerics } from './generic.ts';
import { pickBatch, rankCandidates, type Context, type Entry, type Filters, type Mode } from './rank.ts';

export const IMAGES_DIR = join(DATA_DIR, 'images');
const COOLDOWN_MS = 14 * 24 * 3600 * 1000;
/** Une recette vue il y a moins de 6 h (même session) peut réapparaître, par ex. en revenant sur un filtre. */
const SAME_SESSION_MS = 6 * 3600 * 1000;

export type RecipeCard = {
  id: number; name: string; image: string | null; type: string; totalMin: number; dishes: number;
  rating: number | null; reviews: number; missing: string[]; usesUrgent: boolean; reaction: 'like' | 'dislike' | null;
};

export type RecipeDetail = RecipeCard & {
  url: string; prepMin: number; cookMin: number; servings: number; persons: number;
  ingredients: IngredientLine[]; steps: string[]; utensils: string[]; banned: string[]; available: string[]; archived: boolean;
};

// ---------- catalogue en mémoire ----------

type Catalog = { key: string; at: number; entries: Entry[]; byId: Map<number, Entry & { image: string | null }>; idf: Map<string, number>; common: Set<string> };
let cache: Catalog | null = null;
/**
 * Pendant un import, le catalogue change toutes les quelques secondes : on ne le relit (≈ 250 ms) qu'au plus
 * toutes les 2 min. Les nouvelles recettes apparaissent donc avec un peu de retard, sans ralentir chaque liste.
 */
const CATALOG_REFRESH_MS = 2 * 60_000;

export function loadCatalog(db: Db, force = false): Catalog {
  if (cache && !force && Date.now() - cache.at < CATALOG_REFRESH_MS) return cache;
  const k = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(unresolved), 0) u, (SELECT COUNT(*) FROM recipe_ingredients) ri FROM recipes').get() as Record<string, number>;
  const key = `${k.n}:${k.u}:${k.ri}`;
  if (cache?.key === key) { cache.at = Date.now(); return cache; }

  const rows = db.prepare(`SELECT id, name, image, type, total_min, dishes, rating, reviews, keywords, utensils, steps, ingredients FROM recipes WHERE unresolved = 0`).all() as Array<Record<string, any>>;
  const bases = new Map<number, string[]>();
  for (const r of db.prepare('SELECT recipe_id, base FROM recipe_ingredients').all() as Array<{ recipe_id: number; base: string }>) {
    (bases.get(r.recipe_id) ?? bases.set(r.recipe_id, []).get(r.recipe_id)!).push(r.base);
  }
  const entries = rows.map(r => ({
    id: r.id, name: r.name, image: r.image, type: r.type, totalMin: r.total_min, dishes: r.dishes, rating: r.rating, reviews: r.reviews,
    bases: bases.get(r.id) ?? [], keywords: JSON.parse(r.keywords), utensils: JSON.parse(r.utensils), hasImage: !!r.image,
    // Texte des lignes d'ingrédients + étapes : rattrape ce que la base d'ingrédient ou la liste oublie.
    stepsKey: ` ${normalizeKey([...(JSON.parse(r.ingredients) as Array<{ raw: string }>).map(l => l.raw), ...(JSON.parse(r.steps) as string[])].join(' '))} `,
  }));
  const df = new Map<string, number>();
  for (const e of entries) for (const b of e.bases) df.set(b, (df.get(b) ?? 0) + 1);
  const n = Math.max(1, entries.length);
  const idf = new Map([...df].map(([b, c]) => [b, Math.log(1 + n / c)]));
  const common = new Set([...df].filter(([, c]) => c / n >= 0.03 && c >= 3).map(([b]) => b));
  cache = { key, at: Date.now(), entries, byId: new Map(entries.map(e => [e.id, e])), idf, common };
  return cache;
}

// ---------- contexte de l'utilisateur ----------

const ids = (db: Db, sql: string, ...p: string[]) => new Set((db.prepare(sql).all(...p) as Array<{ id: number }>).map(r => r.id));

/** Ingrédients rejetés un par un (nom exact). Allergies et régime passent par exclusionWords. */
export function bannedBases(db: Db): Set<string> {
  return new Set((db.prepare('SELECT base FROM banned_ingredients').all() as Array<{ base: string }>).map(r => r.base));
}

export function availableBases(db: Db) {
  const pantry = db.prepare('SELECT base, urgent FROM pantry').all() as Array<{ base: string; urgent: number }>;
  const staples = new Set((db.prepare('SELECT base FROM staples').all() as Array<{ base: string }>).map(r => r.base));
  return { available: withGenerics(new Set([...pantry.map(p => p.base), ...staples])), urgent: new Set(pantry.filter(p => p.urgent).map(p => p.base)), staples };
}

function buildContext(db: Db, catalog: Catalog, mode: Mode): Context {
  const meal = mealContext(db);
  const liked = ids(db, `SELECT recipe_id id FROM reactions WHERE kind = 'like'`);
  const disliked = ids(db, `SELECT recipe_id id FROM reactions WHERE kind = 'dislike'`);
  const seen = ids(db, 'SELECT recipe_id id FROM seen WHERE mode = ? AND at > ? AND at < ?', mode,
    new Date(Date.now() - COOLDOWN_MS).toISOString(), new Date(Date.now() - SAME_SESSION_MS).toISOString());
  const pick = (s: Set<number>) => [...s].map(id => catalog.byId.get(id)).filter((e): e is Entry & { image: string | null } => !!e);
  return {
    ...availableBases(db),
    // Selon qui mange (filtre « Pour : … ») : mes rejets et mon profil ne comptent que si je mange.
    banned: meal.selfEats ? bannedBases(db) : new Set<string>(),
    exclusionWords: meal.exclusionWords,
    liked: pick(liked),
    disliked: pick(disliked),
    excluded: new Set([...liked, ...disliked, ...seen]),
    questionnaire: getQuestionnaire(db) ?? DEFAULT_QUESTIONNAIRE,
    weights: meal.selfEats ? getWeights(db) : {},
    idf: catalog.idf,
    common: catalog.common,
  };
}

function reactionOf(db: Db, id: number): 'like' | 'dislike' | null {
  return (db.prepare('SELECT kind FROM reactions WHERE recipe_id = ?').get(id) as { kind: 'like' | 'dislike' } | undefined)?.kind ?? null;
}

function toCard(db: Db, e: Entry & { image: string | null }, missing: string[], urgent: Set<string>): RecipeCard {
  return {
    id: e.id, name: e.name, image: e.image, type: e.type, totalMin: e.totalMin, dishes: e.dishes, rating: e.rating, reviews: e.reviews,
    missing, usesUrgent: e.bases.some(b => urgent.has(b)), reaction: reactionOf(db, e.id),
  };
}

/**
 * Liste de l'onglet Recettes / Presque. `current` = recettes déjà affichées : celles encore valides gardent leur place,
 * puis on complète jusqu'à `want` (Q3 « Charger plus », Q23 changement de stock).
 */
export function recommend(db: Db, req: { mode: Mode; filters: Filters; current: number[]; want: number }) {
  const catalog = loadCatalog(db);
  const ctx = buildContext(db, catalog, req.mode);
  const dislikedOnly = { ...ctx, excluded: new Set(ctx.disliked.map(d => d.id)) };

  const kept = req.current
    .map(id => catalog.byId.get(id))
    .filter((e): e is Entry & { image: string | null } => !!e)
    .map(e => rankCandidates([e], dislikedOnly, req.mode, req.filters)[0])
    .filter(Boolean);

  const exclude = new Set([...ctx.excluded, ...req.current]);
  const ranked = rankCandidates(catalog.entries, { ...ctx, excluded: exclude }, req.mode, req.filters);
  const need = Math.max(0, req.want - kept.length);
  const added = pickBatch(ranked, need);

  const mark = db.prepare(`INSERT INTO seen (recipe_id, mode, at) VALUES (?, ?, ?) ON CONFLICT(recipe_id, mode) DO UPDATE SET at = excluded.at`);
  const now = new Date().toISOString();
  for (const s of added) mark.run(s.entry.id, req.mode, now);

  return {
    items: [...kept, ...added].map(s => toCard(db, s.entry as Entry & { image: string | null }, s.missing, ctx.urgent)),
    exhausted: ranked.length <= need,
    catalogSize: catalog.entries.length,
  };
}

// ---------- détail ----------

export function recipeDetail(db: Db, id: number): RecipeDetail | null {
  const fav = db.prepare('SELECT snapshot, image_file FROM favorites WHERE recipe_id = ?').get(id) as { snapshot: string; image_file: string | null } | undefined;
  const row = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Record<string, any> | undefined;
  const { available, urgent } = availableBases(db);
  const meal = mealContext(db);
  const words = meal.exclusionWords;
  const userBanned = meal.selfEats ? bannedBases(db) : new Set<string>();
  const persons = meal.persons;
  const localImage = fav?.image_file ? `/api/images/${fav.image_file}` : null;

  if (!row) {
    if (!fav) return null;
    const snap = JSON.parse(fav.snapshot) as RecipeDetail; // la page a disparu : on sert la copie locale
    const banned = bannedIn(snap.ingredients, userBanned, words);
    return { ...snap, image: localImage ?? snap.image, reaction: 'like', persons, banned, available: [...available], archived: true,
      missing: snap.ingredients.map(l => l.base).filter((b): b is string => !!b && !available.has(b)) };
  }
  const ingredients = JSON.parse(row.ingredients) as IngredientLine[];
  const banned = bannedIn(ingredients, userBanned, words);
  const bases = [...new Set(ingredients.map(l => l.base).filter((b): b is string => !!b))];
  return {
    id: row.id, name: row.name, image: localImage ?? row.image, type: row.type, totalMin: row.total_min, dishes: row.dishes,
    rating: row.rating, reviews: row.reviews, missing: bases.filter(b => !available.has(b)), usesUrgent: bases.some(b => urgent.has(b)),
    reaction: reactionOf(db, id), url: row.url, prepMin: row.prep_min, cookMin: row.cook_min, servings: row.servings, persons,
    ingredients, steps: JSON.parse(row.steps), utensils: JSON.parse(row.utensils), banned, available: [...available], archived: false,
  };
}

/** Ingrédients de la recette exclus pour la personne : rejetés, ou couverts par une allergie / le régime. */
function bannedIn(lines: IngredientLine[], userBanned: Set<string>, words: string[]): string[] {
  const bases = new Set(lines.map(l => l.base).filter((b): b is string => !!b));
  return [...bases].filter(b => userBanned.has(b) || containsWord(normalizeKey(b), words));
}

// ---------- réactions, favoris, rejets ----------

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** Copie locale de la photo d'un favori. L'adresse vient de la page de la recette : HTTPS et vraie image seulement. */
async function downloadImage(url: string, id: number): Promise<string | null> {
  try {
    if (new URL(url).protocol !== 'https:') return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) return null;
    const ext = (res.headers.get('content-type') ?? '').includes('png') ? 'png' : url.match(/\.(webp|jpe?g|png)(\?|$)/i)?.[1] ?? 'webp';
    mkdirSync(IMAGES_DIR, { recursive: true });
    const file = `${id}.${ext}`;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_IMAGE_BYTES) return null;
    writeFileSync(join(IMAGES_DIR, file), data);
    return file;
  } catch {
    return null;
  }
}

export async function setReaction(db: Db, id: number, kind: 'like' | 'dislike' | null): Promise<void> {
  const detail = recipeDetail(db, id);
  if (!detail) throw new Error('Recette introuvable');
  const previous = detail.reaction;
  const now = new Date().toISOString();
  if (kind) db.prepare('INSERT INTO reactions (recipe_id, kind, at) VALUES (?, ?, ?) ON CONFLICT(recipe_id) DO UPDATE SET kind = excluded.kind, at = excluded.at').run(id, kind, now);
  else db.prepare('DELETE FROM reactions WHERE recipe_id = ?').run(id);

  if (kind === 'like' && previous !== 'like') {
    const snapshot = { ...detail, reaction: 'like' };
    db.prepare('INSERT OR REPLACE INTO favorites (recipe_id, snapshot, image_file, at) VALUES (?, ?, NULL, ?)').run(id, JSON.stringify(snapshot), now);
    if (detail.image) void downloadImage(detail.image, id).then(f => f && db.prepare('UPDATE favorites SET image_file = ? WHERE recipe_id = ?').run(f, id));
  }
  if (kind !== 'like') db.prepare('DELETE FROM favorites WHERE recipe_id = ?').run(id); // retirer un favori est neutre (Q29)

  const main = detail.ingredients.map(l => l.base).filter(Boolean).slice(0, 8).join(', ');
  if (kind && kind !== previous) recordSignal(db, kind, `${detail.name} [${detail.type}, ${detail.totalMin} min, ${detail.dishes} pièce(s) à laver] — ${main}`);
}

export function favorites(db: Db): RecipeCard[] {
  const rows = db.prepare('SELECT recipe_id, snapshot, image_file FROM favorites ORDER BY at DESC').all() as Array<{ recipe_id: number; snapshot: string; image_file: string | null }>;
  const { available, urgent } = availableBases(db);
  return rows.map(r => {
    const s = JSON.parse(r.snapshot) as RecipeDetail;
    const bases = [...new Set(s.ingredients.map(l => l.base).filter((b): b is string => !!b))];
    return {
      id: s.id, name: s.name, image: r.image_file ? `/api/images/${r.image_file}` : s.image, type: s.type, totalMin: s.totalMin, dishes: s.dishes,
      rating: s.rating, reviews: s.reviews, missing: bases.filter(b => !available.has(b)), usesUrgent: bases.some(b => urgent.has(b)), reaction: 'like',
    };
  });
}

export function banIngredient(db: Db, base: string, banned: boolean): void {
  if (banned) {
    db.prepare('INSERT OR IGNORE INTO banned_ingredients (base, at) VALUES (?, ?)').run(base, new Date().toISOString());
    recordSignal(db, 'ban_ingredient', base);
  } else {
    db.prepare('DELETE FROM banned_ingredients WHERE base = ?').run(base);
    recordSignal(db, 'unban_ingredient', base);
  }
}

export function rejections(db: Db) {
  const recipes = db.prepare(`SELECT r.recipe_id id, COALESCE(c.name, '(recette retirée du catalogue)') name, c.image image, r.at
    FROM reactions r LEFT JOIN recipes c ON c.id = r.recipe_id WHERE r.kind = 'dislike' ORDER BY r.at DESC`).all();
  const ingredients = db.prepare('SELECT base, at FROM banned_ingredients ORDER BY at DESC').all();
  return { recipes, ingredients };
}

export function imagePath(file: string): string | null {
  if (!/^\d+\.(webp|jpe?g|png)$/i.test(file)) return null;
  const p = join(IMAGES_DIR, file);
  return existsSync(p) ? p : null;
}
