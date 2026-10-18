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
  hasImage?: boolean;
  /** Texte des étapes, normalisé : sert à repérer un ingrédient rejeté que la liste d'ingrédients oublie. */
  stepsKey?: string;
};

/** ready : faisable ; almost : 1 à 3 manquants ; discover : plus de manquants, choisies d'après les goûts. */
export type Mode = 'ready' | 'almost' | 'discover';
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

// Mots trop courts ou ambigus dans une phrase de préparation (« au lieu de », « œuf à la coque », « beurrer le moule »,
// « à l'aide d'un couteau ») :
// on ne les cherche pas dans les étapes, seulement dans la liste d'ingrédients.
const STEP_STOPWORDS = new Set(['lieu', 'sole', 'loup', 'bar', 'coque', 'raie', 'bleu', 'mulet', 'perche', 'pied', 'chou', 'lard', 'vin', 'lait', 'moule', 'couteau', 'couteaux', 'plat', 'four', 'grille']);

/**
 * Marmiton oublie parfois un ingrédient dans la liste mais le cite dans les étapes (« 2 tranches de fromage de chèvre »).
 * On cherche donc aussi dans les étapes les ingrédients rejetés et les exclusions (allergies, régime, aversions).
 */
function mentionsRejected(e: Entry & { stepsKey: string }, ctx: Context): boolean {
  let words = stepWordsCache.get(ctx);
  if (!words) {
    const all = [...[...ctx.banned].map(normalizeKey), ...ctx.exclusionWords].filter(w => w.length >= 4 && !STEP_STOPWORDS.has(w));
    words = { single: all.filter(w => !w.includes(' ')), multi: all.filter(w => w.includes(' ')) };
    stepWordsCache.set(ctx, words);
  }
  // Un mot seul : recherche dans l'index des mots de la recette (au lieu de parcourir tout le texte pour chaque mot).
  const tokens = tokensOf(e);
  return words.single.some(w => tokens.has(w)) || words.multi.some(w => e.stepsKey.includes(` ${w} `));
}
const stepWordsCache = new WeakMap<Context, { single: string[]; multi: string[] }>();
const tokenCache = new WeakMap<Entry, Set<string>>();
const tokensOf = (e: Entry & { stepsKey: string }) => tokenCache.get(e) ?? tokenCache.set(e, new Set(e.stepsKey.split(' '))).get(e)!;
const ownedCache = new WeakMap<Context, Set<string>>();
const ownedOf = (ctx: Context) => ownedCache.get(ctx) ?? ownedCache.set(ctx, new Set(ctx.questionnaire.equipment)).get(ctx)!;

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

/** Vérifications rapides d'abord (elles écartent la plupart des recettes), recherches dans le texte en dernier. */
function isEligible(e: Entry, ctx: Context, mode: Mode, filters: Filters, missing: string[]): boolean {
  if (ctx.excluded.has(e.id)) return false;
  if (e.hasImage === false) return false; // les listes montrent des recettes avec photo
  if (filters.type && filters.type !== 'Tous' && e.type !== filters.type) return false;
  if (filters.maxTime && (e.totalMin === 0 || e.totalMin > filters.maxTime)) return false;
  if (mode === 'ready' ? missing.length !== 0 : mode === 'almost' ? missing.length < 1 || missing.length > MAX_MISSING : missing.length <= MAX_MISSING) return false;
  // Au moins un vrai ingrédient hors placard : sinon une recette dont rien n'est reconnu serait toujours « faisable ».
  if (!e.bases.some(b => !ctx.staples.has(b))) return false;
  if (e.bases.some(b => ctx.banned.has(b))) return false;
  const owned = ownedOf(ctx);
  if (e.utensils.some(u => OPTIONAL_EQUIPMENT.includes(u) && !owned.has(u))) return false;
  if (ctx.exclusionWords.length && keysOf(e).some(k => containsWord(k, ctx.exclusionWords))) return false;
  if (e.stepsKey && mentionsRejected(e as Entry & { stepsKey: string }, ctx)) return false;
  return true;
}

const DISH_LIMIT = { low: 1, medium: 2, high: 4 } as const;

/** Moyenne bayésienne : comme si chaque recette avait déjà 5 avis à 4,2/5. 5/5 avec 1 avis ≈ 4,33 ; 4,6/5 avec 120 avis ≈ 4,58. */
export function bayesianRating(rating: number, reviews: number): number {
  const PRIOR = 4.2, WEIGHT = 5;
  return (rating * reviews + PRIOR * WEIGHT) / (reviews + WEIGHT);
}

export function scoreEntry(e: Entry, ctx: Context, missing: string[], mode: Mode): Scored {
  let score = 0;
  const discover = mode === 'discover';
  const own = e.bases.filter(b => ctx.available.has(b) && !ctx.staples.has(b));

  // Utiliser son stock, en priorité ce qui doit être fini vite. (Découvrir : le stock ne compte pas, seulement les goûts.)
  if (!discover) score += Math.min(0.6, 0.12 * own.length);
  score += Math.min(1.2, 0.6 * own.filter(b => ctx.urgent.has(b)).length);

  // Recettes éprouvées ; malus léger sans note (Q34). Peu d'avis : la note est ramenée vers la moyenne.
  score += e.rating === null || e.reviews === 0 ? -0.15 : (bayesianRating(e.rating, e.reviews) - 4.2) * 0.4 + Math.min(0.15, Math.log10(1 + e.reviews) * 0.05);

  // Goûts : léger bonus vers les likes, pénalité vers les dislikes. Onglet Découvrir : ils pèsent plus, d'autant plus
  // qu'il y en a (un seul like ne doit pas tirer toute la liste vers lui ; le profil décide alors).
  const likeSim = ctx.liked.reduce((m, l) => Math.max(m, similarity(e, l, ctx.idf)), 0);
  const dislikeSim = ctx.disliked.reduce((m, d) => Math.max(m, similarity(e, d, ctx.idf)), 0);
  const trust = (n: number) => Math.min(1, n / 8);
  score += discover
    ? 1.2 * trust(ctx.liked.length) * likeSim - 0.9 * Math.max(0.5, trust(ctx.disliked.length)) * dislikeSim
    : 0.5 * likeSim - 0.7 * dislikeSim;

  // Préférences du questionnaire et réglages issus du profil.
  const maxTime = ctx.weights.maxTotalMin ?? ctx.questionnaire.maxTime;
  if (maxTime && e.totalMin > maxTime) score -= 0.5 * Math.min(1, (e.totalMin - maxTime) / maxTime);
  // La tolérance à la vaisselle du questionnaire prime sur le profil : c'est un choix explicite de la personne.
  const maxDishes = DISH_LIMIT[ctx.questionnaire.dishTolerance];
  if (e.dishes > maxDishes) score -= 0.2 * (e.dishes - maxDishes);
  score += (discover ? 2 : 1) * profileBonus(e, ctx.weights);

  // Onglet Presque : chaque manquant coûte, moins s'il est courant. Découvrir : une longue liste de courses coûte un peu.
  if (mode === 'almost') score -= missing.reduce((s, m) => s + (ctx.common.has(m) ? 0.2 : 0.45), 0);
  if (discover) score -= 0.02 * missing.length;

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
