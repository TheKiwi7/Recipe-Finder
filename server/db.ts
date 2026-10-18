import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAliases } from './catalog/seed-ingredients.ts';
import { normalizeKey } from './catalog/text.ts';

export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  image TEXT,
  category_raw TEXT,
  type TEXT NOT NULL,
  total_min INTEGER NOT NULL,
  prep_min INTEGER NOT NULL,
  cook_min INTEGER NOT NULL,
  servings INTEGER NOT NULL,
  rating REAL,
  reviews INTEGER NOT NULL,
  keywords TEXT NOT NULL,      -- JSON string[]
  ingredients TEXT NOT NULL,   -- JSON IngredientLine[]
  steps TEXT NOT NULL,         -- JSON string[]
  utensils TEXT NOT NULL,      -- JSON string[]
  utensils_from_site INTEGER NOT NULL,
  dishes INTEGER NOT NULL,
  unresolved INTEGER NOT NULL, -- lignes d'ingrédients pas encore reconnues : recette exclue des recommandations
  imported_at TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  base TEXT NOT NULL,
  PRIMARY KEY (recipe_id, base)
);
CREATE INDEX IF NOT EXISTS recipe_ingredients_base ON recipe_ingredients(base);
-- Clé normalisée → ingrédient de base. base NULL = « pas un ingrédient » (à ignorer).
CREATE TABLE IF NOT EXISTS ingredient_aliases (
  key TEXT PRIMARY KEY,
  base TEXT,
  origin TEXT NOT NULL         -- seed | claude
);
CREATE TABLE IF NOT EXISTS unknown_terms (
  key TEXT PRIMARY KEY,
  example TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS crawl_queue (
  url TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | imported | rejected | gone | error
  reason TEXT,
  position INTEGER NOT NULL,
  fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS crawl_queue_next ON crawl_queue(status, position);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

export function openDb(file = join(DATA_DIR, 'recipe-finder.db')): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const upsert = db.prepare(`INSERT INTO ingredient_aliases (key, base, origin) VALUES (?, ?, 'seed')
    ON CONFLICT(key) DO UPDATE SET base = excluded.base WHERE origin = 'seed'`);
  db.exec('BEGIN');
  for (const [alias, base] of seedAliases()) upsert.run(normalizeKey(alias), base);
  db.exec('COMMIT');
  return db;
}

export function loadAliases(db: Db): Map<string, string | null> {
  const rows = db.prepare('SELECT key, base FROM ingredient_aliases').all() as Array<{ key: string; base: string | null }>;
  return new Map(rows.map(r => [r.key, r.base]));
}

export function getMeta(db: Db, key: string): string | null {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
