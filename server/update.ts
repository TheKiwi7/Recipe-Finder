import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './db.ts';
import { L } from './i18n.ts';

// Mises à jour par git : l'app est une copie du dépôt GitHub (clonée, ou convertie par install.ps1 depuis le ZIP).
// Seules les versions publiées sont proposées : un tag « vX.Y.Z » sur main, avec ses notes de version (FR / EN)
// dans releases.json (npm run release). Vérification au démarrage puis toutes les 6 h ; « Mettre à jour » avance
// jusqu'au dernier tag (avance rapide seulement), réinstalle les dépendances si elles ont changé, reconstruit
// l'interface, puis l'app redémarre. Les données (data/) sont hors de git : jamais touchées.

const ROOT = join(DATA_DIR, '..');
const BRANCH = 'main';

/** Une version publiée et ses notes, dans les deux langues (releases.json, la plus récente en premier). */
export type Release = { version: string; date: string; fr: string[]; en: string[] };

export type UpdateState = {
  supported: boolean;
  reason?: string;                      // pourquoi les mises à jour ne sont pas possibles
  current: { version: string; date: string | null } | null;
  latest: string | null;                // dernière version publiée
  behind: number;                       // versions publiées plus récentes que celle installée
  releases: Release[];                  // leurs notes, de la plus récente à la plus ancienne
  checkedAt: string | null;
  status: 'idle' | 'checking' | 'updating' | 'restarting' | 'error';
  step?: string;
  error?: string;
};

let state: UpdateState = { supported: false, current: null, latest: null, behind: 0, releases: [], checkedAt: null, status: 'idle' };
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

/** Compare deux numéros de version « 1.2.10 » ; > 0 si a est plus récente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number), pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Notes des versions plus récentes que `installed`, de la plus récente à la plus ancienne. */
export function newerReleases(all: Release[], installed: string): Release[] {
  return all.filter(r => compareVersions(r.version, installed) > 0).sort((a, b) => compareVersions(b.version, a.version));
}

function localVersion(): { version: string; date: string | null } {
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  let date: string | null = null;
  try { date = (JSON.parse(readFileSync(join(ROOT, 'releases.json'), 'utf8')) as Release[]).find(r => r.version === version)?.date ?? null; } catch { /* pas de notes */ }
  return { version, date };
}

/** Copie git utilisable ? Sinon, la raison (affichée dans les Réglages). */
async function detect(): Promise<string | null> {
  if (!existsSync(join(ROOT, '.git'))) return L('Installée depuis le ZIP sans Git : relance install.cmd pour activer les mises à jour.', 'Installed from the ZIP without Git: run install.cmd again to enable updates.');
  try { await git('--version'); } catch { return L('Git est introuvable : relance install.cmd pour l’installer.', 'Git not found: run install.cmd again to install it.'); }
  try { await git('remote', 'get-url', 'origin'); } catch { return L('Aucun dépôt d’origine configuré.', 'No origin repository configured.'); }
  return null;
}

let init: Promise<void> | null = null;
/** Au démarrage : version installée et possibilité de mettre à jour, sans réseau (la vérification vient après). */
export function initUpdateState(): Promise<void> {
  init ??= (async () => {
    const reason = await detect();
    set({ supported: !reason, reason: reason ?? undefined, current: localVersion() });
  })();
  return init;
}

/** Dernier tag de version publié sur GitHub (après fetch), ou null. */
async function latestTag(): Promise<string | null> {
  const tags = (await git('tag', '--list', 'v*', '--merged', `origin/${BRANCH}`)).split('\n').filter(t => /^v\d+(\.\d+)*$/.test(t));
  return tags.sort((a, b) => compareVersions(b, a))[0] ?? null;
}

/** Interroge GitHub : une version publiée plus récente que celle installée ? */
export async function checkForUpdate(): Promise<UpdateState> {
  if (state.status === 'updating' || state.status === 'restarting' || state.status === 'checking') return state;
  await initUpdateState();
  const reason = await detect();
  if (reason) { set({ supported: false, reason }); return state; }
  set({ supported: true, reason: undefined, status: 'checking', current: localVersion() });
  try {
    await git('fetch', '--quiet', '--tags', '--force', 'origin', BRANCH);
    const tag = await latestTag();
    const installed = state.current!.version;
    let releases: Release[] = [];
    if (tag && compareVersions(tag, installed) > 0) {
      try { releases = newerReleases(JSON.parse(await git('show', `${tag}:releases.json`)) as Release[], installed); } catch { /* notes absentes */ }
      if (!releases.length) releases = [{ version: tag.slice(1), date: '', fr: [], en: [] }];
    }
    set({ latest: tag?.slice(1) ?? null, behind: releases.length, releases, checkedAt: new Date().toISOString(), status: 'idle', error: undefined });
  } catch {
    // Hors ligne, GitHub injoignable : on réessaiera plus tard, sans bruit.
    set({ status: 'idle', checkedAt: new Date().toISOString(), error: L('Vérification impossible (connexion internet ?)', 'Could not check (internet connection?)') });
  }
  return state;
}

/** Installe la dernière version publiée puis appelle `restart` (le serveur se relance sur le nouveau code). */
export async function applyUpdate(restart: () => void): Promise<void> {
  if (state.status === 'updating' || state.status === 'restarting') return;
  set({ status: 'updating', step: L('Vérification…', 'Checking…'), error: undefined });
  try {
    if (await detect()) throw new Error(state.reason ?? 'git');
    // Fichiers de l'app modifiés à la main : on ne les écrase pas.
    if (await git('status', '--porcelain', '--untracked-files=no')) {
      throw new Error(L('Des fichiers de l’app ont été modifiés à la main : mise à jour annulée pour ne pas les écraser.', 'Some app files were edited by hand: update cancelled so they are not overwritten.'));
    }
    set({ step: L('Téléchargement de la nouvelle version…', 'Downloading the new version…') });
    await git('fetch', '--quiet', '--tags', '--force', 'origin', BRANCH);
    const tag = await latestTag();
    if (!tag) throw new Error(L('Aucune version publiée.', 'No published version.'));
    const before = await git('rev-parse', 'HEAD');
    await git('merge', '--ff-only', '--quiet', tag);
    // Dépendances changées (pas seulement le numéro de version) : réinstallation.
    const deps = async (rev: string) => { const p = JSON.parse(await git('show', `${rev}:package.json`)); return JSON.stringify([p.dependencies, p.devDependencies]); };
    if (await deps(before) !== await deps('HEAD')) {
      set({ step: L('Installation des dépendances…', 'Installing dependencies…') });
      await npm('ci', '--no-audit', '--no-fund');
    }
    set({ step: L('Préparation de l’interface…', 'Building the interface…') });
    await npm('run', 'build');
    set({ status: 'restarting', step: L('Redémarrage…', 'Restarting…'), behind: 0, releases: [] });
    setTimeout(restart, 300);
  } catch (e) {
    set({ status: 'error', error: (e as Error).message, step: undefined });
  }
}
