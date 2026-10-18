import { L } from './i18n.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { constants as osConstants, setPriority } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
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

const OLLAMA = 'http://127.0.0.1:11434';

// ---------- modèle local adapté au PC ----------
// Le 12B demande une carte graphique de 10-12 Go ; sur une carte plus petite (ou sans), il déborderait sur le
// processeur et ferait tourner le PC à fond. Mémoire vidéo lue dans le registre (toutes marques de cartes).
let gpuGB: number | null = null;
function detectGpuMemory(): void {
  const key = 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*';
  const ps = spawn('powershell', ['-NoProfile', '-Command',
    `(Get-ItemProperty '${key}' -ErrorAction SilentlyContinue | ForEach-Object { $_.'HardwareInformation.qwMemorySize' }) | Measure-Object -Maximum | Select-Object -ExpandProperty Maximum`],
  { windowsHide: true });
  let out = '';
  ps.stdout.on('data', d => (out += d));
  ps.on('error', () => {});
  ps.on('close', () => { const bytes = Number(out.trim()); if (bytes > 0) gpuGB = Math.round(bytes / 1024 ** 3); });
}
export const gpuMemoryGB = () => gpuGB;
/** Modèle conseillé pour ce PC : le 12B avec ≥ 10 Go de mémoire vidéo, sinon le 4B (inconnu : le 4B, par prudence). */
export const recommendedLocalModel = () => (gpuGB !== null && gpuGB >= 10 ? 'gemma3:12b' : 'gemma3:4b');

let db: Db | null = null;
export function initAI(database: Db): void { db = database; detectGpuMemory(); }
export const localModel = () => (db && getMeta(db, 'local_model')) || recommendedLocalModel();

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
const cooldowns = new Map<Provider, { until: number; reason: string; limit: boolean }>();
const LIMIT = /hit your limit|usage limit|rate limit|limit reached|quota/i;

function coolDown(p: Provider, error: string): void {
  const limit = LIMIT.test(error);
  cooldowns.set(p, { until: Date.now() + (limit ? 30 * 60_000 : 2 * 60_000), reason: error.slice(0, 200), limit });
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

/** Fournisseurs : état et appel. Remplaçables dans les tests (bascule Claude ↔ modèle local). */
export const providers = {
  async ready(p: Provider): Promise<boolean> {
    if (p === 'claude') return (await claudeStatus()).state === 'ready';
    const s = await localStatus();
    if (s.state === 'not-running') reviveOllama(); // Ollama planté ou arrêté : on le relance pour la prochaine fois
    return s.state === 'ready';
  },
  call: (p: Provider, prompt: string, opts: AskOptions): Promise<string> => (p === 'claude' ? callClaude(prompt, opts) : callLocal(prompt, opts)),
};

/**
 * Ordre de préférence selon la tâche, restreint aux fournisseurs prêts et pas en pause. Si tous les fournisseurs
 * prêts sont en pause, on retente quand même ceux qui ont eu une simple panne (pas ceux qui ont atteint leur limite).
 */
export async function route(lane: Lane): Promise<Provider[]> {
  const order: Provider[] = lane === 'interactive' ? ['claude', 'local'] : ['local', 'claude'];
  const ready = (await Promise.all(order.map(async p => ((await providers.ready(p)) ? p : null)))).filter((p): p is Provider => !!p);
  const free = ready.filter(p => !cooldownOf(p));
  return free.length ? free : ready.filter(p => !cooldowns.get(p)?.limit);
}

/** Pour les tests : oublie les pauses et la fermeture. */
export function resetAIState(): void { cooldowns.clear(); closing = false; }

// ---------- Ollama : démarré caché avec l'app, arrêté avec elle ----------

let ollamaStartedByUs = false;

/** Démarre Ollama en arrière-plan (sans fenêtre) s'il est installé et arrêté. Renvoie true s'il répond. */
export async function ensureOllama(): Promise<boolean> {
  invalidateLocalStatus();
  let s = await localStatus();
  if (s.state !== 'not-running') return s.state !== 'not-installed';
  const exe = ollamaExe();
  if (!exe) return false;
  // Pas « detached » : sans console, chaque sous-programme d'Ollama (moteur du modèle, détection de la carte
  // graphique) ouvrirait sa propre fenêtre. Avec une console masquée, ils en héritent et restent invisibles ;
  // et Ollama s'arrête aussi si le serveur de l'app plante.
  const child = spawn(exe, ['serve'], { stdio: 'ignore', windowsHide: true });
  child.unref();
  // Priorité basse : sur un PC sans grosse carte graphique, le modèle ne doit pas ralentir le reste.
  try { if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* sans importance */ }
  ollamaStartedByUs = true;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1_000));
    invalidateLocalStatus();
    s = await localStatus();
    if (s.state !== 'not-running') return true;
  }
  return false;
}

