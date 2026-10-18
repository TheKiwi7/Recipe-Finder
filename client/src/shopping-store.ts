import { useSyncExternalStore } from 'react';
import { api, type ShoppingItem } from './api.ts';

// Liste de courses partagée entre la barre latérale (compteur), l'onglet Courses et la fiche recette (« Je la fais »).
let items: ShoppingItem[] | null = null;
const listeners = new Set<() => void>();

export function setShopping(next: ShoppingItem[]): void {
  items = next;
  listeners.forEach(l => l());
}

export async function refreshShopping(): Promise<ShoppingItem[]> {
  setShopping(await api.shopping());
  return items!;
}

export function useShopping(): ShoppingItem[] | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => items);
}
