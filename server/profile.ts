import { askClaude, ClaudeUnavailable, parseJsonReply } from './claude.ts';
import { getMeta, setMeta, type Db } from './db.ts';
import { DEFAULT_QUESTIONNAIRE, getQuestionnaire, getWeights, type ProfileWeights } from './preferences.ts';

// Profil détaillé (non affiché) + réglages structurés pour le classement local (Q18, Q19).
// Mis à jour par Claude Sonnet quand ≥ 10 nouveaux signaux, au plus une fois par heure, en tâche de fond.

export const MIN_SIGNALS = 10;
const MIN_INTERVAL_MS = 3600 * 1000;

const SYSTEM = `Tu tiens à jour le profil culinaire d'une personne pour une app perso qui lui recommande des recettes françaises réelles selon son stock.
À partir du profil précédent, du questionnaire et des nouveaux signaux (likes, rejets de recettes ou d'ingrédients, questions posées sur des recettes), produis :
1. "profile" : un profil détaillé en français (goûts, cuisines préférées, ingrédients aimés ou évités, temps de préparation et vaisselle tolérés, niveau, habitudes, ce qui reste à découvrir). Garde ce qui reste vrai, corrige ce que les signaux contredisent. 250 mots maximum.
2. "weights" : des réglages pour un algorithme de classement local, avec des poids entre -1 et 1, modérés (le système doit garder de la variété) :
   { "ingredients": { "<ingrédient de base>": poids }, "keywords": { "<mot du titre, ex. curry, gratin, salade>": poids }, "types": { "Plat"|"Entrée"|"Dessert"|"Apéro"|"Petit-déj.": poids }, "maxTotalMin": nombre ou null, "exclude": [ "mot" ] }
   (La tolérance à la vaisselle vient du questionnaire : ne la règle pas.)
   "exclude" : les aversions FERMES et explicites (dites dans les notes, ou rejets répétés d'une même famille), qui excluront strictement toute recette contenant un ingrédient où le mot apparaît.
   Utilise des noms d'ingrédients simples au singulier ou ces familles : "poisson", "fruit de mer", "crustace", "lait", "oeuf", "gluten", "fruit a coque" (chaque famille couvre ses membres, ex. "poisson" → saumon, cabillaud, thon…).
   N'y mets pas les simples préférences (« pas fan de… », un seul rejet) : celles-là passent par des poids négatifs. Maximum 40 entrées.
   Au plus 25 entrées dans ingredients et 15 dans keywords. Ne mets pas de poids très négatif sur un ingrédient que la personne a seulement rejeté une fois dans une recette : c'est peut-être la recette qui ne plaisait pas.
Réponds uniquement par un objet JSON {"profile": "...", "weights": {...}}.`;

export function profileStatus(db: Db) {
  const pending = (db.prepare('SELECT COUNT(*) n FROM signals WHERE consumed = 0').get() as { n: number }).n;
  return {
    updatedAt: getMeta(db, 'profile_updated_at'),
    pendingSignals: pending,
    hasProfile: !!getMeta(db, 'profile_text'),
    lastError: getMeta(db, 'profile_last_error'),
    exclusions: getWeights(db).exclude ?? [],
  };
}

export function profileText(db: Db): string {
  return getMeta(db, 'profile_text') ?? '';
}

function clampWeights(w: ProfileWeights): ProfileWeights {
  const clampMap = (m?: Record<string, number>, max = 25) => m && Object.fromEntries(
    Object.entries(m).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).slice(0, max).map(([k, v]) => [k.toLowerCase().trim(), Math.max(-1, Math.min(1, v))]),
  );
  const types = w.types && Object.fromEntries(Object.entries(w.types).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.max(-1, Math.min(1, v))]));
  return {
    ingredients: clampMap(w.ingredients),
    keywords: clampMap(w.keywords, 15),
    types,
    maxTotalMin: typeof w.maxTotalMin === 'number' && w.maxTotalMin > 0 ? w.maxTotalMin : undefined,
    exclude: Array.isArray(w.exclude) ? w.exclude.filter((x): x is string => typeof x === 'string' && !!x.trim()).map(x => x.toLowerCase().trim()).slice(0, 40) : undefined,
  };
}

