import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredientLine, resolveBase } from './ingredients.ts';
import { seedAliases } from './seed-ingredients.ts';
import { normalizeKey } from './text.ts';

const aliases = new Map(seedAliases().map(([a, b]) => [normalizeKey(a), b]));
const base = (raw: string) => resolveBase(parseIngredientLine(raw).name, aliases);

test('quantité, unité abrégée et nom', () => {
  assert.deepEqual(parseIngredientLine('150 g de chocolat pâtissier'), { raw: '150 g de chocolat pâtissier', qty: 150, unit: 'g', name: 'chocolat pâtissier' });
  assert.deepEqual(parseIngredientLine('0.48 l Eau'), { raw: '0.48 l Eau', qty: 0.48, unit: 'l', name: 'eau' });
});

test('unité en toutes lettres seulement suivie de « de »', () => {
  assert.equal(parseIngredientLine("2 gousses d'ail hachées").unit, 'gousses');
  assert.equal(parseIngredientLine('1 noix de beurre').name, 'beurre');
  assert.deepEqual(parseIngredientLine('3 noix').name, 'noix');
});

test('sans quantité, fractions, parenthèses, alternatives', () => {
  assert.deepEqual(parseIngredientLine('sel').qty, null);
  assert.equal(parseIngredientLine('½ citron').qty, 0.5);
  assert.equal(parseIngredientLine('1/2 l de lait (entier de préférence)').name, 'lait');
  assert.equal(parseIngredientLine('50 g de beurre pour le moule').name, 'beurre');
  assert.equal(parseIngredientLine('quelques feuilles de basilic').name, 'feuilles de basilic');
});

test('ingrédient de base', () => {
  assert.equal(base("2 gousses d'ail hachées"), 'ail');
  assert.equal(base('3 oeufs'), 'oeuf');
  assert.equal(base('2 jaunes d’œufs'), 'oeuf');
  assert.equal(base('6 pommes de terre'), 'pomme de terre');
  assert.equal(base('2 pommes'), 'pomme');
  assert.equal(base('150 g de tomates pelée en morceaux'), 'tomate');
  assert.equal(base('70 g de blancs de poulet'), 'poulet');
  assert.equal(base('1 gros oignon'), 'oignon');
  assert.equal(base('250 g de pâtes'), 'pâtes');
  assert.equal(base('1 rouleau de pâte brisée'), 'pâte brisée');
  assert.equal(base('2 poireaux'), 'poireau');
  assert.equal(base("1 c. à soupe d'huile d'olive"), "huile d'olive");
  assert.equal(base('20 cl de lait de coco'), 'lait de coco');
  assert.equal(base('2 pâtes feuilletées'), 'pâte feuilletée');
  assert.equal(base('800 g de noix de saint-jacques surgelées'), 'saint-jacques');
  assert.equal(base('65 g de cerneaux de noix'), 'noix');
  assert.equal(base('1 moules à cake'), null);
  assert.equal(base('1 truc introuvable'), undefined);
  // « X de Y » ambigu : laissé à Claude ; compléments sûrs acceptés.
  assert.equal(base("1 c. à café d'eau de fleur d'oranger"), "fleur d'oranger");
  assert.equal(base("2 cl d'eau de vie"), undefined);
  assert.equal(base('2 œufs de saumon'), undefined);
  assert.equal(base('100 g de sucre en poudre'), 'sucre');
  assert.equal(base('50 g de beurre à température ambiante'), 'beurre');
  assert.equal(base('1 noisette de beurre'), 'beurre');
  assert.equal(base('200 g de champignons de Paris frais'), 'champignon');
  assert.equal(resolveBase('décoration', new Map([['decoration', null]])), null);
});
