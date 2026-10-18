import { Hono } from 'hono';
import type { Db } from './db.ts';
import { importProgress, INITIAL_TARGET } from './catalog/importer.ts';
import {
  addPantryItem, confirmPantry, deletePantryItem, listPantry, listStaples, pantryState, setStaples, suggestIngredients, updatePantryItem,
} from './pantry.ts';

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

  api.get('/import/status', c => c.json({ ...importProgress(db, INITIAL_TARGET), running: status.importing() }));

  return api;
}
