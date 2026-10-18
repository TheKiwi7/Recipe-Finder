import { useSyncExternalStore } from 'react';

// Langue de l'interface. Le serveur fait foi (l'IA répond dans cette langue) ; une copie locale permet
// d'afficher la bonne langue dès le chargement. Changer de langue recharge la page.

export type Lang = 'fr' | 'en';

function stored(): Lang {
  try { return localStorage.getItem('lang') === 'en' ? 'en' : 'fr'; } catch { return 'fr'; }
}

export const lang: Lang = stored();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** Texte de l'interface dans la langue choisie. */
export const L = (fr: string, en: string): string => (lang === 'en' ? en : fr);
export const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
/** Nombre décimal lisible (virgule en français). */
export const dec = (n: number, digits = 1) => (lang === 'en' ? n.toFixed(digits) : n.toFixed(digits).replace('.', ','));
export const num = (n: number) => n.toLocaleString(locale);
/** « 2 recettes » / « 1 recette » : pluriel simple. */
export const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

/** Mémorise la langue choisie et recharge la page (renvoie true) si elle diffère de celle affichée. */
export function applyLang(l: Lang): boolean {
  try { localStorage.setItem('lang', l); } catch { return false; }
  if (l === lang) return false;
  location.reload();
  return true;
}

// ---------- libellés fixes ----------

const TYPES_EN: Record<string, string> = {
  Tous: 'All', Plat: 'Main', Entrée: 'Starter', Accompagnement: 'Side', Dessert: 'Dessert', Apéro: 'Appetiser',
  'Petit-déj.': 'Breakfast', Boisson: 'Drink', Sauce: 'Sauce', Autre: 'Other',
};
export const typeLabel = (t: string) => L(t, TYPES_EN[t] ?? t);

const UNITS_EN: Record<string, string> = {
  'pièce(s)': 'piece(s)', 'c. à soupe': 'tbsp', 'c. à café': 'tsp', 'sachet(s)': 'packet(s)', 'boîte(s)': 'can(s)',
  'pot(s)': 'jar(s)', 'tranche(s)': 'slice(s)', 'botte(s)': 'bunch(es)', 'gousse(s)': 'clove(s)',
};
/** Les unités sont enregistrées en français ; seul l'affichage change. */
export const unitLabel = (u: string) => L(u, UNITS_EN[u] ?? u);

export const DIET_LABELS: Record<string, [string, string]> = {
  omnivore: ['Je mange de tout', 'I eat everything'], pescetarian: ['Pas de viande', 'No meat'],
  vegetarian: ['Végétarien', 'Vegetarian'], vegan: ['Végan', 'Vegan'],
};

/** « Moi » est créé par l'app : son nom suit la langue tant qu'il n'a pas été renommé. */
export const memberName = (m: { name: string; isSelf: boolean }) => (m.isSelf && m.name === 'Moi' ? L('Moi', 'Me') : m.name);

// ---------- contenu du catalogue (français) traduit par l'IA, à la demande ----------

type Kind = 'term' | 'name';
const cache: Record<Kind, Map<string, string>> = { term: new Map(), name: new Map() };
const asked: Record<Kind, Set<string>> = { term: new Set(), name: new Set() };
const queue: Record<Kind, Set<string>> = { term: new Set(), name: new Set() };
/** Traductions demandées et en cours (le serveur y travaille, ou on va redemander sous peu) : indicateur de chargement. */
const waiting: Record<Kind, Set<string>> = { term: new Set(), name: new Set() };
const listeners = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule(kind: Kind, keys: string[], delay: number) {
  setTimeout(() => {
    for (const k of keys) if (!cache[kind].has(k)) { queue[kind].add(k); waiting[kind].add(k); }
    timer ??= setTimeout(flush, 0);
  }, delay);
}

// Le serveur répond tout de suite avec ce qui est déjà traduit et lance le reste : on revient le chercher
// (vite si la traduction est en cours, plus tard si l'IA est indisponible ou le serveur injoignable).
async function flush() {
  timer = undefined;
  for (const kind of ['term', 'name'] as Kind[]) {
    const keys = [...queue[kind]];
    queue[kind].clear();
    for (let i = 0; i < keys.length; i += 300) {
      const batch = keys.slice(i, i + 300);
      fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, keys: batch }) })
        .then(r => (r.ok ? r.json() as Promise<{ done?: Record<string, string>; pending?: boolean }> : { done: {}, pending: false, retry: true }))
        .catch(() => ({ done: {}, pending: false, retry: true }))
        .then((r: { done?: Record<string, string>; pending?: boolean; retry?: boolean }) => {
          for (const [k, v] of Object.entries(r.done ?? {})) { cache[kind].set(k, v); waiting[kind].delete(k); }
          const left = batch.filter(k => !cache[kind].has(k));
          // IA indisponible : plus d'indicateur (on redemandera dans une minute) ; en cours ou serveur injoignable : il reste.
          if (!r.pending && !r.retry) left.forEach(k => waiting[kind].delete(k));
          if (left.length) schedule(kind, left, r.pending ? 2500 : r.retry ? 5000 : 60_000);
          version++;
          listeners.forEach(l => l());
        });
    }
  }
}

function tr(kind: Kind, key: string, fallback: string): string {
  if (lang === 'fr') return fallback;
  const hit = cache[kind].get(key);
  if (hit) return hit;
  if (!asked[kind].has(key)) {
    asked[kind].add(key);
    queue[kind].add(key);
    waiting[kind].add(key);
    timer ??= setTimeout(flush, 40);
  }
  return fallback;
}

/** Ingrédient, ustensile, appareil… (vocabulaire français du catalogue) dans la langue de l'app. */
export const tTerm = (fr: string) => tr('term', fr, fr);
/** Nom d'une recette dans la langue de l'app (en attendant la traduction : le nom d'origine). */
export const tName = (id: number, fr: string) => tr('name', String(id), fr);
/** Nom de recette en cours de traduction (à appeler après `tName`, qui lance la demande). */
export const isTranslatingName = (id: number) => lang === 'en' && waiting.name.has(String(id)) && !cache.name.has(String(id));
/** À appeler dans un composant qui affiche des traductions : il se redessine quand elles arrivent. */
export const useTranslations = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => version);
/** Une traduction du détail d'une recette remplit aussi le cache des noms. */
export const rememberName = (id: number, name: string) => { cache.name.set(String(id), name); };
