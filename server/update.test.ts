import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, newerReleases, type Release } from './update.ts';

test('comparaison de versions', () => {
  assert.ok(compareVersions('1.10.0', '1.9.3') > 0);
  assert.ok(compareVersions('v1.2.0', '1.2') === 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
});

test('notes : seulement les versions plus récentes que celle installée, la plus récente d’abord', () => {
  const r = (version: string): Release => ({ version, date: '2026-10-18', fr: [version], en: [version] });
  assert.deepEqual(newerReleases([r('1.0.0'), r('1.2.0'), r('1.1.0')], '1.0.0').map(x => x.version), ['1.2.0', '1.1.0']);
  assert.deepEqual(newerReleases([r('1.0.0')], '1.0.0'), []);
});
