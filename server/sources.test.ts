import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Garde-fou : un caractère de contrôle (ex. \b devenu « backspace ») casse silencieusement une regex.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : files(p);
    return /\.(ts|tsx|css)$/.test(f) ? [p] : [];
  });
}

test('aucun caractère de contrôle dans le code source', () => {
  const root = join(import.meta.dirname, '..');
  const bad = [...files(join(root, 'server')), ...files(join(root, 'client', 'src'))]
    .filter(f => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});
