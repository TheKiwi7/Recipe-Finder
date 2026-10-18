import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { existsSync, openSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DATA_DIR, openDb } from './db.ts';
import { createApi } from './app.ts';
import { acquireImportLock, currentTarget, getCatalogTarget, releaseImportLock, runImport } from './catalog/importer.ts';
import { migrateCatalog, syncSeed } from './catalog/store.ts';
import { ensureStaples } from './pantry.ts';
import { ensureSelf } from './members.ts';
import { maybeUpdateProfile } from './profile.ts';
import { abortAllAI, ensureOllama, initAI, ollamaExe, releaseOllama, removeOllamaAutostart } from './ai.ts';
import { L, lang, loadLang, prefillTranslations } from './i18n.ts';
import { isFromApp } from './guard.ts';
import { applyUpdate, checkForUpdate } from './update.ts';

export const PORT = Number(process.env.PORT ?? 5317);
const CLIENT_DIST = join(DATA_DIR, '..', 'client', 'dist');

// Relancé après une mise à jour : on attend que l'ancien serveur ait libéré le port.
if (process.env.RF_AFTER_UPDATE) {
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/ping`, { signal: AbortSignal.timeout(500) }); } catch { break; }
    await new Promise(r => setTimeout(r, 250));
  }
}

const db = openDb();
loadLang(db);
initAI(db);
syncSeed(db);
migrateCatalog(db);
ensureStaples(db);
ensureSelf(db);

let importing = false;
// Mise à jour du profil en tâche de fond : vérifiée après chaque signal et toutes les 30 min (≥ 10 signaux, ≤ 1 / heure).
const checkProfile = () => { void maybeUpdateProfile(db); };
const app = new Hono();

// ---------- l'app vit tant qu'une de ses pages est ouverte ----------
// Chaque page (onglet, fenêtre) a un identifiant : elle donne signe de vie (toutes les 20 s, au plus une fois
// par minute quand le navigateur ralentit un onglet caché) et prévient en se fermant. Le serveur s'arrête, avec
// tout ce qu'il a lancé (import, requêtes IA, Ollama), quand plus aucune page n'est ouverte.
const IDLE_MS = 3 * 60_000;     // page disparue sans prévenir (plantage du navigateur, veille du PC…)
const BYE_GRACE_MS = 20_000;    // un rechargement prévient aussi : on attend de voir si la page revient
let lastSeen = Date.now();
let byeAt = 0;
const pages = new Map<string, number>();
const pageId = (raw: string | undefined) => (raw ?? '').slice(0, 64) || 'anon'; // interface d'avant les identifiants

// L'API ne répond qu'à l'app elle-même (ni aux sites tiers, ni via DNS rebinding) : voir guard.ts.
app.use('/api/*', async (c, next) => {
  if (!isFromApp(c.req.header('Host'), c.req.header('Origin'), c.req.header('Sec-Fetch-Site'))) return c.json({ error: 'Forbidden' }, 403);
  await next();
});

app.use('/api/*', async (c, next) => { if (c.req.path !== '/api/bye') lastSeen = Date.now(); await next(); });
app.post('/api/bye', c => { pages.delete(pageId(c.req.query('page'))); byeAt = Date.now(); return c.json({ ok: true }); });
app.get('/api/ping', c => { pages.set(pageId(c.req.query('page')), Date.now()); return c.json({ ok: true }); });
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
  for (const [id, at] of pages) if (now - at > IDLE_MS) pages.delete(id);
  if (pages.size > 0) return; // au moins une page encore ouverte (fermer un autre onglet ne coupe rien)
  if (byeAt > 0 && now - Math.max(byeAt, lastSeen) > BYE_GRACE_MS) void shutdown('fenêtre fermée');
  else if (now - lastSeen > IDLE_MS) void shutdown('plus de fenêtre ouverte');
}, 10_000);
// Ollama installé : démarré en arrière-plan (sans fenêtre) pour que le modèle local soit disponible.
if (ollamaExe()) { removeOllamaAutostart(); void ensureOllama(); }
// Identifiant de la version de l'interface construite : l'app compare et propose de recharger quand il change.
const clientBuild = () => { try { return String(statSync(join(CLIENT_DIST, 'index.html')).mtimeMs); } catch { return 'dev'; } };
app.route('/api', createApi(db, { importing: () => importing, preferencesChanged: checkProfile, build: clientBuild, startImport: () => { void backgroundImport(); }, languageChanged: () => { void backgroundTranslate(); }, update: () => { void applyUpdate(restartServer); } }));
// Route d'API inconnue : JSON 404, jamais la page HTML (sinon le client croit recevoir des données vides).
app.all('/api/*', c => c.json({ error: L('Route inconnue — relance l’app pour mettre le serveur à jour', 'Unknown route — restart the app to update the server') }, 404));
setInterval(checkProfile, 30 * 60 * 1000);
checkProfile();

if (existsSync(CLIENT_DIST)) {
  const root = relative(process.cwd(), CLIENT_DIST);
  // index.html jamais mis en cache (il pointe vers les fichiers de la version courante) ; /assets/ est versionné.
  app.use('/*', async (c, next) => { await next(); if (!c.req.path.startsWith('/assets/')) c.header('Cache-Control', 'no-cache'); });
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' })); // routes côté client
}

const httpServer = serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, info => console.log(`Recipe Finder sur http://127.0.0.1:${info.port}`));

// ---------- mises à jour (git) ----------
// Vérifiées peu après le démarrage puis toutes les 6 h ; installées à la demande depuis les Réglages.
setTimeout(() => { void checkForUpdate(); }, 30_000);
setInterval(() => { void checkForUpdate(); }, 6 * 3600 * 1000);

/** Après une mise à jour : un nouveau serveur (nouveau code) prend le relais, détaché de celui-ci, qui s'arrête. */
function restartServer(): void {
  importCtrl.abort();
  abortAllAI();
  const out = openSync(join(DATA_DIR, 'server.log'), 'a');
  const err = openSync(join(DATA_DIR, 'server-errors.log'), 'a');
  spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    cwd: process.cwd(), detached: true, windowsHide: true, stdio: ['ignore', out, err], env: { ...process.env, RF_AFTER_UPDATE: '1' },
  }).unref();
  httpServer.close();
  releaseImportLock();
  setTimeout(() => process.exit(0), 300);
}

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
// Après une mise à jour, l'ancien serveur libère le verrou d'import en s'arrêtant : on lui laisse un instant.
setTimeout(() => { void backgroundImport(); }, process.env.RF_AFTER_UPDATE ? 5_000 : 0);
setInterval(backgroundImport, 3600 * 1000);

// App en anglais : vocabulaire et noms de recettes traduits d'avance (nouvelles recettes comprises), en tâche de fond.
let translating = false;
async function backgroundTranslate() {
  if (translating || lang() === 'fr') return;
  translating = true;
  try {
    await prefillTranslations(db, m => console.log(`[traduction] ${m}`), () => stopping || lang() === 'fr');
  } catch (e) {
    console.error('[traduction]', (e as Error).message);
  } finally {
    translating = false;
  }
}
setTimeout(backgroundTranslate, 20_000);
setInterval(backgroundTranslate, 15 * 60 * 1000);
