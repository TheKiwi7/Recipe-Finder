import { useEffect, useState } from 'react';
import { Check, Cpu, Loader2, Sparkles } from 'lucide-react';
import { api, type AIProvider, type AIStatus } from '../api.ts';
import { toast } from '../toast.tsx';
import { dec, L } from '../i18n.ts';

const PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' };
const planLabel = (plan?: string) => (plan ? PLANS[plan] ?? plan.charAt(0).toUpperCase() + plan.slice(1) : null);

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`ai-pill ${ok ? 'ok' : ''}`}>{ok && <Check size={13} />}{children}</span>;
}

/**
 * Connexion de l'IA, pensée pour quelqu'un qui n'a rien installé : un bouton par option,
 * l'app installe, connecte et télécharge elle-même. Utilisée dans les Réglages et à l'accueil.
 */
export function AiCard() {
  const [s, setS] = useState<AIStatus | null>(null);
  const [testing, setTesting] = useState<AIProvider | null>(null);
  const running = s?.task?.status === 'running';

  const refresh = () => api.aiStatus().then(setS).catch(() => {});
  useEffect(() => { void refresh(); }, []);
  // Pendant une installation ou une connexion, on suit l'avancement.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [running]);
  // Fin d'une tâche : message de résultat.
  const [lastTask, setLastTask] = useState<string | null>(null);
  useEffect(() => {
    const t = s?.task;
    if (!t || t.status === 'running') return;
    const key = `${t.kind}-${t.status}-${t.step}`;
    if (key === lastTask) return;
    if (lastTask !== null) toast(t.status === 'done' ? (t.kind === 'claude' ? L('Claude est connecté', 'Claude is connected') : L('Le modèle local est prêt', 'The local model is ready')) : t.step);
    setLastTask(key);
  }, [s?.task]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return <p className="muted small">{L('Vérification de l’IA…', 'Checking the AI…')}</p>;

  const start = async (action: () => Promise<unknown>) => {
    try { await action(); setTimeout(refresh, 300); } catch (e) { toast((e as Error).message); }
  };
  const test = async (p: AIProvider) => {
    setTesting(p);
    try {
      const r = await api.testAI(p);
      toast(r.ok
        ? L(`${p === 'claude' ? 'Claude' : 'Le modèle local'} répond (${dec(r.ms / 1000)} s)`, `${p === 'claude' ? 'Claude' : 'The local model'} replies (${dec(r.ms / 1000)} s)`)
        : L(`Échec : ${r.error}`, `Failed: ${r.error}`));
    } finally { setTesting(null); }
  };

  const c = s.claude, l = s.local;
  const model = s.localModels.find(m => m.id === l.model) ?? s.localModels[0];
  const claudeTask = s.task?.kind === 'claude' && s.task.status === 'running' ? s.task : null;
  const localTask = s.task?.kind === 'local' && s.task.status === 'running' ? s.task : null;
  const name = (p: AIProvider | null) => (p === 'claude' ? 'Claude' : p === 'local' ? L('le modèle local', 'the local model') : null);

  return (
    <div className="ai">
      <p className="small">{L('L’IA sert au chat sur les recettes, à ton profil et à reconnaître les ingrédients des nouvelles recettes. Tout le reste fonctionne sans.', 'The AI powers the recipe chat, your profile, recognising the ingredients of new recipes and translating recipes. Everything else works without it.')}</p>

      <div className="ai-option">
        <div className="ai-icon"><Sparkles size={18} /></div>
        <div className="ai-body">
          <div className="ai-title">
            <b>{L('Ton abonnement Claude', 'Your Claude subscription')}</b>
            {c.state === 'ready' && <Pill ok>{L('Connecté', 'Connected')}{planLabel(c.plan) ? ` · ${planLabel(c.plan)}` : ''}</Pill>}
            {c.state === 'no-subscription' && <Pill ok={false}>{L('Compte gratuit', 'Free account')}</Pill>}
            {c.state === 'not-logged-in' && <Pill ok={false}>{L('Installé, pas connecté', 'Installed, not signed in')}</Pill>}
            {c.state === 'not-installed' && <Pill ok={false}>{L('Non connecté', 'Not connected')}</Pill>}
            {c.state === 'error' && <Pill ok={false}>{L('Erreur', 'Error')}</Pill>}
          </div>
          <p className="muted small">
            {c.state === 'no-subscription'
              ? L('Ce compte Claude est gratuit : l’app a besoin d’un abonnement Pro ou Max. En attendant, le modèle local prend le relais.', 'This Claude account is free: the app needs a Pro or Max subscription. Meanwhile the local model takes over.')
              : L('La meilleure qualité pour le chat et le profil. Utilise ton abonnement Pro ou Max, sans frais en plus.', 'The best quality for chat and profile. Uses your Pro or Max subscription, at no extra cost.')}
          </p>
          {claudeTask ? (
            <p className="ai-step"><Loader2 size={15} className="spin" />{claudeTask.step}</p>
          ) : c.state === 'ready' ? (
            <button className="btn btn-ghost small-btn" onClick={() => test('claude')} disabled={testing !== null}>{testing === 'claude' ? <Loader2 size={14} className="spin" /> : null}{L('Tester', 'Test')}</button>
          ) : (
            <button className="btn btn-primary small-btn" onClick={() => start(api.connectClaude)} disabled={running}>{L('Connecter mon abonnement Claude', 'Connect my Claude subscription')}</button>
          )}
        </div>
      </div>

      <div className="ai-option">
        <div className="ai-icon"><Cpu size={18} /></div>
        <div className="ai-body">
          <div className="ai-title">
            <b>{L('Modèle local, gratuit', 'Local model, free')}</b>
            {l.state === 'ready' && <Pill ok>{L('Prêt', 'Ready')} · {model.label}</Pill>}
            {l.state !== 'ready' && <Pill ok={false}>{l.state === 'no-model' ? L('Modèle à télécharger', 'Model to download') : l.state === 'not-running' ? L('Arrêté', 'Stopped') : L('Non installé', 'Not installed')}</Pill>}
          </div>
          <p className="muted small">{L('Tourne sur ce PC : gratuit, privé, hors ligne. Il s’occupe des tâches de fond, et de tout si Claude n’est pas connecté.', 'Runs on this PC: free, private, offline. It handles background tasks, and everything if Claude isn’t connected.')}</p>
          {localTask ? (
            <div className="ai-step">
              <Loader2 size={15} className="spin" />{localTask.step}
              {localTask.progress !== undefined && <span className="ai-progress"><i style={{ width: `${localTask.progress}%` }} /></span>}
              {localTask.progress !== undefined && <b>{localTask.progress} %</b>}
            </div>
          ) : l.state === 'ready' ? (
            <button className="btn btn-ghost small-btn" onClick={() => test('local')} disabled={testing !== null}>{testing === 'local' ? <Loader2 size={14} className="spin" /> : null}{L('Tester', 'Test')}</button>
          ) : (
            <div className="ai-actions">
              <select className="field ai-model" value={model.id} onChange={e => start(() => api.setLocalModel(e.target.value))} disabled={running} aria-label={L('Modèle local', 'Local model')}>
                {s.localModels.map(m => <option key={m.id} value={m.id}>{m.label} ({m.size}) — {m.hint}</option>)}
              </select>
              <button className="btn btn-primary small-btn" onClick={() => start(api.setupLocal)} disabled={running}>{L('Installer le modèle local', 'Install the local model')}</button>
            </div>
          )}
        </div>
      </div>

      <p className="muted small ai-routing">
        {s.routing.interactive
          ? <>{L('Chat et profil : ', 'Chat and profile: ')}<b>{name(s.routing.interactive)}</b> · {L('Tâches de fond : ', 'Background tasks: ')}<b>{name(s.routing.background)}</b></>
          : L('Aucune IA pour l’instant : le chat, la mise à jour du profil et la reconnaissance des nouveaux ingrédients sont en pause.', 'No AI for now: chat, profile updates, ingredient recognition and translation are paused.')}
      </p>
    </div>
  );
}
