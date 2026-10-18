import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DATA_DIR, openDb } from './db.ts';
import { createApi } from './app.ts';
import { acquireImportLock, currentTarget, getCatalogTarget, releaseImportLock, runImport } from './catalog/importer.ts';
import { migrateCatalog, syncSeed } from './catalog/store.ts';
import { ensureStaples } from './pantry.ts';
import { ensureSelf } from './members.ts';
import { maybeUpdateProfile } from './profile.ts';
import { abortAllAI, ensureOllama, initAI, ollamaExe, releaseOllama } from './ai.ts';

export const PORT = Number(process.env.PORT ?? 5317);
const CLIENT_DIST = join(DATA_DIR, '..', 'client', 'dist');

const db = openDb();
initAI(db);
syncSeed(db);
migrateCatalog(db);
ensureStaples(db);
ensureSelf(db);

let importing = false;
// Mise à jour du profil en tâche de fond : vérifiée après chaque signal et toutes les 30 min (≥ 10 signaux, ≤ 1 / heure).
const checkProfile = () => { void maybeUpdateProfile(db); };
const app = new Hono();

// ---------- l'app vit tant que sa fenêtre est ouverte ----------
// L'interface donne signe de vie (elle interroge le serveur toutes les 15 s) et prévient à la fermeture.
// Sans nouvelles, le serveur s'arrête et arrête tout ce qu'il a lancé (import, requêtes IA, Ollama).
const IDLE_MS = 3 * 60_000;     // fenêtre fermée sans prévenir, ou navigateur qui ralentit les onglets cachés
const BYE_GRACE_MS = 20_000;    // un rechargement de page prévient aussi : on attend de voir si elle revient
let lastSeen = Date.now();
let byeAt = 0;
app.use('/api/*', async (c, next) => { if (c.req.path !== '/api/bye') lastSeen = Date.now(); await next(); });
app.post('/api/bye', c => { byeAt = Date.now(); return c.json({ ok: true }); });
app.get('/api/ping', c => c.json({ ok: true }));
const importCtrl = new AbortController();
let stopping = false;
async function shutdown(reason: string) {
  if (stopping || process.env.RF_KEEP_ALIVE) return;
  stopping = true;
  console.log(`Arrêt de Recipe Finder (${reason})`);
  importCtrl.abort();
  abortAllAI();
  await releaseOllama();
  setTimeout(() => process.exit(0), 500);
}
setInterval(() => {
  const now = Date.now();
  if (byeAt > lastSeen && now - byeAt > BYE_GRACE_MS) void shutdown('fenêtre fermée');
  else if (now - lastSeen > IDLE_MS) void shutdown('plus de fenêtre ouverte');
}, 10_000);
// Ollama installé : démarré en arrière-plan (sans fenêtre) pour que le modèle local soit disponible.
if (ollamaExe()) void ensureOllama();
// Identifiant de la version de l'interface construite : l'app compare et propose de recharger quand il change.
const clientBuild = () => { try { return String(statSync(join(CLIENT_DIST, 'index.html')).mtimeMs); } catch { return 'dev'; } };
app.route('/api', createApi(db, { importing: () => importing, preferencesChanged: checkProfile, build: clientBuild, startImport: () => { void backgroundImport(); } }));
// Route d'API inconnue : JSON 404, jamais la page HTML (sinon le client croit recevoir des données vides).
app.all('/api/*', c => c.json({ error: 'Route inconnue — relance l’app pour mettre le serveur à jour' }, 404));
setInterval(checkProfile, 30 * 60 * 1000);
checkProfile();

if (existsSync(CLIENT_DIST)) {
  const root = relative(process.cwd(), CLIENT_DIST);
  // index.html jamais mis en cache (il pointe vers les fichiers de la version courante) ; /assets/ est versionné.
  app.use('/*', async (c, next) => { await next(); if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-cache'); });
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' })); // routes côté client
}

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, info => console.log(`Recipe Finder sur http://127.0.0.1:${info.port}`));

// Import en tâche de fond : compléter le catalogue initial, puis ~100 recettes par semaine.
async function backgroundImport() {
  if (importing || process.env.RF_NO_IMPORT || !acquireImportLock()) return;
  currentTarget(db); // relève l'objectif de 100 recettes si la croissance hebdomadaire est due
  importing = true;
  try {
    // Objectif relu en continu : l'ajout de recettes depuis les Réglages prolonge un import en cours.
    await runImport(db, { target: () => getCatalogTarget(db), signal: importCtrl.signal, log: m => console.log(`[import] ${m}`) });
  } catch (e) {
    console.error('[import]', e);
  } finally {
    importing = false;
    releaseImportLock();
  }
}
void backgroundImport();
setInterval(backgroundImport, 3600 * 1000);
