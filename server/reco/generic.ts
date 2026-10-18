import { normalizeKey } from '../catalog/text.ts';
import { containsWord } from '../preferences.ts';

// Certaines recettes demandent « 100 g de fromages au choix » ou « 500 g de viande (poulet, boeuf ou porc) » :
// leur base est générique. N'importe quel membre de la famille présent dans le stock la satisfait.
const FAMILIES: Record<string, string[]> = {
  fromage: ['fromage', 'gruyere', 'comte', 'emmental', 'mozzarella', 'parmesan', 'chevre', 'feta', 'raclette', 'reblochon', 'camembert', 'cheddar', 'roquefort', 'brie', 'mimolette', 'beaufort', 'cantal', 'tomme', 'morbier', 'abondance', 'bleu', 'gorgonzola', 'halloumi', 'pecorino', 'scamorza', 'ossau iraty', 'saint nectaire', 'munster', 'maroille'],
  viande: ['viande', 'poulet', 'dinde', 'boeuf', 'veau', 'porc', 'agneau', 'canard', 'lapin', 'saucisse', 'lardon', 'jambon', 'chipolata', 'merguez', 'pintade', 'magret'],
  poisson: ['poisson', 'saumon', 'cabillaud', 'thon', 'dorade', 'daurade', 'truite', 'merlu', 'sardine', 'maquereau', 'bar', 'colin', 'lieu', 'sole', 'merlan', 'lotte', 'eglefin', 'espadon', 'loup', 'mulet', 'perche', 'tilapia'],
};

const FAMILY_WORDS = Object.fromEntries(Object.entries(FAMILIES).map(([g, ws]) => [g, ws.map(normalizeKey)]));

/** Famille générique (« fromage », « viande », « poisson ») dont fait partie un ingrédient précis, ou null. */
export function familyOf(base: string): string | null {
  const key = normalizeKey(base);
  for (const [generic, words] of Object.entries(FAMILY_WORDS)) if (key !== generic && containsWord(key, words)) return generic;
  return null;
}
export const isGeneric = (base: string) => base in FAMILIES;

/** Ajoute aux bases disponibles les génériques satisfaits (« fromage » si le stock contient du gruyère). */
export function withGenerics(available: Set<string>): Set<string> {
  const keys = [...available].map(normalizeKey);
  const out = new Set(available);
  for (const [generic, words] of Object.entries(FAMILY_WORDS)) {
    if (!out.has(generic) && keys.some(k => containsWord(k, words))) out.add(generic);
  }
  return out;
}
