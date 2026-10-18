import { useSyncExternalStore } from 'react';

// Routage minimal : quelques pages, pas besoin d'une bibliothèque.
export type Route =
  | { page: 'ingredients' | 'recettes' | 'presque' | 'decouvrir' | 'favoris' | 'courses' | 'reglages' | 'home' }
  | { page: 'recette'; id: number };

function parse(path: string): Route {
  const m = path.match(/^\/recette\/(\d+)/);
  if (m) return { page: 'recette', id: Number(m[1]) };
  const page = path.replace(/^\/|\/$/g, '');
  if (['ingredients', 'recettes', 'presque', 'decouvrir', 'favoris', 'courses', 'reglages'].includes(page)) return { page } as Route;
  return { page: 'home' };
}

const listeners = new Set<() => void>();
let current = parse(location.pathname);
window.addEventListener('popstate', () => { current = parse(location.pathname); listeners.forEach(l => l()); });

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  current = parse(path);
  window.scrollTo(0, 0);
  listeners.forEach(l => l());
}

export function useRoute(): Route {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => current);
}
