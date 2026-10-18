import { L, type Lang } from './i18n.ts';

export type PantryItem = { id: number; label: string; base: string; qty: number | null; unit: string | null; urgent: boolean; showBase: boolean };
export type PantryState = { confirmedAt: string | null; gateOpen: boolean; version: number };
export type PantryResponse = PantryState & { items: PantryItem[]; staples: string[] };
export type Reaction = 'like' | 'dislike' | null;
export type RecipeCard = {
  id: number; name: string; image: string | null; type: string; totalMin: number; dishes: number;
  rating: number | null; reviews: number; missing: string[]; usesUrgent: boolean; reaction: Reaction;
};
export type IngredientLine = { raw: string; qty: number | null; unit: string | null; name: string; base: string | null };
export type RecipeDetail = RecipeCard & {
  url: string; prepMin: number; cookMin: number; servings: number; persons: number;
  ingredients: IngredientLine[]; steps: string[]; utensils: string[]; banned: string[]; available: string[]; archived: boolean;
};
export type RecipeTranslation = { name: string; ingredients: string[]; steps: string[] };
export type Mode = 'ready' | 'almost' | 'discover';
export type ShoppingItem = { id: number; base: string; qty: number | null; unit: string | null; recipes: Array<{ id: number; name: string }> };
export type Need = { base: string; qty: number | null; unit: string | null };
export type UpdateState = {
  supported: boolean; reason?: string; current: { version: string; date: string | null } | null; latest: string | null; behind: number;
  /** Notes des versions plus récentes que celle installée, la plus récente d'abord. */
  releases: Array<{ version: string; date: string; fr: string[]; en: string[] }>;
  checkedAt: string | null; status: 'idle' | 'checking' | 'updating' | 'restarting' | 'error'; step?: string; error?: string;
};
/** baseline : part de ces types sans priorité (dans le catalogue actuel). */
export type ImportPriority = { types: string[]; remaining: number; baseline: number };
export type Filters = { type: string; maxTime: number | null };
export type Recommendations = { items: RecipeCard[]; exhausted: boolean; catalogSize: number };
export type Rejections = { recipes: Array<{ id: number; name: string; image: string | null; at: string }>; ingredients: Array<{ base: string; at: string }> };
export type Questionnaire = {
  persons: number;
  maxTime: number;
  dishTolerance: 'low' | 'medium' | 'high';
  diet: 'omnivore' | 'vegetarian' | 'vegan' | 'pescetarian';
  allergies: string[];
  equipment: string[];
  notes: string;
};
export type ProfileStatus = { updatedAt: string | null; pendingSignals: number; hasProfile: boolean; lastError: string | null; exclusions: string[] };
export type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; at: string };
export type Member = { id: number; name: string; isSelf: boolean; diet: 'omnivore' | 'vegetarian' | 'vegan' | 'pescetarian'; allergies: string[]; aversions: string[]; notes: string };
export type Members = { members: Member[]; eaters: number[] };
export type AIProvider = 'claude' | 'local';
export type AIStatus = {
  claude: { state: 'ready' | 'no-subscription' | 'not-logged-in' | 'not-installed' | 'error'; plan?: string; detail?: string };
  local: { state: 'ready' | 'no-model' | 'not-running' | 'not-installed'; model: string; models: string[] };
  routing: { interactive: AIProvider | null; background: AIProvider | null };
  task: { kind: AIProvider; status: 'running' | 'done' | 'error'; step: string; progress?: number } | null;
  localModels: Array<{ id: string; label: string; size: string; hint: string }>;
};
/** target : objectif affiché, plafonné à reachable (ce qui reste réellement importable). secondsPerRecipe : rythme de l'import, pour le temps restant. */
export type ImportStatus = { imported: number; target: number; reachable: number; secondsPerRecipe: number; rejected: number; pending: number; available: number; unresolvedRecipes: number; running: boolean; build: string; server: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (res.headers.get('Content-Type') ?? '').includes('application/json');
  // Réponse coupée en route (changement de page, serveur qui redémarre) : une erreur, jamais un objet vide
  // que la page prendrait pour des données.
  const data = json ? await res.json().catch(() => undefined) : {};
  if (data === undefined) throw new TypeError(L('Réponse du serveur interrompue', 'Server response interrupted'));
  if (!res.ok) throw new Error(data.error ?? L(`Erreur ${res.status}`, `Error ${res.status}`));
  // Réponse non JSON sur une route d'API : serveur d'une version plus ancienne que l'interface.
  if (!json && res.status !== 204) throw new Error(L('Serveur pas à jour : ferme et relance l’app', 'Server out of date: close and relaunch the app'));
  return data as T;
}

