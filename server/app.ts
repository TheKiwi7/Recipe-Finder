import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { getCatalogTarget, importProgress, setCatalogTarget } from './catalog/importer.ts';
import {
  addPantryItem, confirmPantry, deletePantryItem, listPantry, listStaples, pantryState, setStaples, suggestIngredients, updatePantryItem,
} from './pantry.ts';
import { banIngredient, favorites, imagePath, recipeDetail, recommend, rejections, setReaction } from './reco/service.ts';
import type { Mode } from './reco/rank.ts';
import { DEFAULT_QUESTIONNAIRE, getQuestionnaire, getWeights, OPTIONAL_EQUIPMENT, questionnaireDiff, recordSignal, setQuestionnaire, type Questionnaire } from './preferences.ts';
import { maybeUpdateProfile, profileStatus, profileText } from './profile.ts';
import { askAboutRecipe, ChatError, chatHistory } from './chat.ts';
import { exportData } from './export.ts';
import { addMember, deleteMember, eaterIds, listMembers, setEaters, updateMember } from './members.ts';
import { askProvider, claudeStatus, cooldownOf, invalidateLocalStatus, localStatus, route, type Provider } from './ai.ts';
import { connectClaude, setupLocal, setupTask } from './setup.ts';
import { setMeta } from './db.ts';

/** Modèles locaux proposés (Ollama) : le 12B par défaut, le 4B pour les PC sans grosse carte graphique. */
const LOCAL_MODELS = [
  { id: 'gemma3:12b', label: 'Gemma 3 12B', size: '8 Go', hint: 'recommandé avec une carte graphique de 12 Go ou plus' },
  { id: 'gemma3:4b', label: 'Gemma 3 4B', size: '3 Go', hint: 'plus léger, pour une petite carte graphique ou sans carte graphique' },
];

const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

/** Change à chaque démarrage du serveur : l'app recalcule alors ses listes (règles ou catalogue ont pu changer). */
const SERVER_STARTED = new Date().toISOString();

