import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.ts';
import { L } from './i18n.ts';

// Mises à jour par git : l'app est une copie du dépôt GitHub (clonée, ou convertie par install.ps1 depuis le ZIP).
// Vérification au démarrage puis toutes les 6 h ; « Mettre à jour » récupère la nouvelle version (avance rapide
// seulement), réinstalle les dépendances si elles ont changé, reconstruit l'interface, puis l'app redémarre.
// Les données (data/) sont hors de git : jamais touchées.

const ROOT = join(DATA_DIR, '..');
const BRANCH = 'main';

export type UpdateState = {
  supported: boolean;
  reason?: string;                      // pourquoi les mises à jour ne sont pas possibles
  current: { sha: string; date: string } | null;
  behind: number;                       // nouvelles versions disponibles (commits)
  changes: string[];                    // leurs titres, du plus récent au plus ancien
  checkedAt: string | null;
  status: 'idle' | 'checking' | 'updating' | 'restarting' | 'error';
  step?: string;
  error?: string;
};

let state: UpdateState = { supported: false, current: null, behind: 0, changes: [], checkedAt: null, status: 'idle' };
export const updateState = () => state;
const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; };

function run(cmd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, windowsHide: true, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${(stderr || err.message).trim().split('\n').slice(-2).join(' ')}`.slice(0, 300)));
      else resolve(stdout.trim());
    });
  });
}
const git = (...args: string[]) => run('git', args);
// npm est un script .cmd sous Windows : lancé par cmd, sans fenêtre.
const npm = (...args: string[]) => run('cmd', ['/d', '/s', '/c', 'npm', ...args], 600_000);

/** Copie git utilisable ? Sinon, la raison (affichée dans les Réglages). */
async function detect(): Promise<string | null> {
  if (!existsSync(join(ROOT, '.git'))) return L('Installée depuis le ZIP sans Git : relance install.cmd pour activer les mises à jour.', 'Installed from the ZIP without Git: run install.cmd again to enable updates.');
  try { await git('--version'); } catch { return L('Git est introuvable : relance install.cmd pour l’installer.', 'Git not found: run install.cmd again to install it.'); }
  try { await git('remote', 'get-url', 'origin'); } catch { return L('Aucun dépôt d’origine configuré.', 'No origin repository configured.'); }
  return null;
}

/** Au démarrage : version installée et possibilité de mettre à jour, sans réseau (la vérification vient après). */
export async function initUpdateState(): Promise<void> {
  const reason = await detect();
  if (reason) { set({ supported: false, reason }); return; }
  try {
    const [sha, date] = (await git('log', '-1', '--format=%h|%cI')).split('|');
    set({ supported: true, reason: undefined, current: { sha, date } });
  } catch { /* dépôt illisible : la vérification le dira */ }
}

/** Interroge GitHub (git fetch) : y a-t-il des versions plus récentes ? */
export async function checkForUpdate(): Promise<UpdateState> {
  if (state.status === 'updating' || state.status === 'restarting' || state.status === 'checking') return state;
  const reason = await detect();
  if (reason) { set({ supported: false, reason }); return state; }
  set({ supported: true, reason: undefined, status: 'checking' });
  try {
    const [sha, date] = (await git('log', '-1', '--format=%h|%cI')).split('|');
    await git('fetch', '--quiet', 'origin', BRANCH);
    const behind = Number(await git('rev-list', '--count', `HEAD..origin/${BRANCH}`)) || 0;
    const changes = behind ? (await git('log', '--format=%s', '-n', '15', `HEAD..origin/${BRANCH}`)).split('\n').filter(Boolean) : [];
    set({ current: { sha, date }, behind, changes, checkedAt: new Date().toISOString(), status: 'idle', error: undefined });
  } catch (e) {
    // Hors ligne, GitHub injoignable : on réessaiera plus tard, sans bruit.
    set({ status: 'idle', checkedAt: new Date().toISOString(), error: L('Vérification impossible (connexion internet ?)', 'Could not check (internet connection?)') });
  }
  return state;
}

/** Installe la nouvelle version puis appelle `restart` (le serveur se relance sur le nouveau code). */
export async function applyUpdate(restart: () => void): Promise<void> {
  if (state.status === 'updating' || state.status === 'restarting') return;
  set({ status: 'updating', step: L('Vérification…', 'Checking…'), error: undefined });
  try {
    if (await detect()) throw new Error(state.reason ?? 'git');
    // Fichiers de l'app modifiés à la main : on ne les écrase pas.
    if (await git('status', '--porcelain', '--untracked-files=no')) {
      throw new Error(L('Des fichiers de l’app ont été modifiés à la main : mise à jour annulée pour ne pas les écraser.', 'Some app files were edited by hand: update cancelled so they are not overwritten.'));
    }
    const before = await git('rev-parse', 'HEAD');
    set({ step: L('Téléchargement de la nouvelle version…', 'Downloading the new version…') });
    await git('pull', '--ff-only', '--quiet', 'origin', BRANCH);
    const changed = (await git('diff', '--name-only', before, 'HEAD')).split('\n');
    if (changed.some(f => f === 'package.json' || f === 'package-lock.json')) {
      set({ step: L('Installation des dépendances…', 'Installing dependencies…') });
      await npm('ci', '--no-audit', '--no-fund');
    }
    set({ step: L('Préparation de l’interface…', 'Building the interface…') });
    await npm('run', 'build');
    set({ status: 'restarting', step: L('Redémarrage…', 'Restarting…'), behind: 0, changes: [] });
    setTimeout(restart, 300);
  } catch (e) {
    set({ status: 'error', error: (e as Error).message, step: undefined });
  }
}
