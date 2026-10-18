// Classement local des recettes (Q18) : aucune dépendance à la base ni à Claude, donc testable tel quel.
import { normalizeKey } from '../catalog/text.ts';
import type { ProfileWeights, Questionnaire } from '../preferences.ts';
import { containsWord, OPTIONAL_EQUIPMENT } from '../preferences.ts';

export type Entry = {
  id: number;
  name: string;
  type: string;
  totalMin: number;
  dishes: number;
  rating: number | null;
  reviews: number;
  bases: string[];
  keywords: string[];
  utensils: string[];
};

export type Mode = 'ready' | 'almost';
export type Filters = { type?: string; maxTime?: number };

export type Context = {
  available: Set<string>;   // stock + placard
  urgent: Set<string>;      // « à finir vite »
  staples: Set<string>;
  banned: Set<string>;      // ingrédients rejetés (nom exact)
  exclusionWords: string[]; // allergies (et leur famille) + régime : exclusion dès que le mot apparaît dans un ingrédient
  liked: Entry[];
  disliked: Entry[];
  excluded: Set<number>;    // recettes likées (déjà en favoris), rejetées, vues récemment
  questionnaire: Questionnaire;
  weights: ProfileWeights;
  idf: Map<string, number>;
  common: Set<string>;      // ingrédients courants, faciles à acheter
};

export type Scored = { entry: Entry; missing: string[]; score: number; likeSim: number; dislikeSim: number };

export const MAX_MISSING = 3;

const keyCache = new WeakMap<Entry, string[]>();
const keysOf = (e: Entry) => keyCache.get(e) ?? keyCache.set(e, e.bases.map(normalizeKey)).get(e)!;
const EXPLORATION = 0.3;

export function missingFor(e: Entry, available: Set<string>): string[] {
  return e.bases.filter(b => !available.has(b));
}

/** Similarité entre recettes : Jaccard pondéré par la rareté des ingrédients (sel et beurre comptent peu) + même type. */
export function similarity(a: Entry, b: Entry, idf: Map<string, number>): number {
  const A = new Set(a.bases), B = new Set(b.bases);
  let inter = 0, union = 0;
  for (const x of new Set([...A, ...B])) {
    const w = idf.get(x) ?? 1;
    union += w;
    if (A.has(x) && B.has(x)) inter += w;
  }
  return 0.8 * (union ? inter / union : 0) + 0.2 * (a.type === b.type ? 1 : 0);
}

function isEligible(e: Entry, ctx: Context, mode: Mode, filters: Filters, missing: string[]): boolean {
  if (ctx.excluded.has(e.id)) return false;
  if (e.bases.some(b => ctx.banned.has(b))) return false;
  if (ctx.exclusionWords.length && keysOf(e).some(k => containsWord(k, ctx.exclusionWords))) return false;
  const owned = new Set(ctx.questionnaire.equipment);
  if (e.utensils.some(u => OPTIONAL_EQUIPMENT.includes(u) && !owned.has(u))) return false;
  if (filters.type && filters.type !== 'Tous' && e.type !== filters.type) return false;
  if (filters.maxTime && (e.totalMin === 0 || e.totalMin > filters.maxTime)) return false;
  return mode === 'ready' ? missing.length === 0 : missing.length >= 1 && missing.length <= MAX_MISSING;
}

const DISH_LIMIT = { low: 1, medium: 2, high: 4 } as const;

export function scoreEntry(e: Entry, ctx: Context, missing: string[], mode: Mode): Scored {
  let score = 0;
  const own = e.bases.filter(b => ctx.available.has(b) && !ctx.staples.has(b));

  // Utiliser son stock, en priorité ce qui doit être fini vite.
  score += Math.min(0.6, 0.12 * own.length);
  score += Math.min(1.2, 0.6 * own.filter(b => ctx.urgent.has(b)).length);

  // Recettes éprouvées ; malus léger sans note (Q34).
  score += e.rating === null || e.reviews === 0 ? -0.15 : (e.rating - 4.2) * 0.4 + Math.min(0.15, Math.log10(1 + e.reviews) * 0.05);

  // Goûts : léger bonus vers les likes, pénalité vers les dislikes.
  const likeSim = ctx.liked.reduce((m, l) => Math.max(m, similarity(e, l, ctx.idf)), 0);
  const dislikeSim = ctx.disliked.reduce((m, d) => Math.max(m, similarity(e, d, ctx.idf)), 0);
  score += 0.5 * likeSim - 0.7 * dislikeSim;

  // Préférences du questionnaire et réglages issus du profil.
  const maxTime = ctx.weights.maxTotalMin ?? ctx.questionnaire.maxTime;
  if (maxTime && e.totalMin > maxTime) score -= 0.5 * Math.min(1, (e.totalMin - maxTime) / maxTime);
  const maxDishes = ctx.weights.maxDishes ?? DISH_LIMIT[ctx.questionnaire.dishTolerance];
  if (e.dishes > maxDishes) score -= 0.2 * (e.dishes - maxDishes);
  score += profileBonus(e, ctx.weights);

  // Onglet Presque : chaque manquant coûte, moins s'il est courant.
  if (mode === 'almost') score -= missing.reduce((s, m) => s + (ctx.common.has(m) ? 0.2 : 0.45), 0);

  return { entry: e, missing, score, likeSim, dislikeSim };
}

function profileBonus(e: Entry, w: ProfileWeights): number {
  let bonus = 0;
  for (const b of e.bases) bonus += w.ingredients?.[b] ?? 0;
  if (w.keywords) {
    const text = ` ${normalizeKey([e.name, ...e.keywords].join(' '))} `;
    for (const [k, v] of Object.entries(w.keywords)) if (text.includes(` ${normalizeKey(k)} `)) bonus += v;
  }
  bonus += w.types?.[e.type] ?? 0;
  return Math.max(-1, Math.min(1, bonus * 0.5));
}

export function rankCandidates(entries: Entry[], ctx: Context, mode: Mode, filters: Filters): Scored[] {
  const out: Scored[] = [];
  for (const e of entries) {
    const missing = missingFor(e, ctx.available);
    if (isEligible(e, ctx, mode, filters, missing)) out.push(scoreEntry(e, ctx, missing, mode));
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Choisit `count` recettes : ~70 % parmi les mieux classées (avec un peu de hasard pour varier d'un lancement à l'autre),
 * ~30 % d'exploration parmi des recettes éloignées des likes, intercalées dans la liste.
 */
export function pickBatch(ranked: Scored[], count: number, rand: () => number = Math.random): Scored[] {
  if (ranked.length <= count) return ranked;
  const jittered = ranked.map(s => ({ s, k: s.score + (rand() - 0.5) * 0.3 })).sort((a, b) => b.k - a.k).map(x => x.s);
  const nExplore = Math.round(count * EXPLORATION);
  const exploit = jittered.slice(0, count - nExplore);
  const taken = new Set(exploit.map(s => s.entry.id));
  const pool = jittered.filter(s => !taken.has(s.entry.id) && s.likeSim < 0.3 && s.dislikeSim < 0.4);
  const explore: Scored[] = [];
  while (explore.length < nExplore && pool.length) explore.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  for (const s of jittered) { // pas assez de recettes « éloignées » : on complète avec les suivantes
    if (exploit.length + explore.length >= count) break;
    if (!taken.has(s.entry.id) && !explore.includes(s)) { exploit.push(s); taken.add(s.entry.id); }
  }
  const out = [...exploit];
  explore.forEach((s, i) => out.splice(Math.min(out.length, 2 + i * 3), 0, s)); // positions 3, 6, 9…
  return out;
}
