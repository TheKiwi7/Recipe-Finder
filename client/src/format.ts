export function fmtTime(min: number): string {
  if (!min) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export const dishesLabel = (n: number) => `${n} pièce${n > 1 ? 's' : ''} à laver`;

const FRACTIONS: Array<[number, string]> = [[0.25, '¼'], [0.5, '½'], [0.75, '¾']];

/** Quantité lisible : fractions pour les petites valeurs, arrondi au 5 pour les grammes. */
export function fmtQty(v: number, unit: string | null): string {
  if (v >= 50 && unit && /^(g|ml|cl|kg|l)$/i.test(unit) && unit !== 'kg' && unit !== 'l') return String(Math.round(v / 5) * 5);
  if (v >= 10) return String(Math.round(v));
  const whole = Math.floor(v), frac = v - whole;
  const near = FRACTIONS.find(([f]) => Math.abs(frac - f) < 0.08);
  if (near) return whole ? `${whole} ${near[1]}` : near[1];
  if (frac < 0.08) return String(whole || 1);
  if (frac > 0.92) return String(whole + 1);
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

const LEADING_QTY = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])/;

/** Remplace la quantité en tête de ligne par la quantité recalculée pour le nombre de personnes. */
export function scaleLine(raw: string, qty: number | null, unit: string | null, factor: number): string {
  if (qty === null || factor === 1) return raw;
  return raw.replace(LEADING_QTY, fmtQty(qty * factor, unit));
}
