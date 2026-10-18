import { useSyncExternalStore } from 'react';
import { api, type Filters, type Mode, type Reaction, type RecipeCard } from './api.ts';

// Listes des onglets Recettes et Presque, gardées en mémoire tant que l'app est ouverte
// (changer d'onglet ou ouvrir une recette ne regénère pas la liste).
export type ListState = {
  filters: Filters;
  items: RecipeCard[];
  exhausted: boolean;
  loading: boolean;
  loaded: boolean;
  stale: boolean;          // à recalculer (stock ou rejets modifiés) en gardant les recettes encore valides
  pantryVersion: number;
  error: string | null;
};

const PAGE = 10;
const initial = (): ListState => ({ filters: { type: 'Plat', maxTime: null }, items: [], exhausted: false, loading: false, loaded: false, stale: false, pantryVersion: -1, error: null });
const lists: Record<Mode, ListState> = { ready: initial(), almost: initial() };
const listeners = new Set<() => void>();

function set(mode: Mode, patch: Partial<ListState>) {
  lists[mode] = { ...lists[mode], ...patch };
  listeners.forEach(l => l());
}

async function load(mode: Mode, current: number[], want: number, pantryVersion: number) {
  set(mode, { loading: true, error: null });
  try {
    const r = await api.recommend(mode, lists[mode].filters, current, want);
    set(mode, { items: r.items, exhausted: r.exhausted, loading: false, loaded: true, stale: false, pantryVersion });
  } catch (e) {
    set(mode, { loading: false, error: (e as Error).message });
  }
}

/** Premier affichage, ou recalcul après un changement de stock (Q23) : on garde la place des recettes encore faisables. */
export function ensureList(mode: Mode, pantryVersion: number) {
  const s = lists[mode];
  if (s.loading) return;
  if (!s.loaded) return load(mode, [], PAGE, pantryVersion);
  if (s.stale || s.pantryVersion !== pantryVersion) return load(mode, s.items.map(i => i.id), Math.max(PAGE, s.items.length), pantryVersion);
}

export function loadMore(mode: Mode) {
  const s = lists[mode];
  return load(mode, s.items.map(i => i.id), s.items.length + PAGE, s.pantryVersion);
}

export function setFilters(mode: Mode, filters: Filters) {
  set(mode, { filters, items: [], loaded: false });
  return load(mode, [], PAGE, lists[mode].pantryVersion);
}

/** Met à jour la réaction affichée sans recharger (une recette rejetée reste grisée à sa place). */
export function patchReaction(id: number, reaction: Reaction) {
  for (const mode of ['ready', 'almost'] as Mode[]) {
    if (lists[mode].items.some(i => i.id === id)) set(mode, { items: lists[mode].items.map(i => (i.id === id ? { ...i, reaction } : i)) });
  }
}

/** Les rejets d'ingrédients changent ce qui est éligible : recalcul au prochain affichage. */
export function invalidateLists() {
  for (const mode of ['ready', 'almost'] as Mode[]) if (lists[mode].loaded) set(mode, { stale: true });
}

export function useList(mode: Mode): ListState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => lists[mode]);
}
