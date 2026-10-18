import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtQty, fmtTime, scaleLine } from './format.ts';

test('quantités recalculées lisibles', () => {
  assert.equal(fmtQty(0.33, null), '⅓');
  assert.equal(fmtQty(0.2, 'sachet'), '¼');
  assert.equal(fmtQty(1.33, null), '1 ⅓');
  assert.equal(fmtQty(0.95, null), '1');
  assert.equal(fmtQty(83.3, 'g'), '85');
  assert.equal(fmtQty(33.3, 'g'), '33');
  assert.equal(fmtQty(0.48, 'l'), '0,5');
});

test('ligne d’ingrédient mise à l’échelle', () => {
  assert.equal(scaleLine('3 oeufs', 3, null, 2 / 6), '1 oeufs');
  assert.equal(scaleLine('250 g de farine', 250, 'g', 0.5), '125 g de farine');
  assert.equal(scaleLine('sel', null, null, 0.5), 'sel');
  assert.equal(scaleLine('½ citron', 0.5, null, 2), '1 citron');
});

test('durées', () => {
  assert.equal(fmtTime(45), '45 min');
  assert.equal(fmtTime(80), '1 h 20');
  assert.equal(fmtTime(120), '2 h');
  assert.equal(fmtTime(0), '—');
});
