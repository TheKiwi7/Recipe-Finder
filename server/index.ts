import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DATA_DIR, openDb } from './db.ts';
import { createApi } from './app.ts';
import { acquireImportLock, currentTarget, releaseImportLock, runImport } from './catalog/importer.ts';
import { migrateCatalog, syncSeed } from './catalog/store.ts';
import { ensureStaples } from './pantry.ts';
import { maybeUpdateProfile } from './profile.ts';

export const PORT = Number(process.env.PORT ?? 5317);
const CLIENT_DIST = join(DATA_DIR, '..', 'client', 'dist');

const db = openDb();
syncSeed(db);
migrateCatalog(db);
ensureStaples(db);

let importing = false;
// Mise à jour du profil en tâche de fond : vérifiée après chaque signal et toutes les 30 min (≥ 10 signaux, ≤ 1 / jour).
const checkProfile = () => { void maybeUpdateProfile(db); };
const app = new Hono();
app.route('/api', createApi(db, { importing: () => importing, preferencesChanged: checkProfile }));
setInterval(checkProfile, 30 * 60 * 1000);
checkProfile();

if (existsSync(CLIENT_DIST)) {
  const root = relative(process.cwd(), CLIENT_DIST);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' })); // routes côté client
}

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, info => console.log(`Recipe Finder sur http://127.0.0.1:${info.port}`));

// Import en tâche de fond : compléter le catalogue initial, puis ~100 recettes par semaine.
async function backgroundImport() {
  if (importing || process.env.RF_NO_IMPORT || !acquireImportLock()) return;
  const target = currentTarget(db);
  importing = true;
  try {
    await runImport(db, { target, log: m => console.log(`[import] ${m}`) });
  } catch (e) {
    console.error('[import]', e);
  } finally {
    importing = false;
    releaseImportLock();
  }
}
void backgroundImport();
setInterval(backgroundImport, 3600 * 1000);