let running = false;

export type ProfileUpdateResult = 'updated' | 'nothing-new' | 'busy' | 'not-yet' | 'unavailable';

/**
 * Met le profil à jour si les conditions sont réunies (≥ 10 signaux, ≤ 1 / heure), ou dès qu'il y a du nouveau si `force`
 * (bouton « Mettre à jour maintenant »). Sans signal nouveau, Claude n'est pas appelé.
 */
export async function maybeUpdateProfile(db: Db, force = false): Promise<ProfileUpdateResult> {
  if (running) return 'busy';
  const status = profileStatus(db);
  const last = status.updatedAt ? Date.parse(status.updatedAt) : 0;
  if (status.pendingSignals === 0 && status.hasProfile) return 'nothing-new';
  if (!force && (status.pendingSignals < MIN_SIGNALS || Date.now() - last < MIN_INTERVAL_MS)) return 'not-yet';

  running = true;
  try {
    const signals = db.prepare('SELECT id, kind, detail, at FROM signals WHERE consumed = 0 ORDER BY id LIMIT 200').all() as Array<{ id: number; kind: string; detail: string; at: string }>;
    const q = getQuestionnaire(db) ?? DEFAULT_QUESTIONNAIRE;
    const label: Record<string, string> = { questionnaire: 'A modifié son questionnaire', like: 'A aimé', dislike: 'A rejeté la recette', ban_ingredient: "N'aime pas l'ingrédient", unban_ingredient: "Ne rejette plus l'ingrédient", chat: 'A demandé' };
    const prompt = `Questionnaire :
- ${q.persons} personne(s), temps habituel max ${q.maxTime} min, tolérance à la vaisselle : ${q.dishTolerance}, régime : ${q.diet}
- Allergies / exclusions : ${q.allergies.join(', ') || 'aucune'}
- Appareils : ${q.equipment.join(', ') || 'aucun'}
- Notes : ${q.notes || '—'}

Profil précédent :
${profileText(db) || '(aucun, premier profil)'}

Réglages précédents : ${JSON.stringify(getWeights(db))}

Ingrédients de base du catalogue (utilise exactement ces noms dans "ingredients") :
${(db.prepare('SELECT base FROM recipe_ingredients GROUP BY base ORDER BY COUNT(*) DESC LIMIT 250').all() as Array<{ base: string }>).map(r => r.base).join(', ')}

Nouveaux signaux (du plus ancien au plus récent) :
${signals.map(s => `- ${label[s.kind] ?? s.kind} : ${s.detail}`).join('\n') || '(aucun)'}`;

    const reply = parseJsonReply<{ profile: string; weights: ProfileWeights }>(await askClaude(prompt, { model: 'sonnet', system: SYSTEM, timeoutMs: 300_000, lane: 'interactive' }));
    if (typeof reply.profile !== 'string' || !reply.weights) throw new Error('Réponse incomplète');

    setMeta(db, 'profile_text', reply.profile.trim());
    setMeta(db, 'profile_weights', JSON.stringify(clampWeights(reply.weights)));
    setMeta(db, 'profile_updated_at', new Date().toISOString());
    setMeta(db, 'profile_last_error', '');
    const done = db.prepare('UPDATE signals SET consumed = 1 WHERE id = ?');
    for (const s of signals) done.run(s.id);
    return 'updated';
  } catch (e) {
    // Claude indisponible ou réponse invalide : on réessaiera plus tard, rien n'est perdu (Q31).
    setMeta(db, 'profile_last_error', `${new Date().toISOString()} ${e instanceof ClaudeUnavailable ? e.message : String(e)}`.slice(0, 300));
    return 'unavailable';
  } finally {
    running = false;
  }
}
