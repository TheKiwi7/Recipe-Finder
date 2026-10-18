import { AIUnavailable, askAI, parseJsonReply, type Lane } from './ai.ts';
import { getMeta, loadAliases, setMeta, type Db } from './db.ts';
import { normalizeKey } from './catalog/text.ts';
import { OPTIONAL_EQUIPMENT } from './preferences.ts';

// Langue de l'app (français par défaut, anglais en option). Le catalogue reste en français : noms, termes
// et recettes sont traduits par l'IA à la demande, une seule fois, puis gardés dans la table `translations`.

export type Lang = 'fr' | 'en';
let current: Lang = 'fr';
export const lang = (): Lang => current;
/** Texte destiné à l'utilisateur, dans la langue de l'app. */
export const L = (fr: string, en: string): string => (current === 'en' ? en : fr);

// Appareils du questionnaire : traductions fixées (l'IA confond « Robot cuiseur » et « Robot / mixeur »).
const EQUIPMENT_EN: Record<string, string> = {
  Four: 'oven', 'Micro-ondes': 'microwave', 'Robot / mixeur': 'blender / food processor', 'Batteur électrique': 'electric mixer',
  'Robot cuiseur': 'multicooker (Thermomix…)', Airfryer: 'air fryer', 'Machine à pain': 'bread maker', Autocuiseur: 'pressure cooker',
  Friteuse: 'deep fryer', 'Cuit-vapeur': 'steamer', Crêpière: 'crêpe maker', Gaufrier: 'waffle iron', Wok: 'wok',
};

export function loadLang(db: Db): void {
  current = getMeta(db, 'lang') === 'en' ? 'en' : 'fr';
  const ins = db.prepare(`INSERT OR REPLACE INTO translations (kind, src, lang, text) VALUES ('term', ?, 'en', ?)`);
  for (const [fr, en] of Object.entries(EQUIPMENT_EN)) ins.run(fr, en);
  // Traductions rangées par erreur sous « fr » (langue changée pendant un appel à l'IA, avant correction).
  db.exec(`DELETE FROM translations WHERE lang = 'fr'`);
}

export function setLang(db: Db, l: Lang): void {
  current = l === 'en' ? 'en' : 'fr';
  setMeta(db, 'lang', current);
}

/** Consigne ajoutée aux demandes dont la réponse est lue par l'utilisateur. */
export const replyLanguage = () => L('Réponds en français.', 'Réponds en anglais (English), même si le contexte est en français.');

// ---------- cache ----------

type Kind = 'term' | 'name' | 'recipe';

function cached(db: Db, kind: Kind, srcs: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const get = db.prepare('SELECT text FROM translations WHERE kind = ? AND src = ? AND lang = ?');
  for (const s of new Set(srcs)) {
    const row = get.get(kind, s, current) as { text: string } | undefined;
    if (row) out.set(s, row.text);
  }
  return out;
}

/** Le catalogue est en français : on ne traduit que vers l'anglais. Une langue changée pendant l'appel à l'IA ne change rien. */
const TARGET = 'en';

