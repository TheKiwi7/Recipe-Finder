import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { importProgress, INITIAL_TARGET } from './catalog/importer.ts';
import {
  addPantryItem, confirmPantry, deletePantryItem, listPantry, listStaples, pantryState, setStaples, suggestIngredients, updatePantryItem,
} from './pantry.ts';
import { banIngredient, favorites, imagePath, recipeDetail, recommend, rejections, setReaction } from './reco/service.ts';
import type { Mode } from './reco/rank.ts';

const MIME: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };

export function createApi(db: Db, status: { importing: () => boolean }) {
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
    return c.json({ ok: true });
  });
  api.get('/favorites', c => c.json(favorites(db)));
  api.post('/banned', async c => { banIngredient(db, (await c.req.json()).base, true); return c.json({ ok: true }); });
  api.delete('/banned/:base', c => { banIngredient(db, decodeURIComponent(c.req.param('base')), false); return c.json({ ok: true }); });
  api.get('/rejections', c => c.json(rejections(db)));

  api.get('/images/:file', c => {
    const file = c.req.param('file');
    const p = imagePath(file);
    if (!p) return c.json({ error: 'Image introuvable' }, 404);
    return c.body(readFileSync(p), 200, { 'Content-Type': MIME[file.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'max-age=31536000' });
  });

  api.get('/import/status', c => c.json({ ...importProgress(db, INITIAL_TARGET), running: status.importing() }));

  return api;
}
