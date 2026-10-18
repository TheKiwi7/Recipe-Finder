import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFromApp } from './guard.ts';

test("l'app et les outils locaux passent", () => {
  assert.equal(isFromApp('127.0.0.1:5317', 'http://127.0.0.1:5317', 'same-origin'), true);
  assert.equal(isFromApp('localhost:5318', 'http://localhost:5318', 'same-origin'), true); // npm run dev (proxy Vite)
  assert.equal(isFromApp('127.0.0.1:5317', undefined, undefined), true);                   // curl
});

test('les autres sites sont refusés', () => {
  assert.equal(isFromApp('127.0.0.1:5317', 'https://evil.example', 'cross-site'), false); // POST « simple » d'un site tiers
  assert.equal(isFromApp('127.0.0.1:5317', 'https://evil.example', undefined), false);
  assert.equal(isFromApp('127.0.0.1:5317', undefined, 'cross-site'), false);
  assert.equal(isFromApp('127.0.0.1:5317', 'null', undefined), false);                    // iframe sandboxée
  assert.equal(isFromApp('evil.example:5317', undefined, undefined), false);              // DNS rebinding
  assert.equal(isFromApp(undefined, undefined, undefined), false);
});
