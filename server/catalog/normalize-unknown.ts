import { askClaude, parseJsonReply } from '../claude.ts';
import type { Db } from '../db.ts';
import { reresolveRecipes } from './store.ts';
import { normalizeKey } from './text.ts';

const BATCH = 250;

const SYSTEM = `Tu normalises des ingrédients de recettes françaises pour une app qui compare les recettes au stock de l'utilisateur.
Pour chaque terme, donne l'ingrédient de base tel qu'on le range dans sa cuisine : court, en minuscules, au singulier sauf usage (« pâtes », « lentilles »), sans marque ni préparation.
Réutilise une base existante dès qu'elle convient. Réponds null pour ce qui n'est pas un ingrédient (« décoration », « garniture au choix »).
Réponds uniquement par un objet JSON {"terme": "base" | null}, avec exactement les termes reçus comme clés.`;

/** Envoie un lot de termes inconnus à Claude (Haiku) et enregistre les correspondances. Renvoie le nombre de termes traités. */
export async function resolveUnknownTerms(db: Db): Promise<number> {
  const terms = db.prepare('SELECT key, example FROM unknown_terms ORDER BY occurrences DESC LIMIT ?').all(BATCH) as Array<{ key: string; example: string }>;
  if (terms.length === 0) return 0;
  const bases = (db.prepare('SELECT DISTINCT base FROM ingredient_aliases WHERE base IS NOT NULL ORDER BY base').all() as Array<{ base: string }>).map(r => r.base);

  const prompt = `Bases existantes : ${bases.join(', ')}

Termes à normaliser (terme — exemple de ligne de recette) :
${terms.map(t => `${t.key} — ${t.example}`).join('\n')}`;

  const reply = parseJsonReply<Record<string, string | null>>(await askClaude(prompt, { model: 'haiku', system: SYSTEM }));

  const insert = db.prepare(`INSERT INTO ingredient_aliases (key, base, origin) VALUES (?, ?, 'claude') ON CONFLICT(key) DO NOTHING`);
  const drop = db.prepare('DELETE FROM unknown_terms WHERE key = ?');
  db.exec('BEGIN');
  for (const t of terms) {
    if (!(t.key in reply)) continue; // oublié par Claude : reste en file pour le prochain lot
    const base = reply[t.key];
    insert.run(t.key, typeof base === 'string' && base.trim() ? base.trim().toLowerCase() : null);
    // La base elle-même devient un alias, pour que la saisie de l'utilisateur la reconnaisse.
    if (typeof base === 'string' && base.trim()) insert.run(normalizeKey(base), base.trim().toLowerCase());
    drop.run(t.key);
  }
  db.exec('COMMIT');
  reresolveRecipes(db);
  return terms.length;
}
