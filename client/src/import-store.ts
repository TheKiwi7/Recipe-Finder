import { useSyncExternalStore } from 'react';
import { api, type ImportStatus } from './api.ts';

// État de l'import partagé entre la barre latérale (relu toutes les 15 s) et la carte Catalogue des Réglages :
// les deux affichent toujours les mêmes chiffres.
let status: ImportStatus | null = null;
const listeners = new Set<() => void>();

/** Une réponse partielle (« Ajouter des recettes » ne renvoie ni build ni server) complète l'état sans l'écraser. */
export function setImportStatus(next: Partial<ImportStatus>): void {
  status = { ...status, ...next } as ImportStatus;
  listeners.forEach(l => l());
}

export async function refreshImportStatus(): Promise<ImportStatus> {
  setImportStatus(await api.importStatus());
  return status!;
}

export function useImportStatus(): ImportStatus | null {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => status);
}
