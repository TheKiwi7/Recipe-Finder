import { spawn } from 'node:child_process';
import { DATA_DIR } from './db.ts';

// Seul point de contact avec Claude. Passe par le CLI officiel en mode headless (`claude -p`),
// donc par l'abonnement de l'utilisateur. Pour passer à une clé API, il suffit de remplacer ce module.

export type Model = 'haiku' | 'sonnet';

export class ClaudeUnavailable extends Error {}

/**
 * Deux files : « background » (normalisation, fusion des doublons) et « interactive » (chat, profil).
 * Dans chaque file, un seul appel à la fois : pas de rafale d'appels simultanés sur l'abonnement,
 * et le chat n'attend jamais derrière un lot de normalisation.
 */
export type Lane = 'background' | 'interactive';
const lanes: Record<Lane, Promise<unknown>> = { background: Promise.resolve(), interactive: Promise.resolve() };

export function askClaude(prompt: string, opts: { model: Model; system?: string; timeoutMs?: number; lane: Lane }): Promise<string> {
  const run = lanes[opts.lane].catch(() => {}).then(() => callClaude(prompt, opts));
  lanes[opts.lane] = run;
  return run.catch(e => {
    console.error(`[claude] ${new Date().toISOString()} ${opts.lane}/${opts.model} : ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  });
}

function callClaude(prompt: string, opts: { model: Model; system?: string; timeoutMs?: number }): Promise<string> {
  const args =['-p', '--model', opts.model, '--output-format', 'json', '--tools', '', '--no-session-persistence'];
  if (opts.system) args.push('--system-prompt', opts.system);

  return new Promise((resolve, reject) => {
    // cwd = data/ pour que le CLI ne charge pas le CLAUDE.md du projet.
    const child = spawn('claude', args, { cwd: DATA_DIR, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new ClaudeUnavailable('Délai dépassé')); }, opts.timeoutMs ?? 180_000);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); reject(new ClaudeUnavailable(`CLI claude introuvable : ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        if (res.is_error) return reject(new ClaudeUnavailable(String(res.result ?? 'Erreur Claude')));
        resolve(String(res.result));
      } catch {
        reject(new ClaudeUnavailable(`Réponse illisible (code ${code}) : ${(err || out).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/** Extrait le premier objet JSON d'une réponse (Claude entoure parfois sa réponse de ```json). */
export function parseJsonReply<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Pas de JSON dans la réponse');
  return JSON.parse(text.slice(start, end + 1)) as T;
}