function store(db: Db, kind: Kind, pairs: Iterable<[string, string]>): void {
  const ins = db.prepare('INSERT OR REPLACE INTO translations (kind, src, lang, text) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const [src, text] of pairs) ins.run(kind, src, TARGET, text);
  db.exec('COMMIT');
}

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

// ---------- termes (ingrédients, ustensiles, appareils) et noms de recettes ----------

const TERM_SYSTEM = `You translate French cooking vocabulary (ingredients, food families, utensils, kitchen appliances, dish keywords) into the English words a home cook would use.
Short, lower case (except proper nouns), singular when the French is singular. Keep words that are already English or untranslatable (« gruyère », « crème fraîche »).
Reply only with a JSON object {"french term": "english term"} with exactly the received terms as keys.`;

const NAME_SYSTEM = `You translate French recipe titles into natural English recipe titles, in sentence case.
Keep classic dish names that English cooks use as is (ratatouille, quiche lorraine, crème brûlée, bœuf bourguignon) and proper names.
Reply only with a JSON object {"id": "English title"} with exactly the received ids as keys.`;

/** Traduit les termes demandés (ceux déjà traduits viennent du cache). Sans IA disponible : seulement le cache. */
export async function translateTerms(db: Db, terms: string[], lane: Lane): Promise<Map<string, string>> {
  if (current === 'fr') return new Map(terms.map(t => [t, t]));
  const known = cached(db, 'term', terms);
  const missing = [...new Set(terms)].filter(t => t.trim() && !known.has(t));
  for (const batch of chunks(missing, 150)) {
    const reply = parseJsonReply<Record<string, unknown>>(await askAI(JSON.stringify(batch), { tier: 'light', lane, system: TERM_SYSTEM, json: true, timeoutMs: 240_000 }));
    store(db, 'term', batch.filter(t => clean(reply[t])).map(t => [t, clean(reply[t])]));
  }
  return cached(db, 'term', terms);
}

export async function translateNames(db: Db, ids: number[], lane: Lane): Promise<Map<string, string>> {
  const keys = [...new Set(ids)].map(String);
  if (current === 'fr') return new Map();
  const known = cached(db, 'name', keys);
  const get = db.prepare('SELECT name FROM recipes WHERE id = ?');
  const missing = keys.filter(k => !known.has(k)).map(k => [k, (get.get(Number(k)) as { name: string } | undefined)?.name] as const).filter(([, n]) => n);
  for (const batch of chunks(missing, 100)) {
    const reply = parseJsonReply<Record<string, unknown>>(await askAI(JSON.stringify(Object.fromEntries(batch)), { tier: 'light', lane, system: NAME_SYSTEM, json: true, timeoutMs: 240_000 }));
    store(db, 'name', batch.filter(([k]) => clean(reply[k])).map(([k]) => [k, clean(reply[k])]));
  }
  return cached(db, 'name', keys);
}

// ---------- demandes de l'interface : réponse immédiate, traduction en arrière-plan ----------
// L'interface ne garde jamais une connexion ouverte pendant un appel à l'IA (plusieurs secondes) : elle reçoit
// ce qui est déjà traduit, et revient demander le reste tant que `pending` est vrai.

const working: Record<'term' | 'name', Set<string>> = { term: new Set(), name: new Set() };

export function requestTranslations(db: Db, kind: 'term' | 'name', keys: string[]): { done: Record<string, string>; pending: boolean } {
  if (current === 'fr') return { done: {}, pending: false };
  const done = cached(db, kind, keys);
  const missing = [...new Set(keys)].filter(k => k.trim() && !done.has(k));
  const fresh = missing.filter(k => !working[kind].has(k));
  if (fresh.length) {
    fresh.forEach(k => working[kind].add(k));
    (kind === 'name' ? translateNames(db, fresh.map(Number), 'interactive') : translateTerms(db, fresh, 'interactive'))
      .catch(e => console.error(`[traduction] ${kind} : ${(e as Error).message}`))
      .finally(() => fresh.forEach(k => working[kind].delete(k)));
  }
  return { done: Object.fromEntries(done), pending: missing.some(k => working[kind].has(k)) };
}

// ---------- recette complète ----------

export type RecipeTranslation = { name: string; ingredients: string[]; steps: string[] };

const RECIPE_SYSTEM = `You translate a French recipe into English for a home cook: faithful, natural, concise.
- Ingredient lines: keep the leading quantity exactly as written (same digits or fraction, at the very start of the line). Translate the units into the usual English abbreviations: « c. à soupe » / « cuillère à soupe » → tbsp, « c. à café » → tsp, « gousse » → clove, « pincée » → pinch, « sachet » → packet, « botte » → bunch, « tranche » → slice, « noix de beurre » → knob of butter, « verre » → glass, « boîte » → can, « pot » → pot. Keep metric units (g, kg, ml, cl, l).
- Steps: translate every step, in the same order.
Reply only with JSON {"name": "...", "ingredients": ["..."], "steps": ["..."]}, with exactly as many ingredients and steps as received.`;

const inflight = new Map<number, Promise<RecipeTranslation | null>>();

const failed = new Map<number, string>();

/** Nom, lignes d'ingrédients et étapes en anglais ; null si la recette n'existe pas. Une seule traduction par recette. */
export function translateRecipe(db: Db, id: number): Promise<RecipeTranslation | null> {
  const hit = cached(db, 'recipe', [String(id)]).get(String(id));
  if (hit) return Promise.resolve(JSON.parse(hit) as RecipeTranslation);
  if (!inflight.has(id)) inflight.set(id, doTranslateRecipe(db, id).finally(() => inflight.delete(id)));
  return inflight.get(id)!;
}

/**
 * Pour l'interface : la traduction si elle est prête, sinon `pending` (et elle est lancée en arrière-plan),
 * ou l'erreur de la dernière tentative (une fois ; la demande suivante relance la traduction).
 */
export function recipeTranslationStatus(db: Db, id: number): { translation?: RecipeTranslation; pending?: boolean; error?: string } {
  const hit = cached(db, 'recipe', [String(id)]).get(String(id));
  if (hit) return { translation: JSON.parse(hit) as RecipeTranslation };
  if (inflight.has(id)) return { pending: true };
  const error = failed.get(id);
  if (error !== undefined) { failed.delete(id); return { error }; }
  translateRecipe(db, id)
    .then(t => { if (!t) failed.set(id, L('Recette introuvable', 'Recipe not found')); })
    .catch(e => failed.set(id, (e as Error).message.slice(0, 200)));
  return { pending: true };
}

async function doTranslateRecipe(db: Db, id: number): Promise<RecipeTranslation | null> {
  const row = db.prepare('SELECT name, ingredients, steps FROM recipes WHERE id = ?').get(id) as { name: string; ingredients: string; steps: string } | undefined;
  if (!row) return null;
  const src = { name: row.name, ingredients: (JSON.parse(row.ingredients) as Array<{ raw: string }>).map(l => l.raw), steps: JSON.parse(row.steps) as string[] };
  const reply = parseJsonReply<RecipeTranslation>(await askAI(JSON.stringify(src), { tier: 'light', lane: 'interactive', system: RECIPE_SYSTEM, json: true, timeoutMs: 300_000 }));
  const ok = typeof reply.name === 'string' && Array.isArray(reply.ingredients) && Array.isArray(reply.steps)
    && reply.ingredients.length === src.ingredients.length && reply.steps.length > 0;
  if (!ok) throw new AIUnavailable('Traduction incomplète, réessaie');
  const t: RecipeTranslation = { name: clean(reply.name), ingredients: reply.ingredients.map(clean), steps: reply.steps.map(clean).filter(Boolean) };
  store(db, 'recipe', [[String(id), JSON.stringify(t)]]);
  store(db, 'name', [[String(id), t.name]]);
  return t;
}

// ---------- saisie en anglais → vocabulaire français du catalogue ----------

const TO_FR_SYSTEM = `Tu traduis un terme de cuisine anglais (ingrédient, famille d'aliments, allergie) en français, tel qu'il apparaît dans des recettes françaises : court, en minuscules, au singulier sauf usage (« pâtes »). Un terme déjà en français reste tel quel.
Réponds uniquement par {"fr": "terme"}.`;

/**
 * Ce que tape l'utilisateur en anglais (« garlic », « peanuts ») → terme français que comprennent le catalogue
 * et les exclusions (« ail », « arachide »). En français, ou si l'IA ne répond pas : la saisie telle quelle.
 */
export async function toFrench(db: Db, input: string): Promise<string> {
  const text = input.trim();
  if (current === 'fr' || !text) return text;
  const key = normalizeKey(text);
  const rows = db.prepare(`SELECT src, text FROM translations WHERE kind = 'term' AND lang = ?`).all(current) as Array<{ src: string; text: string }>;
  const hit = rows.find(r => normalizeKey(r.text) === key);
  if (hit) return hit.src;
  if (rows.some(r => normalizeKey(r.src) === key) || loadAliases(db).has(key)) return text; // déjà un terme français
  try {
    const fr = clean(parseJsonReply<{ fr?: unknown }>(await askAI(text, { tier: 'light', lane: 'interactive', system: TO_FR_SYSTEM, json: true, timeoutMs: 90_000 })).fr).toLowerCase();
    if (!fr) return text;
    db.prepare(`INSERT OR IGNORE INTO translations (kind, src, lang, text) VALUES ('term', ?, ?, ?)`).run(fr, TARGET, text.toLowerCase());
    return fr;
  } catch {
    return text;
  }
}

/** Autocomplétion en anglais : ingrédients de base dont la traduction contient la saisie. */
export function suggestTranslated(db: Db, query: string, limit = 8): string[] {
  const q = normalizeKey(query);
  if (!q) return [];
  const rows = db.prepare(`SELECT t.text, COUNT(ri.recipe_id) n FROM translations t
      JOIN (SELECT DISTINCT base FROM ingredient_aliases WHERE base IS NOT NULL) a ON a.base = t.src
      LEFT JOIN recipe_ingredients ri ON ri.base = t.src
      WHERE t.kind = 'term' AND t.lang = ? GROUP BY t.src`).all(current) as Array<{ text: string; n: number }>;
  return rows
    .map(r => ({ ...r, key: normalizeKey(r.text) }))
    .filter(r => r.key.includes(q))
    .sort((a, b) => Number(b.key.startsWith(q)) - Number(a.key.startsWith(q)) || b.n - a.n || a.text.localeCompare(b.text))
    .map(r => r.text)
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, limit);
}

