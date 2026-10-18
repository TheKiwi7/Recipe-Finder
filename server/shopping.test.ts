import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shoppingNeeds, unitInfo } from './shopping.ts';
import type { IngredientLine } from './catalog/ingredients.ts';
import type { PantryItem } from './pantry.ts';

const line = (base: string, qty: number | null, unit: string | null): IngredientLine => ({ raw: '', qty, unit, name: base, base });
const stock = (base: string, qty: number | null, unit: string | null): PantryItem => ({ id: 0, label: base, base, qty, unit, urgent: false, showBase: false });

test('unités : masse, volume, cuillères, pièces, contenants', () => {
  assert.deepEqual(unitInfo('kg'), { family: 'mass', factor: 1000 });
  assert.deepEqual(unitInfo('cl'), { family: 'volume', factor: 10 });
  assert.deepEqual(unitInfo('cuillères à soupe'), { family: 'volume', factor: 15 });
  assert.deepEqual(unitInfo('c. à café'), { family: 'volume', factor: 5 });
  assert.deepEqual(unitInfo('pièce(s)'), { family: 'count', factor: 1 });
  assert.deepEqual(unitInfo(null), { family: 'count', factor: 1 });
  assert.equal(unitInfo('sachets').family, unitInfo('sachet(s)').family);
});

test('absent du stock : tout est à acheter, pour le nombre de personnes choisi', () => {
  const needs = shoppingNeeds([line('poulet', 400, 'g'), line('oeuf', 3, null)], 1.5, [], new Set());
  assert.deepEqual(needs, [{ base: 'poulet', qty: 600, unit: 'g' }, { base: 'oeuf', qty: 5, unit: null }]); // 4,5 œufs → 5
});

test('quantité insuffisante : seulement la différence, unités converties', () => {
  const needs = shoppingNeeds([line('farine', 0.5, 'kg'), line('lait', 50, 'cl')], 1, [stock('farine', 200, 'g'), stock('lait', 1, 'l')], new Set(['farine', 'lait']));
  assert.deepEqual(needs, [{ base: 'farine', qty: 0.3, unit: 'kg' }]); // le litre de lait suffit
});

test('assez, sans quantité notée, au placard ou générique couvert : rien à acheter', () => {
  const available = new Set(['beurre', 'sel', 'fromage', 'crème fraîche']);
  const needs = shoppingNeeds(
    [line('beurre', 50, 'g'), line('sel', 1, 'pincée'), line('fromage', 100, 'g'), line('crème fraîche', 20, 'cl')],
    1, [stock('beurre', 250, 'g'), stock('crème fraîche', null, null)], available,
  );
  assert.deepEqual(needs, []);
});

test('même ingrédient sur deux lignes : quantités additionnées', () => {
  const needs = shoppingNeeds([line('sucre', 100, 'g'), line('sucre', 2, 'cuillères à soupe'), line('beurre', 50, 'g'), line('beurre', 30, 'g')], 1, [stock('beurre', 60, 'g')], new Set(['beurre']));
  assert.deepEqual(needs, [{ base: 'sucre', qty: 100, unit: 'g' }, { base: 'beurre', qty: 20, unit: 'g' }]);
});

test('unités incomparables (sachet face à des grammes) : on suppose qu’il y en a assez', () => {
  assert.deepEqual(shoppingNeeds([line('levure', 1, 'sachet')], 1, [stock('levure', 100, 'g')], new Set(['levure'])), []);
});
