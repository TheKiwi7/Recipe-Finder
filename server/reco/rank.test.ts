import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allergenKey, DEFAULT_QUESTIONNAIRE, exclusionWords } from '../preferences.ts';
import { bayesianRating, pickBatch, rankCandidates, similarity, type Context, type Entry } from './rank.ts';

let nextId = 1;
const entry = (bases: string[], over: Partial<Entry> = {}): Entry => ({
  id: nextId++, name: `r${nextId}`, type: 'Plat', totalMin: 30, dishes: 1, rating: 4.5, reviews: 20, bases, keywords: [], utensils: [], ...over,
});
const ctx = (over: Partial<Context> = {}): Context => ({
  available: new Set(['sel', 'poivre', 'oeuf', 'tomate', 'poulet', 'riz', 'crème fraîche']),
  urgent: new Set(), staples: new Set(['sel', 'poivre']), banned: new Set(), liked: [], disliked: [], excluded: new Set(),
  questionnaire: DEFAULT_QUESTIONNAIRE, weights: {}, idf: new Map(), common: new Set(['crème fraîche', 'oignon']), exclusionWords: [], ...over,
});

test('onglet Recettes : uniquement les recettes faisables', () => {
  const ok = entry(['oeuf', 'tomate', 'sel']);
  const ko = entry(['oeuf', 'jambon']);
  const ids = rankCandidates([ok, ko], ctx(), 'ready', {}).map(s => s.entry.id);
  assert.deepEqual(ids, [ok.id]);
});

test('une recette sans ingrédient reconnu hors placard n’est jamais proposée', () => {
  assert.deepEqual(rankCandidates([entry([]), entry(['sel', 'poivre'])], ctx(), 'ready', {}), []);
});

test('ingrédient rejeté cité seulement dans les étapes : recette exclue', () => {
  const croque = entry(['pain de mie', 'oeuf'], { stepsKey: ' mettre une tranche de jambon et 2 tranche de fromage de chevre ' });
  const omelette = entry(['oeuf'], { stepsKey: ' battre les oeuf au lieu de les brouiller puis beurrer le moule et couper au couteau ' });
  const avail = new Set(['pain de mie', 'oeuf']);
  const r = rankCandidates([croque, omelette], ctx({ available: avail, banned: new Set(['chèvre', 'moule', 'couteaux']), exclusionWords: ['lieu'] }), 'ready', {});
  assert.deepEqual(r.map(s => s.entry.id), [omelette.id]);
});

test('une recette sans photo n’est pas proposée', () => {
  assert.deepEqual(rankCandidates([entry(['oeuf'], { hasImage: false })], ctx(), 'ready', {}), []);
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

test('allergies et régime : exclusion par mot, avec les familles d’allergènes', () => {
  const avail = new Set(["huile d'arachide", 'cacahuète', 'filet de porc', 'riz', 'farine de blé', 'oeuf']);
  const huile = entry(["huile d'arachide", 'riz']);
  const cacahuete = entry(['cacahuète', 'riz']);
  const porc = entry(['filet de porc', 'riz']);
  const omelette = entry(['oeuf']);
  const run = (q: Partial<typeof DEFAULT_QUESTIONNAIRE>) =>
    rankCandidates([huile, cacahuete, porc, omelette], ctx({ available: avail, exclusionWords: exclusionWords({ ...DEFAULT_QUESTIONNAIRE, ...q }) }), 'ready', {}).map(s => s.entry.id).sort();
  assert.deepEqual(run({ allergies: ['arachide'] }), [porc.id, omelette.id].sort());
  assert.deepEqual(run({ diet: 'vegetarian' }), [huile.id, cacahuete.id, omelette.id].sort());
  assert.deepEqual(run({ allergies: ['oeufs'] }), [huile.id, cacahuete.id, porc.id].sort());
});

test('aversions fermes du profil : exclusion par famille', () => {
  const avail = new Set(['poisson blanc', 'pangasius', 'fruits de mer', 'oeuf', 'poulet']);
  const fondue = entry(['poisson blanc', 'fruits de mer', 'oeuf']);
  const pangasius = entry(['pangasius', 'oeuf']);
  const omelette = entry(['oeuf', 'poulet']);
  const words = exclusionWords(DEFAULT_QUESTIONNAIRE, ['poisson', 'fruit de mer']);
  assert.deepEqual(rankCandidates([fondue, pangasius, omelette], ctx({ available: avail, exclusionWords: words }), 'ready', {}).map(s => s.entry.id), [omelette.id]);
});

test('allergies saisies librement : gluten, lactose, produits laitiers', () => {
  assert.equal(allergenKey('Sans gluten'), 'gluten');
  assert.equal(allergenKey('intolérance au lactose'), 'lactose');
  assert.equal(allergenKey('Allergie aux arachides'), 'arachide');
  assert.equal(allergenKey('produits laitiers'), 'produit laitier');
  const words = exclusionWords({ ...DEFAULT_QUESTIONNAIRE, allergies: ['sans gluten', 'intolérance au lactose'] });
  const avail = new Set(['pâtes', 'farine', 'crème fraîche', 'riz', 'poulet', 'sauce soja', 'huile']);
  const carbo = entry(['pâtes', 'crème fraîche']);
  const wok = entry(['riz', 'poulet', 'sauce soja']);
  const poulet = entry(['riz', 'poulet', 'huile']);
  assert.deepEqual(rankCandidates([carbo, wok, poulet], ctx({ available: avail, exclusionWords: words }), 'ready', {}).map(r => r.entry.id), [poulet.id]);
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

test('peu d’avis : une note parfaite ne passe pas devant une recette éprouvée', () => {
  const unAvis = entry(['oeuf'], { rating: 5, reviews: 1 });
  const eprouvee = entry(['oeuf'], { rating: 4.6, reviews: 120 });
  assert.equal(rankCandidates([unAvis, eprouvee], ctx(), 'ready', {})[0].entry.id, eprouvee.id);
  assert.ok(Math.abs(bayesianRating(5, 1) - 4.333) < 0.01);
});

test('vaisselle : la tolérance du questionnaire prime', () => {
  const une = entry(['oeuf'], { dishes: 1 });
  const trois = entry(['oeuf'], { dishes: 3, rating: 5, reviews: 500 });
  const q = { ...DEFAULT_QUESTIONNAIRE, dishTolerance: 'low' as const };
  const weights = { maxDishes: 5 } as Context['weights'];
  assert.equal(rankCandidates([trois, une], ctx({ questionnaire: q, weights }), 'ready', {})[0].entry.id, une.id);
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
