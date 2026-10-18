export type PantryItem = { id: number; label: string; base: string; qty: number | null; unit: string | null; urgent: boolean; showBase: boolean };
export type PantryState = { confirmedAt: string | null; gateOpen: boolean; version: number };
export type PantryResponse = PantryState & { items: PantryItem[]; staples: string[] };
export type ImportStatus = { imported: number; target: number; rejected: number; pending: number; unresolvedRecipes: number; running: boolean };

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
};

export const UNITS = ['pièce(s)', 'g', 'kg', 'ml', 'cl', 'l', 'c. à soupe', 'c. à café', 'sachet(s)', 'boîte(s)', 'pot(s)', 'tranche(s)', 'botte(s)', 'gousse(s)'];
