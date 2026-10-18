import { getMeta, type Db } from './db.ts';
import { listPantry, listStaples } from './pantry.ts';
import { getQuestionnaire, getWeights } from './preferences.ts';
import { listMembers } from './members.ts';

/** « Exporter mes données » (Q32) : tout ce qui est personnel, sans le catalogue (re-téléchargeable). */
export function exportData(db: Db) {
  const all = (sql: string) => db.prepare(sql).all();
  return {
    exportedAt: new Date().toISOString(),
    app: 'Recipe Finder',
    pantry: listPantry(db),
    staples: listStaples(db),
    questionnaire: getQuestionnaire(db),
    members: listMembers(db),
    profile: { text: getMeta(db, 'profile_text'), weights: getWeights(db), updatedAt: getMeta(db, 'profile_updated_at') },
    favorites: (all('SELECT recipe_id, snapshot, at FROM favorites ORDER BY at') as Array<{ recipe_id: number; snapshot: string; at: string }>)
      .map(f => ({ recipeId: f.recipe_id, at: f.at, recipe: JSON.parse(f.snapshot) })),
    reactions: all('SELECT r.recipe_id recipeId, c.name, c.url, r.kind, r.at FROM reactions r LEFT JOIN recipes c ON c.id = r.recipe_id ORDER BY r.at'),
    bannedIngredients: all('SELECT base, at FROM banned_ingredients ORDER BY at'),
    chats: all('SELECT m.recipe_id recipeId, c.name recipe, m.role, m.text, m.at FROM chat_messages m LEFT JOIN recipes c ON c.id = m.recipe_id ORDER BY m.id'),
    signals: all('SELECT kind, detail, at, consumed FROM signals ORDER BY id'),
  };
}
