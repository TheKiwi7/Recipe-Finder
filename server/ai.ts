import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getMeta, type Db } from './db.ts';

// Seul point de contact avec l'IA. Deux fournisseurs, sans clé API :
//  - « claude » : l'abonnement Claude de l'utilisateur, via le CLI officiel `claude -p` (Claude Code) ;
//  - « local »  : un modèle qui tourne sur le PC via Ollama (gratuit, privé, hors ligne).
// Routage hybride : le chat et le profil préfèrent Claude (meilleure qualité) ; les tâches de fond
// (normalisation, doublons) préfèrent le modèle local (volume élevé, ménage l'abonnement).
// Si le fournisseur préféré manque ou échoue, l'autre prend le relais.

export type Provider = 'claude' | 'local';
/** light = tâche simple (Haiku) ; strong = tâche de jugement (Sonnet). Le modèle local sert les deux. */
export type Tier = 'light' | 'strong';
export type Lane = 'background' | 'interactive';

export class AIUnavailable extends Error {}

export const DEFAULT_LOCAL_MODEL = 'gemma3:12b';
const OLLAMA = 'http://127.0.0.1:11434';

let db: Db | null = null;
export function initAI(database: Db): void { db = database; }
export const localModel = () => (db && getMeta(db, 'local_model')) || DEFAULT_LOCAL_MODEL;

