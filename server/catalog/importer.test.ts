import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setMeta } from '../db.ts';
import { runImport } from './importer.ts';

const page = (name: string) => `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Recipe', name, image: 'https://img/big.jpg',
  recipeCategory: 'Plat principal', recipeYield: '4 personnes', prepTime: 'PT20M', cookTime: 'PT1H', totalTime: 'PT1H20M',
  recipeIngredient: ['1 kg de pommes de terre', '50 cl de crème fraîche'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Éplucher les pommes de terre.' }],
  aggregateRating: { ratingValue: '4.6', reviewCount: '120' },
})}</script></head><body></body></html>`;

test('arrêt pendant la lecture d’une recette : elle est enregistrée en entier, les suivantes restent en file', async () => {
  const db = openDb(':memory:');
  setMeta(db, 'marmiton_queue_seeded', new Date().toISOString()); // pas de lecture du sitemap
  const urls = [1, 2, 3].map(i => `https://www.marmiton.org/recettes/recette_gratin-${i}_${i}.aspx`);
  urls.forEach((u, i) => db.prepare(`INSERT INTO crawl_queue (url, source, position) VALUES (?, 'marmiton', ?)`).run(u, i));

  const ctrl = new AbortController();
  const realFetch = globalThis.fetch;
  let fetched = 0;
  // « Arrêter » est cliqué pendant que la première page se télécharge.
  globalThis.fetch = (async () => { fetched++; ctrl.abort(); return new Response(page('Gratin dauphinois'), { status: 200 }); }) as typeof fetch;
  try {
    await runImport(db, { target: 100, signal: ctrl.signal });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(fetched, 1);
  const saved = db.prepare('SELECT name, ingredients, steps FROM recipes').all() as Array<{ name: string; ingredients: string; steps: string }>;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Gratin dauphinois');
  assert.equal(JSON.parse(saved[0].ingredients).length, 2);
  assert.equal(JSON.parse(saved[0].steps).length, 1);
  const status = Object.fromEntries((db.prepare('SELECT url, status FROM crawl_queue').all() as Array<{ url: string; status: string }>).map(r => [r.url, r.status]));
  assert.deepEqual(status, { [urls[0]]: 'imported', [urls[1]]: 'pending', [urls[2]]: 'pending' });
});