// ---------- traduction d'avance, en tâche de fond ----------

/**
 * En anglais : traduit d'avance le vocabulaire (ingrédients, ustensiles, appareils) puis les noms de recettes,
 * les mieux notées d'abord, pour que les listes s'affichent directement traduites. S'arrête si l'IA est indisponible.
 */
export async function prefillTranslations(db: Db, log: (m: string) => void, stop: () => boolean): Promise<void> {
  if (current === 'fr') return;
  const bases = (db.prepare('SELECT base FROM recipe_ingredients GROUP BY base ORDER BY COUNT(*) DESC').all() as Array<{ base: string }>).map(r => r.base);
  const utensils = new Set<string>();
  for (const r of db.prepare('SELECT utensils FROM recipes').all() as Array<{ utensils: string }>) for (const u of JSON.parse(r.utensils) as string[]) utensils.add(u);
  const extra = (db.prepare('SELECT base FROM staples UNION SELECT base FROM pantry UNION SELECT base FROM banned_ingredients').all() as Array<{ base: string }>).map(r => r.base);
  const terms = [...new Set([...extra, ...OPTIONAL_EQUIPMENT, ...utensils, ...bases])];
  const todoTerms = terms.filter(t => !cached(db, 'term', [t]).size);
  for (const batch of chunks(todoTerms, 150)) {
    if (stop()) return;
    await translateTerms(db, batch, 'background');
  }
  if (todoTerms.length) log(`${todoTerms.length} termes traduits`);

  const ids = (db.prepare(`SELECT r.id FROM recipes r LEFT JOIN translations t ON t.kind = 'name' AND t.src = CAST(r.id AS TEXT) AND t.lang = ?
      WHERE t.src IS NULL ORDER BY r.reviews DESC`).all(current) as Array<{ id: number }>).map(r => r.id);
  for (const batch of chunks(ids, 100)) {
    if (stop()) return;
    await translateNames(db, batch, 'background');
  }
  if (ids.length) log(`${ids.length} noms de recettes traduits`);
}
