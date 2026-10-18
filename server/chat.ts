import { askClaude, ClaudeUnavailable } from './claude.ts';
import type { Db } from './db.ts';
import { listPantry, listStaples } from './pantry.ts';
import { DEFAULT_QUESTIONNAIRE, getQuestionnaire, recordSignal } from './preferences.ts';
import { profileText } from './profile.ts';
import { recipeDetail } from './reco/service.ts';

// Chat sur une recette (Q16) : Claude Haiku, contexte automatique (recette, stock, profil), conversation mémorisée.

export type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; at: string };

const SYSTEM = `Tu es l'assistant culinaire d'une app perso de recettes. Tu réponds en français, de façon concise et concrète (quelques phrases ou une courte liste), comme un ami qui cuisine bien.
Tu connais la recette affichée, le stock de la personne et son profil : sers-t'en (propose des substitutions avec ce qu'elle a, adapte au nombre de personnes, signale ce qui manque).
Ne reformule pas toute la recette. Si on te demande quelque chose hors cuisine, ramène gentiment la conversation à la recette.`;

export function chatHistory(db: Db, recipeId: number): ChatMessage[] {
  return db.prepare('SELECT id, role, text, at FROM chat_messages WHERE recipe_id = ? ORDER BY id').all(recipeId) as ChatMessage[];
}

export class ChatError extends Error {}

export async function askAboutRecipe(db: Db, recipeId: number, message: string): Promise<ChatMessage[]> {
  const text = message.trim().slice(0, 2000);
  if (!text) throw new ChatError('Message vide');
  const r = recipeDetail(db, recipeId);
  if (!r) throw new ChatError('Recette introuvable');

  const q = getQuestionnaire(db) ?? DEFAULT_QUESTIONNAIRE;
  const pantry = listPantry(db).map(i => `${i.label}${i.qty ? ` (${String(i.qty).replace('.', ',')} ${i.unit ?? ''})`.replace(' )', ')') : ''}${i.urgent ? ' [à finir vite]' : ''}`);
  const history = chatHistory(db, recipeId).slice(-12);

  const prompt = `# Recette : ${r.name}
${r.type} · ${r.totalMin} min (préparation ${r.prepMin}, cuisson ${r.cookMin}) · pour ${r.servings} personnes · ${r.dishes} pièce(s) à laver
Ingrédients :
${r.ingredients.map(l => `- ${l.raw}`).join('\n')}
Ustensiles : ${r.utensils.join(', ') || '—'}
Étapes :
${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}
Ingrédients de la recette absents du stock : ${r.missing.join(', ') || 'aucun'}

# Stock de la personne
${pantry.join(', ') || '(vide)'} — placard de base : ${listStaples(db).join(', ')}
Elle cuisine en général pour ${q.persons} personne(s) ; régime : ${q.diet}${q.allergies.length ? ` ; allergies : ${q.allergies.join(', ')}` : ''}.

# Profil
${profileText(db) || '(pas encore de profil)'}

# Conversation
${history.map(m => `${m.role === 'user' ? 'Personne' : 'Toi'} : ${m.text}`).join('\n')}
Personne : ${text}

Réponds au dernier message.`;

  const now = () => new Date().toISOString();
  const insert = db.prepare('INSERT INTO chat_messages (recipe_id, role, text, at) VALUES (?, ?, ?, ?)');
  let answer: string;
  try {
    answer = (await askClaude(prompt, { model: 'haiku', system: SYSTEM, timeoutMs: 120_000 })).trim();
  } catch (e) {
    if (e instanceof ClaudeUnavailable) throw new ChatError('Claude indisponible pour le moment');
    throw e;
  }
  // On n'enregistre la question qu'une fois la réponse obtenue : en cas d'échec, rien à nettoyer.
  insert.run(recipeId, 'user', text, now());
  insert.run(recipeId, 'assistant', answer, now());
  recordSignal(db, 'chat', `« ${text} » (recette : ${r.name})`);
  return chatHistory(db, recipeId);
}
