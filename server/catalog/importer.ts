import { ClaudeUnavailable } from '../claude.ts';
import { getMeta, loadAliases, setMeta, type Db } from '../db.ts';
import { resolveUnknownTerms } from './normalize-unknown.ts';
import { parseRecipePage, passesQuality } from './recipe.ts';
import { saveRecipe } from './store.ts';

// Usage strictement personnel : une requête toutes les ~2,5 s, uniquement des pages autorisées par robots.txt.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DELAY_MS = 2500;
const SITEMAP_INDEX = 'https://www.marmiton.org/wsitemap_recipes_index.xml';
// robots.txt de Marmiton autorise /recettes/recette_* (bloque impression, recherche et /recipe*).
const RECIPE_URL = /^https:\/\/www\.marmiton\.org\/recettes\/recette_[^/?#]+\.aspx$/;
/** Nombre de termes inconnus accumulés avant d'appeler Claude. */
const UNKNOWN_BATCH = 150;

export type ImportProgress = {
  imported: number;
  target: number;
  rejected: number;
  pending: number;
  unresolvedRecipes: number;
  last?: string;
};

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>(res => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, signal: AbortSignal.timeout(30_000) });
  return { status: res.status, body: res.status === 200 ? await res.text() : '' };
}

/** Remplit la file avec toutes les URLs de recettes du sitemap, dans un ordre aléatoire. Une seule fois. */
async function seedQueue(db: Db, signal?: AbortSignal): Promise<void> {
  if (getMeta(db, 'marmiton_queue_seeded')) return;
  const index = await fetchText(SITEMAP_INDEX);
  const sitemaps = [...index.body.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map(m => m[1]);
  const insert = db.prepare(`INSERT OR IGNORE INTO crawl_queue (url, source, position) VALUES (?, 'marmiton', ?)`);
  for (const sm of sitemaps) {
    if (signal?.aborted) return;
    await sleep(DELAY_MS, signal);
    const { body } = await fetchText(sm);
    const urls = [...body.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)].map(m => m[1]).filter(u => RECIPE_URL.test(u));
    db.exec('BEGIN');
    for (const u of urls) insert.run(u, Math.floor(Math.random() * 1e9));
    db.exec('COMMIT');
  }
  setMeta(db, 'marmiton_queue_seeded', new Date().toISOString());
}

export function importProgress(db: Db, target: number): ImportProgress {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return {
    imported: count('SELECT COUNT(*) n FROM recipes'),
    target,
    rejected: count(`SELECT COUNT(*) n FROM crawl_queue WHERE status = 'rejected'`),
    pending: count(`SELECT COUNT(*) n FROM crawl_queue WHERE status = 'pending'`),
    unresolvedRecipes: count('SELECT COUNT(*) n FROM recipes WHERE unresolved > 0'),
  };
}

async function flushUnknown(db: Db, force: boolean, log: (m: string) => void): Promise<void> {
  const n = (db.prepare('SELECT COUNT(*) n FROM unknown_terms').get() as { n: number }).n;
  if (n === 0 || (!force && n < UNKNOWN_BATCH)) return;
  try {
    const done = await resolveUnknownTerms(db);
    log(`Claude a normalisé ${done} termes inconnus`);
  } catch (e) {
    // Claude indisponible : on réessaiera au prochain lot, l'import continue.
    log(`Normalisation reportée (${e instanceof ClaudeUnavailable ? e.message : String(e)})`);
  }
}

/**
 * Importe des recettes jusqu'à atteindre `target` recettes en base. Reprend là où il s'était arrêté.
 * S'arrête proprement quand `signal` est annulé.
 */
export async function runImport(db: Db, opts: { target: number; signal?: AbortSignal; onProgress?: (p: ImportProgress) => void; log?: (m: string) => void }): Promise<void> {
  const log = opts.log ?? (() => {});
  await seedQueue(db, opts.signal);
  const next = db.prepare(`SELECT url FROM crawl_queue WHERE status = 'pending' ORDER BY position LIMIT 1`);
  const mark = db.prepare(`UPDATE crawl_queue SET status = ?, reason = ?, fetched_at = ? WHERE url = ?`);
  let aliases = loadAliases(db);
  let backoff = 0;

  while (!opts.signal?.aborted) {
    const p = importProgress(db, opts.target);
    if (p.imported >= opts.target) break;
    const row = next.get() as { url: string } | undefined;
    if (!row) { log('Plus aucune URL à importer'); break; }

    await sleep(DELAY_MS + backoff, opts.signal);
    if (opts.signal?.aborted) break;
    const now = new Date().toISOString();
    let last: string | undefined;
    try {
      const { status, body } = await fetchText(row.url);
      if (status === 404 || status === 410) mark.run('gone', String(status), now, row.url);
      else if (status === 429 || status >= 500) { backoff = Math.min(backoff * 2 || 30_000, 600_000); log(`HTTP ${status}, pause de ${backoff / 1000} s`); continue; }
      else if (status !== 200) mark.run('error', `HTTP ${status}`, now, row.url);
      else {
        backoff = 0;
        const recipe = parseRecipePage(body, row.url, 'marmiton');
        if (!recipe) mark.run('rejected', 'pas de recette', now, row.url);
        else if (!passesQuality(recipe)) mark.run('rejected', `note ${recipe.rating} (${recipe.reviews} avis)`, now, row.url);
        else {
          saveRecipe(db, recipe, aliases);
          mark.run('imported', null, now, row.url);
          last = recipe.name;
        }
      }
    } catch (e) {
      mark.run('error', String(e).slice(0, 200), now, row.url);
    }

    const before = (db.prepare('SELECT COUNT(*) n FROM unknown_terms').get() as { n: number }).n;
    if (before >= UNKNOWN_BATCH) { await flushUnknown(db, false, log); aliases = loadAliases(db); }
    opts.onProgress?.({ ...importProgress(db, opts.target), last });
  }
  if (!opts.signal?.aborted) { await flushUnknown(db, true, log); }
}
