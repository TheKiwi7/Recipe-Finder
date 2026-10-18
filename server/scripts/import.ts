// Import du catalogue en ligne de commande : npm run import -- [--target 3000] [--normalize-only]
// Reprend là où il s'était arrêté. Ctrl+C pour arrêter proprement.
import { parseArgs } from 'node:util';
import { openDb } from '../db.ts';
import { importProgress, runImport } from '../catalog/importer.ts';
import { resolveUnknownTerms } from '../catalog/normalize-unknown.ts';
import { syncSeed } from '../catalog/store.ts';

const { values } = parseArgs({ options: { target: { type: 'string', default: '3000' }, 'normalize-only': { type: 'boolean', default: false } } });
const db = openDb();
syncSeed(db);
const target = Number(values.target);

if (values['normalize-only']) {
  while ((await resolveUnknownTerms(db)) > 0) console.log('lot normalisé…');
  console.log(importProgress(db, target));
  process.exit(0);
}

const ctrl = new AbortController();
process.on('SIGINT', () => { console.log('\nArrêt demandé, fin de la requête en cours…'); ctrl.abort(); });

await runImport(db, {
  target,
  signal: ctrl.signal,
  log: m => console.log(`\n${m}`),
  onProgress: p => {
    process.stdout.write(`\r${p.imported}/${p.target} importées · ${p.rejected} écartées · ${p.unresolvedRecipes} en attente de normalisation · ${(p.last ?? '').slice(0, 40).padEnd(40)}`);
  },
});
console.log('\n', importProgress(db, target));
