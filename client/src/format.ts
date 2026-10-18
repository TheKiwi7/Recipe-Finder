import { L } from './i18n.ts';

export function fmtTime(min: number): string {
  if (!min) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export const dishesLabel = (n: number) => L(`${n} pièce${n > 1 ? 's' : ''} à laver`, `${n} item${n > 1 ? 's' : ''} to wash`);

const METRIC = /^(g|kg|mg|ml|cl|dl|l)$/i;
const FRACTIONS: Array<[number, string]> = [[0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [1, '']];

/** Œufs, sachets, cuillères… : fraction lisible la plus proche (jamais moins de ¼). */
function countable(v: number): string {
  const x = Math.max(0.25, v);
  const whole = Math.floor(x);
  const [f, glyph] = FRACTIONS.reduce((best, cur) => (Math.abs(x - whole - cur[0]) < Math.abs(x - whole - best[0]) ? cur : best));
  const w = whole + (f === 1 ? 1 : 0);
  if (!glyph) return String(w);
  return w ? `${w} ${glyph}` : glyph;
}

/** Quantité lisible : grammes arrondis, fractions pour ce qui se compte. */
export function fmtQty(v: number, unit: string | null): string {
  if (unit && METRIC.test(unit)) {
    if (v >= 50 && /^(g|ml|cl)$/i.test(unit)) return String(Math.round(v / 5) * 5);
    if (v >= 10) return String(Math.round(v));
    return L((Math.round(v * 10) / 10).toString().replace('.', ','), (Math.round(v * 10) / 10).toString());
  }
  return v >= 10 ? String(Math.round(v)) : countable(v);
}

const LEADING_QTY = /^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔])/;

/** Remplace la quantité en tête de ligne par la quantité recalculée pour le nombre de personnes. */
export function scaleLine(raw: string, qty: number | null, unit: string | null, factor: number): string {
  if (qty === null || factor === 1) return raw;
  return raw.replace(LEADING_QTY, fmtQty(qty * factor, unit));
}