export const api = {
  pantry: () => call<PantryResponse>('GET', '/pantry'),
  addItem: (item: { label: string; qty: number | null; unit: string | null }) => call<PantryItem>('POST', '/pantry', item),
  updateItem: (id: number, patch: Partial<Pick<PantryItem, 'label' | 'qty' | 'unit' | 'urgent'>>) => call('PATCH', `/pantry/${id}`, patch),
  deleteItem: (id: number) => call('DELETE', `/pantry/${id}`),
  setStaples: (staples: string[]) => call<{ staples: string[] }>('PUT', '/staples', { staples }),
  confirm: () => call<PantryState>('POST', '/pantry/confirm'),
  suggest: (q: string) => call<string[]>('GET', `/ingredients/suggest?q=${encodeURIComponent(q)}`),
  importStatus: () => call<ImportStatus>('GET', '/import/status'),
  importMore: (add: number) => call<ImportStatus>('POST', '/import/more', { add }),
  members: () => call<Members>('GET', '/members'),
  addMember: (name: string) => call<Member>('POST', '/members', { name }),
  updateMember: (id: number, patch: Partial<Omit<Member, 'id' | 'isSelf'>>) => call('PATCH', `/members/${id}`, patch),
  deleteMember: (id: number) => call('DELETE', `/members/${id}`),
  setEaters: (ids: number[]) => call<{ eaters: number[] }>('PUT', '/eaters', { ids }),
  aiStatus: () => call<AIStatus>('GET', '/ai/status'),
  connectClaude: () => call('POST', '/ai/claude/connect'),
  setupLocal: () => call('POST', '/ai/local/setup'),
  setLocalModel: (model: string) => call('PUT', '/ai/local/model', { model }),
  testAI: (provider: AIProvider) => call<{ ok: boolean; ms: number; reply?: string; error?: string }>('POST', '/ai/test', { provider }),
  recommend: (mode: Mode, filters: Filters, current: number[], want: number) =>
    call<Recommendations>('POST', '/recommendations', { mode, filters: { type: filters.type, maxTime: filters.maxTime ?? undefined }, current, want }),
  recipe: (id: number) => call<RecipeDetail>('GET', `/recipes/${id}`),
  react: (id: number, kind: Reaction) => call('POST', `/recipes/${id}/reaction`, { kind }),
  favorites: () => call<RecipeCard[]>('GET', '/favorites'),
  ban: (base: string) => call('POST', '/banned', { base }),
  /** Rejet saisi à la main : le serveur le ramène à l'ingrédient du catalogue, qu'il renvoie. */
  banTyped: (text: string) => call<{ ok: true; base: string }>('POST', '/banned', { base: text, typed: true }),
  unban: (base: string) => call('DELETE', `/banned/${encodeURIComponent(base)}`),
  rejections: () => call<Rejections>('GET', '/rejections'),
  questionnaire: () => call<{ questionnaire: Questionnaire | null; defaults: Questionnaire; equipment: string[] }>('GET', '/questionnaire'),
  saveQuestionnaire: (q: Questionnaire) => call<{ questionnaire: Questionnaire }>('PUT', '/questionnaire', q),
  profile: () => call<ProfileStatus>('GET', '/profile'),
  profileDetails: () => call<{ text: string; weights: { ingredients?: Record<string, number>; keywords?: Record<string, number>; types?: Record<string, number>; maxTotalMin?: number; exclude?: string[] } }>('GET', '/profile/details'),
  updateProfile: () => call<ProfileStatus & { result: 'updated' | 'nothing-new' | 'busy' | 'not-yet' | 'unavailable' }>('POST', '/profile/update'),
  chat: (id: number) => call<ChatMessage[]>('GET', `/recipes/${id}/chat`),
  ask: (id: number, message: string) => call<ChatMessage[]>('POST', `/recipes/${id}/chat`, { message }),
  cook: (id: number, persons: number) => call<{ added: Need[]; items: ShoppingItem[] }>('POST', `/recipes/${id}/cook`, { persons }),
  shopping: () => call<ShoppingItem[]>('GET', '/shopping'),
  addShopping: (item: { label: string; qty: number | null; unit: string | null }) => call<ShoppingItem[]>('POST', '/shopping', item),
  buyShopping: (id: number) => call<ShoppingItem[]>('POST', `/shopping/${id}/bought`),
  buyAllShopping: () => call<ShoppingItem[]>('POST', '/shopping/bought'),
  removeShopping: (id: number) => call<ShoppingItem[]>('DELETE', `/shopping/${id}`),
  clearShopping: () => call<ShoppingItem[]>('DELETE', '/shopping'),
  importPriority: () => call<ImportPriority>('GET', '/import/priority'),
  setImportPriority: (types: string[]) => call<ImportPriority>('PUT', '/import/priority', { types }),
  update: () => call<UpdateState>('GET', '/update'),
  checkUpdate: () => call<UpdateState>('POST', '/update/check'),
  applyUpdate: () => call<UpdateState>('POST', '/update'),
  settings: () => call<{ lang: Lang }>('GET', '/settings'),
  setLang: (l: Lang) => call<{ lang: Lang }>('PUT', '/settings', { lang: l }),
  /** La traduction si elle est prête, sinon `{ pending: true }` : redemander un peu plus tard. */
  recipeTranslation: (id: number) => call<RecipeTranslation | { pending: true }>('GET', `/recipes/${id}/translation`),
};

export const UNITS = ['pièce(s)', 'g', 'kg', 'ml', 'cl', 'l', 'c. à soupe', 'c. à café', 'sachet(s)', 'boîte(s)', 'pot(s)', 'tranche(s)', 'botte(s)', 'gousse(s)'];
