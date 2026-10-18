import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanName, isoMinutes, parseRecipePage, passesQuality, recipeType } from './recipe.ts';
import { canonicalUtensils, countDishes, deduceUtensils, utensilsFor, withNameDevices } from './utensils.ts';

const page = (ld: object, extra = '') =>
  `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>${extra}</body></html>`;

const LD = {
  '@context': 'https://schema.org', '@type': 'Recipe',
  name: 'Gratin dauphinois : la meilleure recette',
  image: ['https://img/small.jpg', 'https://img/big.jpg'],
  recipeCategory: 'Plat principal', recipeYield: '4 personnes',
  prepTime: 'PT20M', cookTime: 'PT1H', totalTime: 'PT1H20M',
  recipeIngredient: ['1 kg de pommes de terre', '50 cl de crème fraîche'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Éplucher et couper les pommes de terre.' }, { '@type': 'HowToStep', text: 'Enfourner dans un plat à gratin.' }],
  aggregateRating: { ratingValue: '4.6', reviewCount: '120' },
  keywords: 'gratin, pommes de terre, Facile',
};

test('page Marmiton → recette', () => {
  const utensilsHtml = ['1 Four', '1 Table induction SaphirMatt Electrolux', '1 plat à gratin', '1 Top des meilleurs papiers sulfurisés', '1 Couteau']
    .map(t => `<div class="card-recipe-utensil__title"> ${t} </div>`).join('');
  const r = parseRecipePage(page(LD, utensilsHtml), 'https://x', 'marmiton')!;
  assert.equal(r.name, 'Gratin dauphinois');
  assert.equal(parseRecipePage(page({ ...LD, name: 'Ganache au chocolat : recette facile' }), 'u', 'marmiton')!.name, 'Ganache au chocolat');
  assert.equal(r.image, 'https://img/big.jpg');
  assert.equal(parseRecipePage(page({ ...LD, image: 'https://www.marmiton.org/assets/images/default-recipe-picture_80x80-6PRRwF3.jpg' }), 'u', 'marmiton')!.image, null);
  assert.equal(r.type, 'Plat');
  assert.deepEqual([r.totalMin, r.prepMin, r.cookMin, r.servings], [80, 20, 60, 4]);
  assert.deepEqual([r.rating, r.reviews], [4.6, 120]);
  assert.equal(r.ingredients[0].name, 'pommes de terre');
  // La pub (« Table induction… ») et ce que les étapes n'utilisent pas sont écartés ; « éplucher et couper » ajoute planche et économe.
  assert.deepEqual(r.utensils, ['Four', 'Plat à gratin', 'Couteau', 'Planche à découper', 'Économe']);
  assert.equal(r.utensilsFromSite, true);
  assert.equal(r.dishes, 1);
  const thermo = parseRecipePage(page({ ...LD, name: 'saumon au Thermomix' }), 'u', 'marmiton')!;
  assert.equal(thermo.name, 'Saumon au Thermomix');
  assert.ok(thermo.utensils.includes('Robot cuiseur'));
});

test('sans liste du site, les ustensiles sont déduits des étapes', () => {
  const r = parseRecipePage(page(LD), 'https://x', 'marmiton')!;
  assert.equal(r.utensilsFromSite, false);
  assert.deepEqual(r.utensils, ['Four', 'Plat à gratin', 'Planche à découper', 'Économe']);
});

test('pas de JSON-LD Recipe → null', () => {
  assert.equal(parseRecipePage('<html></html>', 'u', 'marmiton'), null);
});

test('durées, types, vaisselle, qualité', () => {
  assert.equal(isoMinutes('PT1H5M'), 65);
  assert.equal(isoMinutes('PT45M'), 45);
  assert.equal(recipeType('Dessert', 'Crêpes faciles'), 'Petit-déj.');
  assert.equal(recipeType('Amuse-gueule', 'Cake salé'), 'Apéro');
  assert.equal(recipeType('Accompagnement', 'Confit d’oignons'), 'Autre');
  assert.equal(cleanName('ORONGES ou amanite des césars'), 'Oronges ou amanite des césars');
  assert.equal(cleanName('Pain aux olives en MAP'), 'Pain aux olives en MAP');
  assert.deepEqual(withNameDevices([], 'Pain aux olives en MAP'), ['Machine à pain']);
  assert.deepEqual(deduceUtensils(['Prendre une fourchette.']), []);
  assert.deepEqual(canonicalUtensils(['1 Moule à cake', '1 Fouet cuisine', '1 saladier']), ['Moule', 'Saladier', 'Fouet']);
  // Liste du site filtrée par les étapes : pas de mixeur ni de louche pour une sauce à la crème.
  const sauce = ['Faire chauffer la crème fraiche dans une casserole à feu doux.', 'Couper le cube de bouillon en deux.', 'Remuer jusqu’à ce que le cube soit dissout.'];
  assert.deepEqual(utensilsFor(['Robot / mixeur', 'Casserole', 'Couteau', 'Cuillère en bois', 'Louche'], sauce), ['Casserole', 'Couteau', 'Planche à découper', 'Cuillère en bois']);
  assert.equal(countDishes(['Four', 'Casserole', 'Saladier', 'Couteau']), 2);
  const base = parseRecipePage(page(LD), 'u', 'marmiton')!;
  assert.equal(passesQuality({ ...base, rating: 3.9, reviews: 50 }), false);
  assert.equal(passesQuality({ ...base, rating: 4.8, reviews: 3 }), true);
  assert.equal(passesQuality({ ...base, rating: 3.5, reviews: 1 }), false);
  assert.equal(passesQuality({ ...base, rating: null, reviews: 0 }), true);
});
