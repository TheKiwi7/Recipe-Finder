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
export type Mode = 'ready' | 'almost';
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
export type AIProvider = 'claude' | 'local';
export type AIStatus = {
  claude: { state: 'ready' | 'no-subscription' | 'not-logged-in' | 'not-installed' | 'error'; plan?: string; detail?: string };
  local: { state: 'ready' | 'no-model' | 'not-running' | 'not-installed'; model: string; models: string[] };
  routing: { interactive: AIProvider | null; background: AIProvider | null };
  task: { kind: AIProvider; status: 'running' | 'done' | 'error'; step: string; progress?: number } | null;
  localModels: Array<{ id: string; label: string; size: string; hint: string }>;
};
export type ImportStatus = { imported: number; target: number; rejected: number; pending: number; available: number; unresolvedRecipes: number; running: boolean; build: string; server: string };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
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
  unban: (base: string) => call('DELETE', `/banned/${encodeURIComponent(base)}`),
  rejections: () => call<Rejections>('GET', '/rejections'),
  questionnaire: () => call<{ questionnaire: Questionnaire | null; defaults: Questionnaire; equipment: string[] }>('GET', '/questionnaire'),
  saveQuestionnaire: (q: Questionnaire) => call<{ questionnaire: Questionnaire }>('PUT', '/questionnaire', q),
  profile: () => call<ProfileStatus>('GET', '/profile'),
  updateProfile: () => call<ProfileStatus & { result: 'updated' | 'nothing-new' | 'busy' | 'not-yet' | 'unavailable' }>('POST', '/profile/update'),
  chat: (id: number) => call<ChatMessage[]>('GET', `/recipes/${id}/chat`),
  ask: (id: number, message: string) => call<ChatMessage[]>('POST', `/recipes/${id}/chat`, { message }),
};

export const UNITS = ['pièce(s)', 'g', 'kg', 'ml', 'cl', 'l', 'c. à soupe', 'c. à café', 'sachet(s)', 'boîte(s)', 'pot(s)', 'tranche(s)', 'botte(s)', 'gousse(s)'];
