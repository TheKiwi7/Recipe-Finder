// Publie une version : vérifie que package.json et releases.json concordent (notes FR et EN rédigées), que tout est
// commité, puis crée le tag « vX.Y.Z » et pousse main + le tag. Les installations la proposeront dans les Réglages.
//   1. monte "version" dans package.json ;
//   2. ajoute en tête de releases.json { version, date, fr: [...], en: [...] } (phrases pour les utilisateurs) ;
//   3. commit, puis : npm run release
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (m: string): never => { console.error(`Publication annulée : ${m}`); process.exit(1); };

const version = (JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string }).version;
const top = (JSON.parse(readFileSync(new URL('releases.json', root), 'utf8')) as Array<{ version: string; date: string; fr: string[]; en: string[] }>)[0];
if (!top || top.version !== version) fail(`releases.json doit commencer par la version ${version} (package.json).`);
if (!top.fr?.length || !top.en?.length) fail('notes de version manquantes en français ou en anglais.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(top.date)) fail('date de la version au format AAAA-MM-JJ.');
if (git('status', '--porcelain')) fail('des modifications ne sont pas commitées.');
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('il faut être sur la branche main.');
if (git('tag', '--list', `v${version}`)) fail(`le tag v${version} existe déjà : monte la version.`);

git('tag', '-a', `v${version}`, '-m', `Recipe Finder ${version}\n\n${top.fr.map(l => `- ${l}`).join('\n')}`);
git('push', 'origin', 'main');
git('push', 'origin', `v${version}`);
console.log(`Version ${version} publiée : les installations la proposeront dans Réglages → Mises à jour.`);

// Page « Release » sur GitHub (notes FR / EN), si l'outil gh est installé et connecté.
const list = (lines: string[]) => lines.map(l => `- ${l}`).join('\n');
const notes = `## Français\n\n${list(top.fr)}\n\n## English\n\n${list(top.en)}\n`;
try {
  execFileSync('gh', ['release', 'create', `v${version}`, '--title', `Recipe Finder ${version}`, '--notes', notes, '--verify-tag'], { cwd: root, stdio: 'ignore' });
  console.log('Release GitHub créée.');
} catch {
  console.log(`Release GitHub non créée (outil gh absent ou non connecté) : à faire depuis la page du tag v${version}.`);
}
