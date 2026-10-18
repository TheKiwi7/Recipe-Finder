import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withGenerics } from './generic.ts';

test('un fromage, une viande ou un poisson du stock satisfait la base générique', () => {
  const out = withGenerics(new Set(['gruyère', 'filet de porc', 'oeuf']));
  assert.ok(out.has('fromage'));
  assert.ok(out.has('viande'));
  assert.ok(!out.has('poisson'));
  assert.ok(withGenerics(new Set(['pavé de saumon'])).has('poisson'));
  assert.ok(!withGenerics(new Set(['lait', 'beurre'])).has('fromage'));
});
