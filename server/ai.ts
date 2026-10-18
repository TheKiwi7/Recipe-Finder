import { L } from './i18n.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, getMeta, type Db } from './db.ts';

// Seul point de contact avec l'IA. Deux fournisseurs, sans clé API :
//  - « claude » : l'abonnement Claude de l'utilisateur, via le CLI officiel `claude -p` (Claude Code) ;
//  - « local »  : un modèle qui tourne sur le PC via Ollama (gratuit, privé, hors ligne).
// Routage hybride : le chat et le profil préfèrent Claude (meilleure qualité) ; les tâches de fond
// (normalisation, doublons) préfèrent le modèle local (volume élevé, ménage l'abonnement).
// Si le fournisseur préféré manque, échoue ou a atteint sa limite, l'autre prend le relais.

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

// ---------- pause après une erreur (limite d'usage, panne) ----------

/** Un fournisseur en échec est laissé tranquille un moment : pas d'essais en rafale, l'autre prend le relais. */
const cooldowns = new Map<Provider, { until: number; reason: string }>();
const LIMIT = /hit your limit|usage limit|rate limit|limit reached|quota/i;

function coolDown(p: Provider, error: string): void {
  const ms = LIMIT.test(error) ? 30 * 60_000 : 2 * 60_000;
  cooldowns.set(p, { until: Date.now() + ms, reason: error.slice(0, 200) });
}
export function cooldownOf(p: Provider): { until: string; reason: string } | null {
  const c = cooldowns.get(p);
  if (!c || c.until < Date.now()) return null;
  return { until: new Date(c.until).toISOString(), reason: c.reason };
}

// ---------- état des fournisseurs (mis en cache, l'interface le consulte souvent) ----------

export type ClaudeStatus = { state: 'ready' | 'no-subscription' | 'not-logged-in' | 'not-installed' | 'error'; plan?: string; detail?: string };
export type LocalStatus = { state: 'ready' | 'no-model' | 'not-running' | 'not-installed'; model: string; models: string[] };

let claudeCache: { at: number; value: ClaudeStatus } | null = null;
let localCache: { at: number; value: LocalStatus } | null = null;
// Deux invalidations séparées : vérifier Claude lance le programme `claude`, on évite de le faire pour rien.
export function invalidateClaudeStatus(): void { claudeCache = null; }
export function invalidateLocalStatus(): void { localCache = null; }

export async function claudeStatus(): Promise<ClaudeStatus> {
  if (claudeCache && Date.now() - claudeCache.at < 5 * 60_000) return claudeCache.value;
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

/** Ordre de préférence selon la tâche, restreint aux fournisseurs prêts et pas en pause. */
export async function route(lane: Lane): Promise<Provider[]> {
  const [c, l] = await Promise.all([claudeStatus(), localStatus()]);
  const order: Provider[] = lane === 'interactive' ? ['claude', 'local'] : ['local', 'claude'];
  return order.filter(p => (p === 'claude' ? c.state === 'ready' : l.state === 'ready') && !cooldownOf(p));
}

// ---------- Ollama : démarré caché avec l'app, arrêté avec elle ----------

let ollamaStartedByUs = false;

/** Démarre Ollama en arrière-plan (sans fenêtre) s'il est installé et arrêté. Renvoie true s'il répond. */
export async function ensureOllama(): Promise<boolean> {
  invalidateLocalStatus();
  let s = await localStatus();
  if (s.state !== 'not-running') return s.state !== 'not-installed';
  const exe = ollamaExe();
  if (!exe) return false;
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  ollamaStartedByUs = true;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1_000));
    invalidateLocalStatus();
    s = await localStatus();
    if (s.state !== 'not-running') return true;
  }
  return false;
}

/**
 * À la fermeture de l'app : libère la mémoire du modèle, et arrête Ollama si c'est l'app qui l'a démarré
 * (s'il tournait déjà avant, on le laisse : il sert peut-être à autre chose).
 */