export function createApi(db: Db, status: { importing: () => boolean; preferencesChanged: () => void; build: () => string; startImport: () => void }) {
  const api = new Hono();

  api.onError((err, c) => c.json({ error: err.message }, 400));

  api.get('/pantry', c => c.json({ items: listPantry(db), staples: listStaples(db), ...pantryState(db) }));
  api.post('/pantry', async c => c.json(addPantryItem(db, await c.req.json())));
  api.patch('/pantry/:id', async c => { updatePantryItem(db, Number(c.req.param('id')), await c.req.json()); return c.json({ ok: true }); });
  api.delete('/pantry/:id', c => { deletePantryItem(db, Number(c.req.param('id'))); return c.json({ ok: true }); });
  api.put('/staples', async c => { setStaples(db, (await c.req.json()).staples); return c.json({ staples: listStaples(db) }); });
  api.post('/pantry/confirm', c => { confirmPantry(db); return c.json(pantryState(db)); });
  api.get('/ingredients/suggest', c => c.json(suggestIngredients(db, c.req.query('q') ?? '')));

  api.post('/recommendations', async c => {
    const body = await c.req.json() as { mode: Mode; filters?: { type?: string; maxTime?: number }; current?: number[]; want?: number };
    if (body.mode !== 'ready' && body.mode !== 'almost') throw new Error('mode invalide');
    return c.json(recommend(db, { mode: body.mode, filters: body.filters ?? {}, current: body.current ?? [], want: Math.min(500, body.want ?? 10) }));
  });
  api.get('/recipes/:id', c => {
    const r = recipeDetail(db, Number(c.req.param('id')));
    return r ? c.json(r) : c.json({ error: 'Recette introuvable' }, 404);
  });
  api.post('/recipes/:id/reaction', async c => {
    await setReaction(db, Number(c.req.param('id')), (await c.req.json()).kind ?? null);
    status.preferencesChanged();
    return c.json({ ok: true });
  });
  api.get('/favorites', c => c.json(favorites(db)));
  api.post('/banned', async c => { banIngredient(db, (await c.req.json()).base, true); status.preferencesChanged(); return c.json({ ok: true }); });
  api.delete('/banned/:base', c => { banIngredient(db, decodeURIComponent(c.req.param('base')), false); return c.json({ ok: true }); });
  api.get('/rejections', c => c.json(rejections(db)));

  api.get('/images/:file', c => {
    const file = c.req.param('file');
    const p = imagePath(file);
    if (!p) return c.json({ error: 'Image introuvable' }, 404);
    return c.body(readFileSync(p), 200, { 'Content-Type': MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'max-age=31536000' });
  });

  api.get('/import/status', c => c.json({ ...importProgress(db, getCatalogTarget(db)), running: status.importing(), build: status.build(), server: SERVER_STARTED }));
  // « Ajouter des recettes » (Réglages) : relève l'objectif et lance l'import tout de suite.
  api.post('/import/more', async c => {
    const add = Math.max(0, Math.min(10_000, Math.round(Number((await c.req.json()).add) || 0)));
    const { imported } = importProgress(db, 0);
    setCatalogTarget(db, Math.max(getCatalogTarget(db), imported) + add);
    status.startImport();
    return c.json({ ...importProgress(db, getCatalogTarget(db)), running: true });
  });

  api.get('/questionnaire', c => c.json({ questionnaire: getQuestionnaire(db), defaults: DEFAULT_QUESTIONNAIRE, equipment: OPTIONAL_EQUIPMENT }));
  api.put('/questionnaire', async c => {
    const q = { ...DEFAULT_QUESTIONNAIRE, ...(await c.req.json()) } as Questionnaire;
    q.persons = Math.max(1, Math.min(20, Math.round(Number(q.persons) || 2)));
    q.maxTime = Math.max(5, Math.min(600, Math.round(Number(q.maxTime) || 45)));
    const before = getQuestionnaire(db);
    setQuestionnaire(db, q);
    // Une modification du questionnaire est un signal pour le profil (ex. nouvelles notes sur les goûts).
    if (before && JSON.stringify(before) !== JSON.stringify(q)) recordSignal(db, 'questionnaire', questionnaireDiff(before, q));
    status.preferencesChanged();
    return c.json({ questionnaire: getQuestionnaire(db) });
  });

  api.get('/profile', c => c.json(profileStatus(db)));
  // Le profil rédigé par l'IA et les réglages qu'elle en a tirés (bouton « Voir mon profil »).
  api.get('/profile/details', c => c.json({ text: profileText(db), weights: getWeights(db) }));
  api.post('/profile/update', async c => c.json({ result: await maybeUpdateProfile(db, true), ...profileStatus(db) }));

  api.get('/recipes/:id/chat', c => c.json(chatHistory(db, Number(c.req.param('id')))));
  api.post('/recipes/:id/chat', async c => {
    try {
      return c.json(await askAboutRecipe(db, Number(c.req.param('id')), (await c.req.json()).message ?? ''));
    } catch (e) {
      if (e instanceof ChatError) return c.json({ error: e.message }, e.message.startsWith('Claude') ? 503 : 400);
      throw e;
    }
  });

  // ---------- intelligence artificielle : état, installation, connexion, test ----------
  api.get('/ai/status', async c => {
    const [claude, local, interactive, background] = await Promise.all([claudeStatus(), localStatus(), route('interactive'), route('background')]);
    return c.json({ claude, local, routing: { interactive: interactive[0] ?? null, background: background[0] ?? null }, task: setupTask(), localModels: LOCAL_MODELS, paused: { claude: cooldownOf('claude'), local: cooldownOf('local') } });
  });
  api.post('/ai/claude/connect', c => { void connectClaude(); return c.json({ task: setupTask() }); });
  api.post('/ai/local/setup', c => { void setupLocal(); return c.json({ task: setupTask() }); });
  api.put('/ai/local/model', async c => {
    const model = String((await c.req.json()).model ?? '');
    if (!LOCAL_MODELS.some(m => m.id === model)) throw new Error('Modèle inconnu');
    setMeta(db, 'local_model', model);
    invalidateLocalStatus();
    return c.json({ local: await localStatus() });
  });
  api.post('/ai/test', async c => {
    const provider = (await c.req.json()).provider as Provider;
    const started = Date.now();
    try {
      const reply = await askProvider(provider, 'Réponds uniquement « OK ».', { tier: 'light', lane: 'interactive', timeoutMs: 120_000 });
      return c.json({ ok: true, ms: Date.now() - started, reply: reply.trim().slice(0, 80) });
    } catch (e) {
      return c.json({ ok: false, ms: Date.now() - started, error: (e as Error).message.slice(0, 300) });
    }
  });

  // ---------- pour qui je cuisine ----------
  api.get('/members', c => c.json({ members: listMembers(db), eaters: eaterIds(db) }));
  api.post('/members', async c => c.json(addMember(db, String((await c.req.json()).name ?? ''))));
  api.patch('/members/:id', async c => { updateMember(db, Number(c.req.param('id')), await c.req.json()); return c.json({ members: listMembers(db) }); });
  api.delete('/members/:id', c => { deleteMember(db, Number(c.req.param('id'))); return c.json({ members: listMembers(db), eaters: eaterIds(db) }); });
  api.put('/eaters', async c => { setEaters(db, (await c.req.json()).ids ?? []); return c.json({ eaters: eaterIds(db) }); });

  api.get('/export', c => c.json(exportData(db), 200, { 'Content-Disposition': `attachment; filename="recipe-finder-${new Date().toISOString().slice(0, 10)}.json"` }));

  return api;
}
