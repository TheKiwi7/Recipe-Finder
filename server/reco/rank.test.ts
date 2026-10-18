import { test } from 'node:test';
import { typeGuesser } from '../catalog/importer.ts';
import assert from 'node:assert/strict';
import { allergenKey, DEFAULT_QUESTIONNAIRE, exclusionWords } from '../preferences.ts';
import { bayesianRating, pickBatch, rankCandidates, similarity, twins, type Context, type Entry } from './rank.ts';

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

test('lot : les recettes presque pareilles ne se suivent pas', () => {
  const caramels = ['Caramel beurre salé', 'Crème de caramel au beurre salé', 'Beurre salé au caramel', 'Caramel au beurre salé façon pâte à tartiner', 'Caramels beurre salé maison', 'Caramel crémeux']
    .map(name => entry(['sucre', 'beurre salé', 'crème liquide'], { name, rating: 5, reviews: 500 }));
  assert.ok(twins(caramels[0], caramels[5], new Map())); // un seul mot en commun, mais les mêmes ingrédients
  assert.ok(!twins(entry(['farine', 'sucre', 'beurre', 'oeuf'], { name: 'Sablés' }), entry(['farine', 'sucre', 'beurre', 'lait'], { name: 'Crêpes' }), new Map()));
  const autres = Array.from({ length: 30 }, (_, i) => entry([`ingrédient ${i}`, `épice ${i}`], { name: `Recette ${i}` }));
  const avail = new Set([...caramels, ...autres].flatMap(e => e.bases));
  const ranked = rankCandidates([...caramels, ...autres], ctx({ available: avail }), 'ready', {});
  assert.ok(caramels.every(c => ranked.slice(0, 6).some(s => s.entry.id === c.id))); // sans variété, les 6 caramels ouvriraient la liste
  const isCaramel = (s: { entry: Entry }) => caramels.some(c => c.id === s.entry.id);
  for (let run = 0; run < 20; run++) {
    const batch = pickBatch(ranked, 20, Math.random);
    assert.ok(batch.every((s, i) => i === 0 || !(isCaramel(s) && isCaramel(batch[i - 1]))), 'deux caramels à la suite');
    assert.ok(batch.filter(isCaramel).length <= 3, 'trop de caramels sur une page'); // les autres viendront avec « Charger plus »
    // Les dernières recettes déjà affichées comptent aussi : pas de caramel juste après un caramel de la page précédente.
    assert.ok(!isCaramel(pickBatch(ranked, 20, Math.random, { recent: [caramels[0]] })[0]));
  }
});

test('onglet Découvrir : recettes à plus de 3 manquants, classées d’après les goûts', () => {
  const liked = entry(['saumon', 'aneth', 'citron', 'crème fraîche', 'pomme de terre']);
  const proche = entry(['saumon', 'aneth', 'citron', 'fenouil', 'pomme de terre']);
  const loin = entry(['boeuf', 'carotte', 'navet', 'poireau', 'céleri'], { rating: 4.9, reviews: 300 });
  const presque = entry(['poulet', 'safran']); // 1 manquant : c'est pour l'onglet Presque
  // Assez de likes : les recettes proches passent devant une recette mieux notée mais éloignée des goûts.
  const r = rankCandidates([proche, loin, presque], ctx({ liked: Array(8).fill(liked) }), 'discover', {});
  assert.deepEqual(r.map(s => s.entry.id), [proche.id, loin.id]);
  // Un seul like ne tire pas toute la liste : c'est alors le profil qui oriente.
  const profil = { ingredients: { boeuf: 0.7, poireau: 0.5 } };
  const r1 = rankCandidates([proche, loin], ctx({ liked: [liked], weights: profil }), 'discover', {});
  assert.deepEqual(r1.map(s => s.entry.id), [loin.id, proche.id]);
});

test('priorité d’import : le type est deviné d’après les mots de l’adresse', () => {
  const ex = (slug: string, type: string) => ({ url: `https://www.marmiton.org/recettes/recette_${slug}_1.aspx`, type });
  const guess = typeGuesser([
    ex('gateau-au-chocolat', 'Dessert'), ex('tarte-aux-pommes', 'Dessert'), ex('mousse-au-chocolat', 'Dessert'),
    ex('poulet-basquaise', 'Plat'), ex('roti-de-porc', 'Plat'), ex('poulet-au-curry', 'Plat'), ex('puree-de-carottes', 'Accompagnement'),
  ], ['Plat', 'Accompagnement']);
  assert.ok(guess('https://www.marmiton.org/recettes/recette_poulet-roti_9.aspx') > 0.5);
  assert.ok(guess('https://www.marmiton.org/recettes/recette_fondant-au-chocolat_9.aspx') < 0.5);
});
