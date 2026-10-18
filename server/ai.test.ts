import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { abortAllAI, AIUnavailable, askAI, cooldownOf, forgetParentClaudeSession, providers, resetAIState, type Provider } from './ai.ts';

// Bascule Claude ↔ modèle local : fournisseurs simulés (prêts ou non, réponses ou pannes à la demande).
type Behaviour = 'ok' | 'fail' | 'limit' | 'empty' | 'not-json';
const state: Record<Provider, { ready: boolean; next: Behaviour[]; calls: number }> = {
  claude: { ready: true, next: [], calls: 0 },
  local: { ready: true, next: [], calls: 0 },
};
providers.ready = async p => state[p].ready;
providers.call = async (p, _prompt, opts) => {
  state[p].calls++;
  const b = state[p].next.shift() ?? 'ok';
  if (b === 'fail') throw new AIUnavailable(`${p} en panne`);
  if (b === 'limit') throw new AIUnavailable("You've hit your limit");
  if (b === 'empty') return '';
  if (b === 'not-json') return 'Voici la traduction : bonjour';
  return opts.json ? `{"from":"${p}"}` : `réponse de ${p}`;
};

beforeEach(() => {
  resetAIState();
  for (const p of ['claude', 'local'] as Provider[]) state[p] = { ready: true, next: [], calls: 0 };
});

const ask = (lane: 'interactive' | 'background', json = false) => askAI('question', { tier: 'light', lane, json, timeoutMs: 1000 });

test('chat : Claude d’abord ; tâches de fond : modèle local d’abord', async () => {
  assert.equal(await ask('interactive'), 'réponse de claude');
  assert.equal(await ask('background'), 'réponse de local');
});

test('Claude en panne → le modèle local répond, et Claude est laissé tranquille ensuite', async () => {
  state.claude.next = ['fail'];
  assert.equal(await ask('interactive'), 'réponse de local');
  assert.ok(cooldownOf('claude'));
  assert.equal(await ask('interactive'), 'réponse de local');
  assert.equal(state.claude.calls, 1);
});

test('modèle local en panne → Claude répond pour les tâches de fond', async () => {
  state.local.next = ['fail'];
  assert.equal(await ask('background'), 'réponse de claude');
});

test('une seule IA installée : elle sert tout', async () => {
  state.claude.ready = false;
  assert.equal(await ask('interactive'), 'réponse de local');
  state.claude.ready = true; state.local.ready = false;
  assert.equal(await ask('background'), 'réponse de claude');
});

test('aucune IA : erreur claire, pas de plantage', async () => {
  state.claude.ready = false; state.local.ready = false;
  await assert.rejects(ask('interactive'), AIUnavailable);
});

test('les deux en panne : erreur ; ensuite une panne simple est retentée si rien d’autre n’est disponible', async () => {
  state.claude.next = ['fail']; state.local.next = ['fail'];
  await assert.rejects(ask('interactive'), AIUnavailable);
  // Les deux sont en pause, mais le modèle local s'est rétabli : il est retenté plutôt que de tout bloquer.
  assert.equal(await ask('background'), 'réponse de local');
});

test('limite d’usage de Claude : jamais retenté pendant la pause, même en dernier recours', async () => {
  state.claude.next = ['limit']; state.local.ready = false;
  await assert.rejects(ask('interactive'), AIUnavailable);
  await assert.rejects(ask('interactive'), AIUnavailable);
  assert.equal(state.claude.calls, 1);
});

test('réponse vide ou JSON invalide → l’autre IA prend le relais, sans pause', async () => {
  state.claude.next = ['empty'];
  assert.equal(await ask('interactive'), 'réponse de local');
  assert.equal(cooldownOf('claude'), null);
  state.local.next = ['not-json'];
  assert.equal(await ask('background', true), '{"from":"claude"}');
  assert.equal(cooldownOf('local'), null);
});

test('fermeture de l’app : aucun appel, et pas de bascule sur l’autre IA', async () => {
  abortAllAI();
  await assert.rejects(ask('interactive'), AIUnavailable);
  assert.equal(state.claude.calls + state.local.calls, 0);
});

test('app lancée depuis une session Claude Code : ses variables sont oubliées, les réglages du CLI restent', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_GIT_BASH_PATH: 'C:\Git\bin\bash.exe' });
  try {
    forgetParentClaudeSession();
    assert.equal(process.env.CLAUDECODE, undefined); // sinon : « cannot be launched inside another Claude Code session »
    assert.equal(process.env.CLAUDE_CODE_ENTRYPOINT, undefined);
    assert.equal(process.env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.equal(process.env.CLAUDE_CODE_GIT_BASH_PATH, 'C:\Git\bin\bash.exe');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
