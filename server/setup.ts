import { spawn } from 'node:child_process';
import { L } from './i18n.ts';
import { adoptOllama, claudeExe, claudeStatus, ensureOllama, invalidateClaudeStatus, invalidateLocalStatus, killOllama, killOllamaTray, localModel, localStatus, removeOllamaAutostart } from './ai.ts';

// Installation et connexion de l'IA depuis l'app, en un clic, pour quelqu'un qui n'a rien d'installé.
// Les logiciels s'installent via winget (gestionnaire intégré à Windows 10/11), sans droits administrateur.

export type SetupTask = {
  kind: 'claude' | 'local';
  status: 'running' | 'done' | 'error';
  step: string;          // texte affiché à l'utilisateur
  progress?: number;     // 0-100 pendant un téléchargement
};

let task: SetupTask | null = null;
export const setupTask = () => task;

const set = (patch: Partial<SetupTask>) => { task = { ...(task as SetupTask), ...patch }; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function wingetInstall(id: string, verb: 'install' | 'upgrade' = 'install'): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('winget', [verb, '--id', id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('error', () => reject(new Error(L('winget est introuvable : installe « App Installer » depuis le Microsoft Store, puis réessaie', 'winget not found: install “App Installer” from the Microsoft Store, then try again'))));
    child.on('close', code => {
      // 0 = installé ; « déjà installé » renvoie aussi un code non nul selon les versions : on vérifie après coup.
      if (code === 0 || /already installed|déjà installé|No available upgrade/i.test(out)) resolve();
      else reject(new Error(L(`Installation de ${id} échouée (code ${code})`, `Installing ${id} failed (code ${code})`)));
    });
  });
}

/** Un seul bouton : installe Claude Code si besoin, puis lance la connexion à l'abonnement dans le navigateur. */
export async function connectClaude(): Promise<void> {
  if (task?.status === 'running') return;
  task = { kind: 'claude', status: 'running', step: L('Vérification…', 'Checking…') };
  try {
    if (!claudeExe()) {
      set({ step: L('Installation de Claude Code (quelques minutes selon ta connexion)…', 'Installing Claude Code (a few minutes depending on your connection)…') });
      await wingetInstall('Anthropic.ClaudeCode');
      if (!claudeExe()) throw new Error(L('Claude Code installé, mais introuvable : redémarre l’app puis réessaie', 'Claude Code is installed but cannot be found: restart the app and try again'));
    }
    invalidateClaudeStatus();
    if ((await claudeStatus()).state === 'ready') { set({ status: 'done', step: L('Connecté', 'Connected') }); return; }

    // La connexion ouvre la page Anthropic dans le navigateur. Une petite fenêtre l'accompagne au cas où
    // il faudrait coller un code ; elle se ferme seule une fois la connexion terminée.
    set({ step: L('Connecte-toi dans la page qui vient de s’ouvrir dans ton navigateur…', 'Sign in on the page that just opened in your browser…') });
    spawn('cmd', ['/c', 'start', 'Connexion à Claude', 'cmd', '/c', claudeExe()!, 'auth', 'login'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

    // Attend la connexion (jusqu'à 10 min) en interrogeant l'état.
    for (let i = 0; i < 120; i++) {
      await sleep(5_000);
      invalidateClaudeStatus();
      if ((await claudeStatus()).state === 'ready') { set({ status: 'done', step: L('Connecté', 'Connected') }); return; }
    }
    throw new Error(L('Connexion non terminée : réessaie quand tu veux', 'Sign-in not completed: try again whenever you like'));
  } catch (e) {
    set({ status: 'error', step: (e as Error).message });
  }
}

/** Un seul bouton : installe Ollama si besoin, le démarre (caché), puis télécharge le modèle local. */
export async function setupLocal(): Promise<void> {
  if (task?.status === 'running') return;
  task = { kind: 'local', status: 'running', step: L('Vérification…', 'Checking…') };
  try {
    let s = await fresh();
    if (s.state === 'not-installed') {
      set({ step: L('Installation d’Ollama (quelques minutes selon ta connexion)…', 'Installing Ollama (a few minutes depending on your connection)…') });
      await wingetInstall('Ollama.Ollama');
      hideOllamaAfterInstall();
      s = await fresh();
    }
    if (s.state === 'not-running' || s.state === 'not-installed') s = await startOllama();
    if (s.state !== 'ready') {
      try {
        await pullModel(localModel());
      } catch (e) {
        // Ollama trop ancien pour ce modèle (« requires a newer version of Ollama ») : mise à jour, puis nouvel essai.
        if (!/newer version of Ollama/i.test((e as Error).message)) throw e;
        set({ step: L('Mise à jour d’Ollama (quelques minutes selon ta connexion)…', 'Updating Ollama (a few minutes depending on your connection)…'), progress: undefined });
        killOllama();
        await sleep(2_000);
        await wingetInstall('Ollama.Ollama', 'upgrade');
        hideOllamaAfterInstall();
        await startOllama();
        await pullModel(localModel());
      }
    }
    invalidateLocalStatus();
    set({ status: 'done', step: L('Prêt', 'Ready'), progress: undefined });
  } catch (e) {
    set({ status: 'error', step: (e as Error).message, progress: undefined });
  }
}

async function fresh() { invalidateLocalStatus(); return localStatus(); }

/** Démarre Ollama en arrière-plan, sans fenêtre, et attend qu'il réponde. */
async function startOllama() {
  set({ step: L('Démarrage d’Ollama…', 'Starting Ollama…') });
  if (!(await ensureOllama())) throw new Error(L('Ollama ne démarre pas : redémarre le PC puis réessaie', 'Ollama does not start: restart the PC and try again'));
  return fresh();
}

/**
 * L'installateur d'Ollama ouvre sa fenêtre et l'inscrit au démarrage de Windows. L'app le pilote elle-même
 * (démarré caché avec l'app, arrêté avec elle) : on ferme cette fenêtre et on retire le lancement automatique.
 */
function hideOllamaAfterInstall(): void {
  killOllama();
  removeOllamaAutostart();
  adoptOllama();
  // L'installateur relance parfois l'icône et remet le raccourci de démarrage quelques secondes plus tard : on repasse.
  for (const ms of [5_000, 15_000, 30_000]) setTimeout(() => { killOllamaTray(); removeOllamaAutostart(); }, ms);
}

// Erreurs définitives : inutile de réessayer (version d'Ollama, modèle inexistant).
const FATAL = /newer version of Ollama|file does not exist|manifest unknown|model .* not found/i;
const MAX_ATTEMPTS = 40;

/**
 * Télécharge le modèle via l'API d'Ollama, en suivant la progression. Pensé pour les connexions lentes :
 * pas de limite de durée, et reprise automatique en cas de coupure (Ollama repart de ce qui est déjà téléchargé).
 */
async function pullModel(model: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await pullOnce(model);
      return;
    } catch (e) {
      const msg = (e as Error).message;
      if (FATAL.test(msg) || attempt >= MAX_ATTEMPTS) throw e;
      set({ step: L(`Connexion interrompue, reprise du téléchargement dans 15 s (tentative ${attempt + 1})…`, `Connection lost, resuming the download in 15 s (attempt ${attempt + 1})…`) });
      await sleep(15_000);
    }
  }
}