// ---------- localisation des exécutables (y compris juste après une installation par winget) ----------

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? '';
function findExe(name: string, candidates: string[]): string | null {
  for (const dir of (process.env.PATH ?? '').split(';')) {
    for (const ext of ['.exe', '.cmd', '']) {
      const p = join(dir, name + ext);
      if (dir && existsSync(p)) return p;
    }
  }
  return candidates.find(c => existsSync(c)) ?? null;
}
export const claudeExe = () => findExe('claude', [join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'), join(process.env.USERPROFILE ?? '', '.local', 'bin', 'claude.exe')]);
export const ollamaExe = () => findExe('ollama', [join(LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')]);

// ---------- état des fournisseurs (mis en cache, l'interface le consulte souvent) ----------

export type ClaudeStatus = { state: 'ready' | 'no-subscription' | 'not-logged-in' | 'not-installed' | 'error'; plan?: string; detail?: string };
export type LocalStatus = { state: 'ready' | 'no-model' | 'not-running' | 'not-installed'; model: string; models: string[] };

let claudeCache: { at: number; value: ClaudeStatus } | null = null;
let localCache: { at: number; value: LocalStatus } | null = null;
export function invalidateAIStatus(): void { claudeCache = null; localCache = null; }

export async function claudeStatus(): Promise<ClaudeStatus> {
  if (claudeCache && Date.now() - claudeCache.at < 60_000) return claudeCache.value;
  const exe = claudeExe();
  let value: ClaudeStatus;
  if (!exe) value = { state: 'not-installed' };
  else {
    try {
      const out = await run(exe, ['auth', 'status', '--json'], 15_000);
      const s = JSON.parse(out) as { loggedIn?: boolean; subscriptionType?: string };
      // Claude Code demande un abonnement payant : un compte gratuit est connecté mais inutilisable ici.
      value = !s.loggedIn ? { state: 'not-logged-in' }
        : s.subscriptionType === 'free' ? { state: 'no-subscription', plan: 'free' }
        : { state: 'ready', plan: s.subscriptionType };
    } catch (e) {
      value = { state: 'error', detail: (e as Error).message.slice(0, 200) };
    }
  }
  claudeCache = { at: Date.now(), value };
  return value;
}

export async function localStatus(): Promise<LocalStatus> {
  if (localCache && Date.now() - localCache.at < 10_000) return localCache.value;
  const model = localModel();
  let value: LocalStatus;
  try {
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2_000) });
    const models = ((await res.json()) as { models?: Array<{ name: string }> }).models?.map(m => m.name) ?? [];
    const has = models.some(m => m === model || m === `${model}:latest`);
    value = { state: has ? 'ready' : 'no-model', model, models };
  } catch {
    value = { state: ollamaExe() ? 'not-running' : 'not-installed', model, models: [] };
  }
  localCache = { at: Date.now(), value };
  return value;
}

/** Ordre de préférence selon la tâche, restreint aux fournisseurs prêts. */
export async function route(lane: Lane): Promise<Provider[]> {
  const [c, l] = await Promise.all([claudeStatus(), localStatus()]);
  const order: Provider[] = lane === 'interactive' ? ['claude', 'local'] : ['local', 'claude'];
  return order.filter(p => (p === 'claude' ? c.state === 'ready' : l.state === 'ready'));
}

// ---------- appel ----------

/**
 * Deux files (tâches de fond / interactif), un appel à la fois dans chacune : pas de rafale d'appels,
 * et le chat n'attend jamais derrière un lot de normalisation.
 */
const lanes: Record<Lane, Promise<unknown>> = { background: Promise.resolve(), interactive: Promise.resolve() };

export type AskOptions = { tier: Tier; lane: Lane; system?: string; timeoutMs?: number; json?: boolean };

export function askAI(prompt: string, opts: AskOptions): Promise<string> {
  const job = lanes[opts.lane].catch(() => {}).then(() => askRouted(prompt, opts));
  lanes[opts.lane] = job;
  return job;
}

async function askRouted(prompt: string, opts: AskOptions): Promise<string> {
  const providers = await route(opts.lane);
  if (providers.length === 0) throw new AIUnavailable("Aucune IA n'est configurée (Réglages → Intelligence artificielle)");
  let lastError: unknown;
  for (const p of providers) {
    try {
      return p === 'claude' ? await callClaude(prompt, opts) : await callLocal(prompt, opts);
    } catch (e) {
      lastError = e;
      console.error(`[ia] ${new Date().toISOString()} ${p} ${opts.lane}/${opts.tier} : ${e instanceof Error ? e.message : String(e)}`);
      invalidateAIStatus(); // l'état a peut-être changé (déconnexion, Ollama arrêté)
    }
  }
  throw lastError instanceof AIUnavailable ? lastError : new AIUnavailable(String((lastError as Error)?.message ?? lastError));
}

/** Appelle un fournisseur précis (bouton « Tester » des Réglages). */
export function askProvider(provider: Provider, prompt: string, opts: AskOptions): Promise<string> {
  return provider === 'claude' ? callClaude(prompt, opts) : callLocal(prompt, opts);
}

function callClaude(prompt: string, opts: AskOptions): Promise<string> {
  const exe = claudeExe();
  if (!exe) return Promise.reject(new AIUnavailable('Claude Code n’est pas installé'));
  const args = ['-p', '--model', opts.tier === 'strong' ? 'sonnet' : 'haiku', '--output-format', 'json', '--tools', '', '--no-session-persistence'];
  if (opts.system) args.push('--system-prompt', opts.system);
  return run(exe, args, opts.timeoutMs ?? 180_000, prompt).then(out => {
    let res: { is_error?: boolean; result?: unknown };
    try { res = JSON.parse(out); } catch { throw new AIUnavailable(`Réponse illisible de Claude : ${out.slice(0, 200)}`); }
    if (res.is_error) throw new AIUnavailable(String(res.result ?? 'Erreur Claude'));
    return String(res.result);
  });
}

async function callLocal(prompt: string, opts: AskOptions): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: localModel(),
        stream: false,
        format: opts.json ? 'json' : undefined, // JSON garanti par Ollama
        keep_alive: '10m',
        options: { temperature: 0.2, num_ctx: 16_384 },
        messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
  } catch (e) {
    throw new AIUnavailable(`Modèle local injoignable : ${(e as Error).message}`);
  }
  const data = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
  if (!res.ok || data.error) throw new AIUnavailable(`Modèle local : ${data.error ?? `HTTP ${res.status}`}`);
  return data.message?.content ?? '';
}

/** Lance un exécutable, envoie `stdin`, renvoie la sortie standard. */
function run(exe: string, args: string[], timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // cwd = data/ : le CLI claude ne charge pas le CLAUDE.md du projet.
    const child = spawn(exe, args, { cwd: DATA_DIR, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new AIUnavailable('Délai dépassé')); }, timeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); reject(new AIUnavailable(`${exe} : ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (out.trim()) resolve(out);
      else reject(new AIUnavailable(`Code ${code} : ${err.slice(0, 300)}`));
    });
    child.stdin.end(stdin ?? '');
  });
}

/** Extrait le premier objet JSON d'une réponse (certains modèles l'entourent de ```json). */
export function parseJsonReply<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Pas de JSON dans la réponse');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
