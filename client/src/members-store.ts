import { useSyncExternalStore } from 'react';
import { api, type Members } from './api.ts';
import { invalidateLists } from './recipes-store.ts';

// Les membres de la famille et « qui mange », partagés entre les Réglages et le filtre des recettes.
let state: Members | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export async function refreshMembers(): Promise<Members> {
  state = await api.members();
  emit();
  return state;
}

/** Coche / décoche une personne pour ce repas ; les listes de recettes sont recalculées. */
export async function toggleEater(id: number): Promise<void> {
  if (!state) return;
  const eaters = state.eaters.includes(id) ? state.eaters.filter(e => e !== id) : [...state.eaters, id];
  if (eaters.length === 0) throw new Error('Choisis au moins une personne');
  state = { ...state, eaters: (await api.setEaters(eaters)).eaters };
  emit();
  invalidateLists();
}

export function useMembers(): Members | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
