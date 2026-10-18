import { normalizeKey } from './text.ts';

export type IngredientLine = {
  raw: string;
  qty: number | null;
  unit: string | null;
  /** Nom nettoyé, tel qu'affiché (« chocolat pâtissier »). */
  name: string;
  /** Ingrédient de base (« chocolat »), null tant qu'il n'est pas reconnu. */
  base: string | null;
};

const FRACTIONS: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3' };

// Unités abrégées : pas besoin de « de » derrière (« 100 g beurre »).
const SHORT_UNITS = /^(kg|mg|g|gr|cl|dl|ml|l)\b\.?\s*/i;
// Unités en toutes lettres : seulement si suivies de « de » / « d' » (« 1 noix de beurre » mais « 3 noix »).
const WORD_UNITS = [
  'cuillères? à soupe', 'cuillères? à café', 'c\\. à soupe', 'c\\. à café', 'c\\.à\\.s', 'c\\.à\\.c', 'cs', 'cc',
  'pincées?', 'sachets?', 'tranches?', 'gousses?', 'brins?', 'branches?', 'bottes?', 'boîtes?', 'pots?',
  'verres?', 'tasses?', 'bols?', 'feuilles?', 'filets?', 'noix', 'morceaux?', 'poignées?', 'cubes?', 'barquettes?',
  'paquets?', 'rouleaux?', 'carrés?', 'bouquets?', 'tiges?', 'quartiers?', 'rondelles?', 'doses?', 'louches?',
  'tablettes?', 'plaquettes?', 'bocaux?', 'bocal', 'briques?', 'litres?', 'grammes?', 'kilos?', 'zestes?',
  'boules?', 'pavés?', 'dés', 'pointes? de couteau',
];
const WORD_UNIT_RE = new RegExp(`^(${WORD_UNITS.join('|')})\\s+(?:de\\s+|d['’]\\s*)`, 'i');
const LEADING_FILLERS = /^(quelques\s+|un peu d(?:e\s+|['’])|une? pincée d(?:e\s+|['’])|un filet d(?:e\s+|['’])|du\s+|de la\s+|des\s+|de l['’]\s*|d['’]\s*|de\s+)/i;
const QTY_RE = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)(?:\s*(?:à|-)\s*\d+(?:[.,]\d+)?)?\s*/;

function toNumber(text: string): number {
  const [a, b] = text.replace(',', '.').split('/').map(s => parseFloat(s.trim()));
  return b ? a / b : a;
}

export function parseIngredientLine(raw: string): Omit<IngredientLine, 'base'> {
  let s = raw.replace(/[½¼¾⅓⅔]/g, c => FRACTIONS[c]).replace(/\s+/g, ' ').trim();
  let qty: number | null = null;
  let unit: string | null = null;

  const q = s.match(QTY_RE);
  if (q) {
    qty = toNumber(q[1]);
    s = s.slice(q[0].length);
    const short = s.match(SHORT_UNITS);
    const word = s.match(WORD_UNIT_RE);
    if (short) { unit = short[1].toLowerCase().replace('gr', 'g'); s = s.slice(short[0].length); }
    else if (word) { unit = word[1].toLowerCase(); s = s.slice(word[0].length); }
  }
  s = s.replace(LEADING_FILLERS, '');

  const name = s
    .replace(/\([^)]*\)/g, ' ')
    // « pour » ne coupe que devant un usage (« pour le moule », « pour servir »), pas devant un nom (« pour tartiflette »).
    .split(/,| ou | pour (?=(?:le|la|les|l['’]|un|une|des|du|servir|décorer|dorer|graisser|beurrer|fariner|badigeonner|napper|parsemer|la cuisson|accompagner)\b)| \+ /i)[0]
    .replace(/\s+/g, ' ')
    .trim();

  return { raw, qty, unit, name: name.charAt(0).toLowerCase() + name.slice(1) };
}

// « X de Y » dont seul X est connu : souvent Y est le vrai ingrédient (« eau de fleur d'oranger », « noisette de beurre »).
// On laisse alors Claude trancher, sauf pour ces compléments sans ambiguïté.
const CONNECTOR = /^(de|d|a|au|aux|en)\b/;
const SAFE_TAILS = ['en poudre', 'en morceau', 'en de', 'en tranche', 'en conserve', 'en boite', 'en branche', 'en grain', 'en feuille', 'a temperature ambiante', 'a la temperature ambiante', 'de preference', 'de votre choix', 'au choix', 'du jardin', 'de saison'];

/** Reste de nom (normalisé) après la partie reconnue : « de saumon » est ambigu, « en poudre » ne l'est pas. */
export function isAmbiguousTail(tail: string): boolean {
  return !!tail && CONNECTOR.test(tail) && !SAFE_TAILS.some(s => tail.startsWith(s));
}

const LEADING_ADJECTIVES = new Set(['gros', 'grosse', 'petit', 'petite', 'beau', 'belle', 'bon', 'bonne', 'jeune', 'demi', 'grand', 'grande', 'fin', 'fine', 'bel']);

/**
 * Plus long préfixe du nom présent dans le dictionnaire ; on retente sans un adjectif initial (« gros oignon »).
 * Renvoie la base, null si le terme est connu comme « pas un ingrédient », undefined s'il est inconnu.
 */
export function resolveBase(name: string, aliases: ReadonlyMap<string, string | null>): string | null | undefined {
  const tokens = normalizeKey(name).split(' ').filter(Boolean);
  const attempt = (t: string[]) => {
    for (let n = t.length; n > 0; n--) {
      const key = t.slice(0, n).join(' ');
      if (!aliases.has(key)) continue;
      const tail = t.slice(n).join(' ');
      if (isAmbiguousTail(tail)) return undefined;
      return aliases.get(key)!;
    }
    return undefined;
  };
  const hit = attempt(tokens);
  return hit !== undefined || !LEADING_ADJECTIVES.has(tokens[0]) ? hit : attempt(tokens.slice(1));
}
