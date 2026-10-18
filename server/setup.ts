import { spawn } from 'node:child_process';
import { claudeExe, claudeStatus, invalidateAIStatus, localModel, localStatus, ollamaExe } from './ai.ts';

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

function wingetInstall(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('winget', ['install', '--id', id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (out += d));
    child.on('error', () => reject(new Error("winget est introuvable : installe « App Installer » depuis le Microsoft Store, puis réessaie")));
    child.on('close', code => {
      // 0 = installé ; « déjà installé » renvoie aussi un code non nul selon les versions : on vérifie après coup.
      if (code === 0 || /already installed|déjà installé|No available upgrade/i.test(out)) resolve();
      else reject(new Error(`Installation de ${id} échouée (code ${code})`));
    });
  });
}

/** Un seul bouton : installe Claude Code si besoin, puis lance la connexion à l'abonnement dans le navigateur. */
export async function connectClaude(): Promise<void> {
  if (task?.status === 'running') return;
  task = { kind: 'claude', status: 'running', step: 'Vérification…' };
  try {
    if (!claudeExe()) {
      set({ step: 'Installation de Claude Code (1 à 2 min)…' });
      await wingetInstall('Anthropic.ClaudeCode');
      if (!claudeExe()) throw new Error('Claude Code installé, mais introuvable : redémarre l’app puis réessaie');
    }
    invalidateAIStatus();
    if ((await claudeStatus()).state === 'ready') { set({ status: 'done', step: 'Connecté' }); return; }

    // La connexion ouvre la page Anthropic dans le navigateur. Une petite fenêtre l'accompagne au cas où
    // il faudrait coller un code ; elle se ferme seule une fois la connexion terminée.
    set({ step: 'Connecte-toi dans la page qui vient de s’ouvrir dans ton navigateur…' });
    spawn('cmd', ['/c', 'start', 'Connexion à Claude', 'cmd', '/c', claudeExe()!, 'auth', 'login'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();

    // Attend la connexion (jusqu'à 10 min) en interrogeant l'état.
    for (let i = 0; i < 200; i++) {
      await sleep(3_000);
      invalidateAIStatus();
      if ((await claudeStatus()).state === 'ready') { set({ status: 'done', step: 'Connecté' }); return; }
    }
    throw new Error('Connexion non terminée : réessaie quand tu veux');
  } catch (e) {
    set({ status: 'error', step: (e as Error).message });
  }
}

/** Un seul bouton : installe Ollama si besoin, le démarre, puis télécharge le modèle local. */
export async function setupLocal(): Promise<void> {
  if (task?.status === 'running') return;
  task = { kind: 'local', status: 'running', step: 'Vérification…' };
  try {
    let s = await fresh();
    if (s.state === 'not-installed') {
      set({ step: 'Installation d’Ollama (2 à 3 min)…' });
      await wingetInstall('Ollama.Ollama');
      s = await fresh();
    }
    if (s.state === 'not-running' || s.state === 'not-installed') {
      const exe = ollamaExe();
      if (!exe) throw new Error('Ollama installé, mais introuvable : redémarre le PC puis réessaie');
      set({ step: 'Démarrage d’Ollama…' });
      spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      for (let i = 0; i < 20 && (s = await fresh()).state === 'not-running'; i++) await sleep(1_500);
      if (s.state === 'not-running') throw new Error('Ollama ne démarre pas : lance-le depuis le menu Démarrer puis réessaie');
    }
    if (s.state !== 'ready') await pullModel(localModel());
    invalidateAIStatus();
    set({ status: 'done', step: 'Prêt', progress: undefined });
  } catch (e) {
    set({ status: 'error', step: (e as Error).message, progress: undefined });
  }
}

async function fresh() { invalidateAIStatus(); return localStatus(); }

/** Télécharge le modèle via l'API d'Ollama, en suivant la progression. */
async function pullModel(model: string): Promise<void> {
  set({ step: `Téléchargement du modèle ${model}…`, progress: 0 });
  const res = await fetch('http://127.0.0.1:11434/api/pull', { method: 'POST', body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
      if (ev.error) throw new Error(`Téléchargement : ${ev.error}`);
      if (ev.total && ev.completed !== undefined) set({ progress: Math.round((100 * ev.completed) / ev.total) });
    }
  }
}
