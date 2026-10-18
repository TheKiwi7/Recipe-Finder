import { parseIngredientLine, type IngredientLine } from './ingredients.ts';
import { canonicalUtensils, countDishes, deduceUtensils, withNameDevices } from './utensils.ts';

export const RECIPE_TYPES = ['Plat', 'Entrée', 'Dessert', 'Apéro', 'Petit-déj.', 'Autre'] as const;
export type RecipeType = (typeof RECIPE_TYPES)[number];

export type ParsedRecipe = {
  source: string;
  url: string;
  name: string;
  image: string | null;
  categoryRaw: string | null;
  type: RecipeType;
  totalMin: number;
  prepMin: number;
  cookMin: number;
  servings: number;
  rating: number | null;
  reviews: number;
  keywords: string[];
  ingredients: Omit<IngredientLine, 'base'>[];
  steps: string[];
  utensils: string[];
  utensilsFromSite: boolean;
  dishes: number;
};

type JsonLd = Record<string, any>;

export function findRecipeJsonLd(html: string): JsonLd | null {
  const blocks = html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let data: unknown;
    try { data = JSON.parse(body.replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    const found = findRecipe(data);
    if (found) return found;
  }
  return null;
}

function findRecipe(node: unknown): JsonLd | null {
  if (Array.isArray(node)) {
    for (const n of node) { const r = findRecipe(n); if (r) return r; }
  } else if (node && typeof node === 'object') {
    const o = node as JsonLd;
    const t = o['@type'];
    if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return o;
    if (o['@graph']) return findRecipe(o['@graph']);
  }
  return null;
}

/** "PT1H20M" → 80 */
export function isoMinutes(iso: unknown): number {
  if (typeof iso !== 'string') return 0;
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return 0;
  return (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function flattenSteps(ins: unknown): string[] {
  if (typeof ins === 'string') return [ins];
  if (!Array.isArray(ins)) return [];
  return ins.flatMap(s => typeof s === 'string' ? [s] : s?.itemListElement ? flattenSteps(s.itemListElement) : s?.text ? [s.text] : []);
}

function pickImage(img: unknown): string | null {
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return pickImage(img[img.length - 1]);
  if (img && typeof img === 'object') return (img as JsonLd).url ?? null;
  return null;
}

const BREAKFAST = /cr[eê]pe|pancake|granola|porridge|muesli|brioche|pain perdu|smoothie|gaufre|overnight/i;

export function recipeType(categoryRaw: string | null, name: string): RecipeType {
  if (BREAKFAST.test(name)) return 'Petit-déj.';
  const c = (categoryRaw ?? '').toLowerCase();
  if (c.includes('plat') || c.includes('accompagnement')) return 'Plat';
  if (c.includes('entrée') || c.includes('entree')) return 'Entrée';
  if (c.includes('dessert') || c.includes('confiserie')) return 'Dessert';
  if (c.includes('amuse') || c.includes('apéritif') || c.includes('aperitif')) return 'Apéro';
  return 'Autre';
}

/** « rouelle de porc : la meilleure recette » → « Rouelle de porc ». */
export function cleanName(name: string): string {
  const n = name.replace(/\s*:\s*[^:]*\brecette\b[^:]*$/i, '').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Ustensiles listés dans la page Marmiton, ramenés au vocabulaire canonique. */
export function marmitonUtensils(html: string): string[] {
  const titles = [...html.matchAll(/class="card-recipe-utensil__title"[^>]*>([\s\S]*?)<\/div>/g)].map(m => clean(m[1]));
  return canonicalUtensils(titles);
}

export function parseRecipePage(html: string, url: string, source: string): ParsedRecipe | null {
  const ld = findRecipeJsonLd(html);
  if (!ld?.name || !Array.isArray(ld.recipeIngredient) || ld.recipeIngredient.length === 0) return null;

  const steps = flattenSteps(ld.recipeInstructions).map(clean).filter(Boolean);
  const siteUtensils = source === 'marmiton' ? marmitonUtensils(html) : [];
  const name = cleanName(clean(String(ld.name)));
  const utensils = withNameDevices(siteUtensils.length ? siteUtensils : deduceUtensils(steps), name);
  const rating = ld.aggregateRating ? parseFloat(ld.aggregateRating.ratingValue) : NaN;
  const categoryRaw = Array.isArray(ld.recipeCategory) ? ld.recipeCategory[0] : ld.recipeCategory ?? null;
  const keywords = typeof ld.keywords === 'string' ? ld.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
    : Array.isArray(ld.keywords) ? ld.keywords : [];

  return {
    source,
    url,
    name,
    image: pickImage(ld.image),
    categoryRaw,
    type: recipeType(categoryRaw, name),
    totalMin: isoMinutes(ld.totalTime) || isoMinutes(ld.prepTime) + isoMinutes(ld.cookTime),
    prepMin: isoMinutes(ld.prepTime),
    cookMin: isoMinutes(ld.cookTime),
    servings: parseInt(String(Array.isArray(ld.recipeYield) ? ld.recipeYield[0] : ld.recipeYield)) || 4,
    rating: Number.isFinite(rating) ? rating : null,
    reviews: parseInt(ld.aggregateRating?.reviewCount ?? ld.aggregateRating?.ratingCount ?? '0') || 0,
    keywords: keywords.map((k: string) => clean(k)),
    ingredients: ld.recipeIngredient.map((l: string) => parseIngredientLine(clean(l))),
    steps,
    utensils,
    utensilsFromSite: siteUtensils.length > 0,
    dishes: countDishes(utensils),
  };
}

/** Règle Q34 : on écarte les recettes mal notées ou trop peu notées ; les recettes sans note passent. */
export function passesQuality(r: ParsedRecipe): boolean {
  if (r.rating === null || r.reviews === 0) return true;
  return r.rating >= 4 && r.reviews >= 5;
}