let lastRevive = 0;
/** Ollama installé mais arrêté (planté, fermé par quelqu'un) : relancé, au plus une fois par minute. */
function reviveOllama(): void {
  if (closing || !ollamaExe() || Date.now() - lastRevive < 60_000) return;
  lastRevive = Date.now();
  void ensureOllama();
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

/**
 * Ollama s'ajoute au démarrage de Windows, et ses mises à jour remettent ce raccourci : l'app le retire à chaque
 * lancement, pour qu'Ollama ne tourne qu'avec elle.
 */
export function removeOllamaAutostart(): void {
  const lnk = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Ollama.lnk');
  try { if (existsSync(lnk)) unlinkSync(lnk); } catch { /* sans importance */ }
}

/** Ferme seulement l'icône d'Ollama (le serveur de modèles continue de tourner). */
export function killOllamaTray(): void {
  spawn('taskkill', ['/IM', 'ollama app.exe', '/F'], { windowsHide: true, stdio: 'ignore' });
}

/** Ollama installé ou mis à jour par l'app : il est à elle, elle l'arrête en se fermant. */
export function adoptOllama(): void { ollamaStartedByUs = true; }

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
/** L'app se ferme : plus aucun appel, et ceux qu'on interrompt ne doivent ni basculer sur l'autre IA ni la mettre en pause. */
let closing = false;
export function abortAllAI(): void {
  closing = true;
  for (const child of running) child.kill();
  for (const ctrl of pending) ctrl.abort();
}

export type AskOptions = { tier: Tier; lane: Lane; system?: string; timeoutMs?: number; json?: boolean };

/**
 * Tâches de fond sur le modèle local : après chacune, la carte graphique se repose deux fois plus longtemps
 * qu'elle n'a travaillé (≤ 33 % du temps occupée en moyenne, au lieu de 100 % pendant une longue traduction).
 * Rien de tel pour ce que la personne attend à l'écran (chat, traduction d'une recette ouverte).
 */
const REST_RATIO = 2;
const MAX_REST_MS = 2 * 60_000;
let backgroundRest = 0;

export function askAI(prompt: string, opts: AskOptions): Promise<string> {
  const job = lanes[opts.lane].catch(() => {}).then(() => askRouted(prompt, opts));
  lanes[opts.lane] = opts.lane === 'background'
    ? job.catch(() => {}).then(() => { const ms = backgroundRest; backgroundRest = 0; return ms && !closing ? new Promise(r => setTimeout(r, ms)) : undefined; })
    : job;
  return job;
}

/** Réponse inutilisable (vide, ou pas du JSON quand on en attend) : l'autre IA prend le relais, sans mettre celle-ci en pause. */
class BadReply extends Error {}
function checkReply(text: string, opts: AskOptions): string {
  if (!text.trim()) throw new BadReply('Réponse vide');
  if (opts.json) { try { parseJsonReply(text); } catch { throw new BadReply(`Réponse illisible : ${text.slice(0, 120)}`); } }
  return text;
}

async function askRouted(prompt: string, opts: AskOptions): Promise<string> {
  if (closing) throw new AIUnavailable(L('L’app se ferme', 'The app is closing'));
  const candidates = await route(opts.lane);
  if (candidates.length === 0) {
    const paused = (['claude', 'local'] as Provider[]).map(cooldownOf).find(Boolean);
    throw new AIUnavailable(paused ? L(`IA en pause (${paused.reason})`, `AI paused (${paused.reason})`) : L("Aucune IA n'est configurée (Réglages → Intelligence artificielle)", 'No AI is set up (Settings → Artificial intelligence)'));
  }
  let lastError: unknown;
  for (const p of candidates) {
    const started = Date.now();
    try {
      return checkReply(await providers.call(p, prompt, opts), opts);
    } catch (e) {
      if (closing) throw new AIUnavailable(L('L’app se ferme', 'The app is closing'));
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ia] ${new Date().toISOString()} ${p} ${opts.lane}/${opts.tier} : ${msg}`);
      if (!(e instanceof BadReply)) {
        coolDown(p, msg);
        if (p === 'local') invalidateLocalStatus();
      }
    } finally {
      if (p === 'local' && opts.lane === 'background') backgroundRest = Math.min(MAX_REST_MS, (Date.now() - started) * REST_RATIO);
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
  // Appel nu : ni outils, ni connecteurs MCP du compte (≈ 2 400 tokens ajoutés à chaque appel sinon), ni skills,
  // ni réglages / hooks de l'utilisateur. Mesuré : 2 500 → 136 tokens d'entrée hors invite, 5,5 → 3 s.
  const args = ['-p', '--model', opts.tier === 'strong' ? 'sonnet' : 'haiku', '--output-format', 'json', '--tools', '', '--no-session-persistence',
    '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', ''];
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
