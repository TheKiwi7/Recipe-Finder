// Import du catalogue en ligne de commande : npm run import -- [--target 3000] [--normalize-only] [--renormalize-ignored] [--consolidate] [--requeue-rated]
// Reprend là où il s'était arrêté. Ctrl+C pour arrêter proprement.
import { parseArgs } from 'node:util';
import { openDb } from '../db.ts';
import { acquireImportLock, importProgress, runImport } from '../catalog/importer.ts';
import { consolidateBases, requeueSuspiciousAliases, resolveUnknownTerms } from '../catalog/normalize-unknown.ts';
import { migrateCatalog, reresolveRecipes, syncSeed } from '../catalog/store.ts';

const { values } = parseArgs({ options: { target: { type: 'string', default: '3000' }, 'normalize-only': { type: 'boolean', default: false }, 'renormalize-ignored': { type: 'boolean', default: false }, consolidate: { type: 'boolean', default: false }, 'requeue-rated': { type: 'boolean', default: false } } });
const db = openDb();
syncSeed(db);
migrateCatalog(db);
let target = Number(values.target);

if (values['requeue-rated']) {
  // Remet en tête de file les pages écartées pour « trop peu d'avis » mais notées ≥ 4/5 (règle Q34 révisée)
  // et vise autant de recettes en plus.
  const rows = db.prepare(`SELECT url, reason FROM crawl_queue WHERE status = 'rejected'`).all() as Array<{ url: string; reason: string | null }>;
  const requeue = db.prepare(`UPDATE crawl_queue SET status = 'pending', reason = NULL, position = ? WHERE url = ?`);
  let n = 0;
  db.exec('BEGIN');
  for (const r of rows) {
    const m = r.reason?.match(/^note ([\d.]+) /);
    if (m && parseFloat(m[1]) >= 4) requeue.run(-1 - n++, r.url);
  }
  db.exec('COMMIT');
  target = importProgress(db, 0).imported + n;
  console.log(`${n} pages remises en file, objectif ${target} recettes`);
}

if (values.consolidate) {
  // Fusionne les ingrédients de base en double (« blanc de poulet » / « poulet »).
  const merged = await consolidateBases(db);
  for (const [dup, canon] of merged) console.log(`  ${dup} → ${canon}`);
  console.log(`${merged.length} ingrédients fusionnés`);
  console.log(importProgress(db, target));
  process.exit(0);
}

if (values['renormalize-ignored']) {
  // Refait examiner par Claude les termes classés « pas un ingrédient » et les alias « X de Y → X » douteux.
  const n = db.prepare(`DELETE FROM ingredient_aliases WHERE origin = 'claude' AND base IS NULL`).run().changes;
  const m = requeueSuspiciousAliases(db);
  reresolveRecipes(db, true);
  console.log(`${n} termes ignorés et ${m} alias « X de Y → X » remis en file pour Claude`);
}

if (values['normalize-only'] || values['renormalize-ignored']) {
  while ((await resolveUnknownTerms(db)) > 0) console.log('lot normalisé…');
  console.log(importProgress(db, target));
  process.exit(0);
}

if (!acquireImportLock()) {
  console.log("Un import est déjà en cours (probablement dans l'app).");
  process.exit(1);
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
