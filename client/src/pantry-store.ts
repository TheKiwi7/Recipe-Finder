import { useSyncExternalStore } from 'react';
import { api, type PantryResponse } from './api.ts';

// État du stock partagé entre la barre latérale (verrou) et les pages.
let state: PantryResponse | null = null;
const listeners = new Set<() => void>();

export async function refreshPantry(): Promise<PantryResponse> {
  state = await api.pantry();
  listeners.forEach(l => l());
  return state;
}

export function usePantry(): PantryResponse | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