export async function releaseOllama(): Promise<void> {
  try {
    await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: localModel(), keep_alive: 0 }), signal: AbortSignal.timeout(3_000) });
  } catch { /* déjà arrêté */ }
  if (ollamaStartedByUs) killOllama();
}

/** Arrête Ollama, y compris son application de bureau (fenêtre et icône). */
export function killOllama(): void {
  for (const image of ['ollama app.exe', 'ollama.exe']) {
    spawn('taskkill', ['/IM', image, '/F'], { windowsHide: true, stdio: 'ignore' });
  }
  ollamaStartedByUs = false;
}

// ---------- appel ----------

/**
 * Deux files (tâches de fond / interactif), un appel à la fois dans chacune : pas de rafale d'appels,
 * et le chat n'attend jamais derrière un lot de normalisation.
 */
const lanes: Record<Lane, Promise<unknown>> = { background: Promise.resolve(), interactive: Promise.resolve() };

/** Requêtes en cours (programmes `claude` lancés, appels au modèle local) : arrêtées à la fermeture de l'app. */
const running = new Set<ChildProcess>();
const pending = new Set<AbortController>();
export function abortAllAI(): void {
  for (const child of running) child.kill();
  for (const ctrl of pending) ctrl.abort();
}

export type AskOptions = { tier: Tier; lane: Lane; system?: string; timeoutMs?: number; json?: boolean };

export function askAI(prompt: string, opts: AskOptions): Promise<string> {
  const job = lanes[opts.lane].catch(() => {}).then(() => askRouted(prompt, opts));
  lanes[opts.lane] = job;
  return job;
}

async function askRouted(prompt: string, opts: AskOptions): Promise<string> {
  const providers = await route(opts.lane);
  if (providers.length === 0) {
    const paused = (['claude', 'local'] as Provider[]).map(cooldownOf).find(Boolean);
    throw new AIUnavailable(paused ? L(`IA en pause (${paused.reason})`, `AI paused (${paused.reason})`) : L("Aucune IA n'est configurée (Réglages → Intelligence artificielle)", 'No AI is set up (Settings → Artificial intelligence)'));
  }
  let lastError: unknown;
  for (const p of providers) {
    try {
      return p === 'claude' ? await callClaude(prompt, opts) : await callLocal(prompt, opts);
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ia] ${new Date().toISOString()} ${p} ${opts.lane}/${opts.tier} : ${msg}`);
      coolDown(p, msg);
      if (p === 'local') invalidateLocalStatus();
    }
  }
  throw lastError instanceof AIUnavailable ? lastError : new AIUnavailable(String((lastError as Error)?.message ?? lastError));
}

/** Appelle un fournisseur précis (bouton « Tester » des Réglages) ; un succès lève la pause éventuelle. */
export async function askProvider(provider: Provider, prompt: string, opts: AskOptions): Promise<string> {
  const reply = provider === 'claude' ? await callClaude(prompt, opts) : await callLocal(prompt, opts);
  cooldowns.delete(provider);
  return reply;
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
  const ctrl = new AbortController();
  pending.add(ctrl);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 180_000);
  try {
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
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new AIUnavailable(`Modèle local injoignable : ${(e as Error).message}`);
    }
    const data = (await res.json().catch(() => ({}))) as { message?: { content?: string }; error?: string };
    if (!res.ok || data.error) throw new AIUnavailable(`Modèle local : ${data.error ?? `HTTP ${res.status}`}`);
    return data.message?.content ?? '';
  } finally {
    clearTimeout(timer);
    pending.delete(ctrl);
  }
}

/** Lance un exécutable sans fenêtre, envoie `stdin`, renvoie la sortie standard. */
function run(exe: string, args: string[], timeoutMs: number, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // cwd = data/ : le CLI claude ne charge pas le CLAUDE.md du projet.
    const child = spawn(exe, args, { cwd: DATA_DIR, windowsHide: true });
    running.add(child);
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new AIUnavailable('Délai dépassé')); }, timeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); running.delete(child); reject(new AIUnavailable(`${exe} : ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      running.delete(child);
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