const gb = (bytes: number) => L((bytes / 1e9).toFixed(1).replace('.', ','), (bytes / 1e9).toFixed(1));

async function pullOnce(model: string): Promise<void> {
  set({ step: L(`Téléchargement du modèle ${model}…`, `Downloading the ${model} model…`) });
  let res: Response;
  try {
    res = await fetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  } catch (e) {
    throw new Error(L(`Ollama injoignable : ${(e as Error).message}`, `Cannot reach Ollama: ${(e as Error).message}`));
  }
  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim();
    throw new Error(L(`Téléchargement impossible (HTTP ${res.status}) ${detail}`, `Download failed (HTTP ${res.status}) ${detail}`).trim());
  }
  // Le modèle est fait de plusieurs fichiers : progression globale = somme des octets reçus / somme des tailles.
  const layers = new Map<string, { completed: number; total: number }>();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let success = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as { status?: string; digest?: string; completed?: number; total?: number; error?: string };
      if (ev.error) throw new Error(L('Téléchargement : ', 'Download: ') + ev.error.replace(/\s+/g, ' ').trim());
      if (ev.status === 'success') success = true;
      if (ev.digest && ev.total) {
        layers.set(ev.digest, { completed: ev.completed ?? 0, total: ev.total });
        let done = 0, total = 0;
        for (const l of layers.values()) { done += l.completed; total += l.total; }
        set({ step: L(`Téléchargement du modèle ${model} : ${gb(done)} / ${gb(total)} Go`, `Downloading the ${model} model: ${gb(done)} / ${gb(total)} GB`), progress: Math.floor((100 * done) / total) });
      }
    }
  }
  if (!success) throw new Error(L('Téléchargement interrompu', 'Download interrupted'));
}
