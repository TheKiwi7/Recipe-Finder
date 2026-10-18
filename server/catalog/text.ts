// Mots dont le s/x final ne marque pas le pluriel ("pates" reste distinct de "pate" : pâtes ≠ pâte brisée).
const INVARIANT = new Set([
  'noix', 'riz', 'pois', 'radis', 'anchois', 'cassis', 'ananas', 'mais', 'frais', 'gras', 'bois', 'brebis',
  'couscous', 'pates', 'paris', 'tapas', 'jus', 'nems', 'lys', 'houmous', 'chips', 'cornichons', 'gros', 'choix', 'prix', 'noix',
]);

function singular(token: string): string {
  if (token.length <= 3 || INVARIANT.has(token)) return token;
  if (token.endsWith('aux') && token.length > 4) return token.slice(0, -1); // poireaux → poireau
  if (token.endsWith('s') || token.endsWith('x')) return token.slice(0, -1);
  return token;
}

/** Clé de comparaison : minuscules, sans accents, sans ponctuation, au singulier. */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
    .join(' ');
}
