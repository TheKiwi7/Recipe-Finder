import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUESTIONNAIRE } from '../preferences.ts';
import { pickBatch, rankCandidates, similarity, type Context, type Entry } from './rank.ts';

let nextId = 1;
const entry = (bases: string[], over: Partial<Entry> = {}): Entry => ({
  id: nextId++, name: `r${nextId}`, type: 'Plat', totalMin: 30, dishes: 1, rating: 4.5, reviews: 20, bases, keywords: [], utensils: [], ...over,
});
const ctx = (over: Partial<Context> = {}): Context => ({
  available: new Set(['sel', 'poivre', 'oeuf', 'tomate', 'poulet', 'riz', 'crème fraîche']),
  urgent: new Set(), staples: new Set(['sel', 'poivre']), banned: new Set(), liked: [], disliked: [], excluded: new Set(),
  questionnaire: DEFAULT_QUESTIONNAIRE, weights: {}, idf: new Map(), common: new Set(['crème fraîche', 'oignon']), ...over,
});

test('onglet Recettes : uniquement les recettes faisables', () => {
  const ok = entry(['oeuf', 'tomate', 'sel']);
  const ko = entry(['oeuf', 'jambon']);
  const ids = rankCandidates([ok, ko], ctx(), 'ready', {}).map(s => s.entry.id);
  assert.deepEqual(ids, [ok.id]);
});

test('onglet Presque : 1 à 3 manquants, les courants pénalisent moins', () => {
  const rare = entry(['poulet', 'safran']);
  const courant = entry(['poulet', 'oignon']);
  const trop = entry(['a', 'b', 'c', 'd']);
  const r = rankCandidates([rare, courant, trop, entry(['riz'])], ctx(), 'almost', {});
  assert.deepEqual(r.map(s => s.entry.id), [courant.id, rare.id]);
  assert.deepEqual(r[0].missing, ['oignon']);
});

test('exclusions strictes : ingrédient rejeté, appareil absent, recette exclue, filtres', () => {
  const banned = entry(['tomate']);
  const friteuse = entry(['riz'], { utensils: ['Friteuse'] });
  const vue = entry(['oeuf']);
  const longue = entry(['poulet'], { totalMin: 90 });
  const dessert = entry(['oeuf'], { type: 'Dessert' });
  const c = ctx({ banned: new Set(['tomate']), excluded: new Set([vue.id]) });
  assert.deepEqual(rankCandidates([banned, friteuse, vue, longue, dessert], c, 'ready', { maxTime: 45, type: 'Plat' }), []);
});

test('« à finir vite » et likes remontent une recette, dislikes la font descendre', () => {
  const a = entry(['poulet', 'riz']);
  const b = entry(['oeuf', 'tomate']);
  assert.equal(rankCandidates([a, b], ctx({ urgent: new Set(['tomate']) }), 'ready', {})[0].entry.id, b.id);
  const likedTwin = entry(['poulet', 'riz', 'crème fraîche']);
  assert.equal(rankCandidates([a, b], ctx({ liked: [likedTwin] }), 'ready', {})[0].entry.id, a.id);
  assert.equal(rankCandidates([a, b], ctx({ disliked: [likedTwin] }), 'ready', {})[0].entry.id, b.id);
});

test('réglages du profil (Claude)', () => {
  const curry = entry(['poulet', 'riz'], { name: 'Curry de poulet' });
  const omelette = entry(['oeuf', 'tomate'], { name: 'Omelette' });
  const r = rankCandidates([curry, omelette], ctx({ weights: { keywords: { curry: -1 } } }), 'ready', {});
  assert.equal(r[0].entry.id, omelette.id);
});

test('similarité : les ingrédients rares comptent plus que le sel', () => {
  const idf = new Map([['sel', 0.1], ['safran', 5], ['riz', 1]]);
  const a = entry(['sel', 'safran', 'riz']);
  assert.ok(similarity(a, entry(['safran', 'riz']), idf) > similarity(a, entry(['sel', 'riz']), idf));
});

test('lot : 10 recettes dont ~3 explorations, sans doublon', () => {
  const ranked = rankCandidates(Array.from({ length: 40 }, () => entry(['oeuf'])), ctx(), 'ready', {});
  let seed = 1;
  const batch = pickBatch(ranked, 10, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  assert.equal(batch.length, 10);
  assert.equal(new Set(batch.map(s => s.entry.id)).size, 10);
});
