import { useState } from 'react';
import { Check, Download, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { api } from '../api.ts';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';
import { invalidateLists } from '../recipes-store.ts';
import { toast } from '../toast.tsx';
import { LoadState, useLoad } from '../use-load.tsx';

function ago(iso: string | null): string {
  if (!iso) return 'jamais';
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  return h < 1 ? "il y a moins d'une heure" : h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} jours`;
}

function RejectionsCard() {
  const { data: r, failed, reload } = useLoad(() => api.rejections());
  if (!r) return <div className="card settings-card"><LoadState failed={failed} onRetry={reload} /></div>;

  const undo = async (action: () => Promise<unknown>, message: string) => {
    try { await action(); invalidateLists(); await reload(); toast(message); } catch (e) { toast((e as Error).message); }
  };
  const undoRecipe = (id: number) => undo(() => api.react(id, null), 'Rejet annulé');
  const undoIngredient = (base: string) => undo(() => api.unban(base), `« ${base} » à nouveau autorisé`);

  return (
    <div className="card settings-card">
      <h3 className="h3">Ingrédients rejetés</h3>
      {r.ingredients.length === 0 ? <p className="muted small">Aucun.</p> : (
        <div className="qchips">{r.ingredients.map(i => <span className="chip" key={i.base}>{i.base}<button onClick={() => undoIngredient(i.base)} title="Annuler" aria-label={`Autoriser ${i.base}`}><Undo2 size={13} /></button></span>)}</div>
      )}
      <h3 className="h3" style={{ marginTop: 22 }}>Recettes rejetées</h3>
      {r.recipes.length === 0 ? <p className="muted small">Aucune.</p> : (
        <ul className="rej-list">
          {r.recipes.map(x => (
            <li key={x.id}>
              {x.image ? <img src={x.image} alt="" /> : <span className="rej-ph" />}
              <span className="rej-name">{x.name}</span>
              <button className="btn btn-ghost small-btn" onClick={() => undoRecipe(x.id)}><Undo2 size={14} />Annuler</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfileCard({ version }: { version: number }) {
  const { data: p, failed, reload, setData: setP } = useLoad(() => api.profile(), [version]);
  const [busy, setBusy] = useState(false);
  if (!p) return <div className="card settings-card"><LoadState failed={failed} onRetry={reload} /></div>;
  const update = async () => {
    setBusy(true);
    try {
      const r = await api.updateProfile();
      setP(r);
      toast({
        updated: 'Profil mis à jour',
        'nothing-new': 'Rien de nouveau depuis la dernière mise à jour : le profil est déjà à jour',
        busy: 'Une mise à jour est déjà en cours',
        'not-yet': 'Pas encore assez de nouveaux signaux',
        unavailable: `Claude n'a pas pu mettre à jour le profil : ${(r.lastError ?? '').replace(/^\S+\s/, '').slice(0, 160) || 'raison inconnue'}. Réessaie plus tard.`,
      }[r.result]);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      <p className="small">Claude tient à jour un profil détaillé de tes goûts à partir de tes likes, rejets et questions. Il ne s'affiche pas, mais il oriente les recommandations.</p>
      <dl className="kv">
        <dt>Dernière mise à jour</dt><dd>{ago(p.updatedAt)}</dd>
        <dt>Nouveaux signaux en attente</dt><dd>{p.pendingSignals} <span className="muted">(mise à jour automatique dès 10, au plus une fois par heure)</span></dd>
        <dt>Exclu d'après tes notes</dt>
        <dd>{p.exclusions.length ? p.exclusions.join(', ') : <span className="muted">rien pour l'instant</span>}
          <span className="muted"> — pour changer, modifie « Autre chose à savoir » puis mets le profil à jour</span></dd>
      </dl>
      <button className="btn btn-ghost" onClick={update} disabled={busy || p.pendingSignals === 0} title={p.pendingSignals === 0 ? 'Rien de nouveau depuis la dernière mise à jour' : undefined}>{p.pendingSignals === 0 && !busy
        ? <><Check size={16} />Profil à jour</>
        : <><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? 'Claude réfléchit… (1 à 2 min)' : `Mettre à jour maintenant (${p.pendingSignals} nouveau${p.pendingSignals > 1 ? 'x' : ''})`}</>}</button>
    </div>
  );
}

const fr = (n: number) => n.toLocaleString('fr-FR');
/** ~4 s par recette acceptée (1 page toutes les 2,5 s + chargement, ~90 % acceptées). */
const duration = (recipes: number) => {
  const min = Math.round((recipes * 4) / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};

function CatalogCard() {
  const { data: s, failed, reload, setData } = useLoad(() => api.importStatus());
  const [busy, setBusy] = useState(false);
  if (!s) return <div className="card settings-card"><LoadState failed={failed} onRetry={reload} /></div>;
  const remaining = Math.max(0, s.target - s.imported);
  const reached = remaining === 0;
  const browsed = s.available - s.pending;
  // Estimation des recettes encore importables sur Marmiton, d'après le taux d'acceptation observé.
  const acceptance = browsed > 0 ? s.imported / browsed : 0.9;
  const left = Math.round(s.pending * acceptance);
  const add = async (n: number) => {
    setBusy(true);
    try {
      setData(await api.importMore(n));
      toast(`Import lancé : ${fr(n)} recettes de plus (≈ ${duration(n)}, l'app doit rester ouverte)`);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      {reached && s.pending > 0 && (
        <div className="goal-reached"><Check size={16} />Objectif atteint : {fr(s.imported)} recettes. Ajoute-en d'autres ci-dessous si tu veux plus de choix.</div>
      )}
      <p className="small">
        <b>{fr(s.imported)}</b> recettes dans ton catalogue
        {remaining > 0 ? <> · import en cours vers {fr(s.target)} (encore ≈ {duration(remaining)}, quand l'app est ouverte)</> : null}.
      </p>
      <p className="muted small">
        Marmiton liste {fr(s.available)} recettes : {fr(browsed)} déjà parcourues ({fr(s.rejected)} écartées pour note insuffisante),
        environ {fr(left)} encore importables.
      </p>
      <div className="add-recipes">
        <span className="muted">Ajouter des recettes :</span>
        {[500, 1000, 2500].map(n => (
          <button key={n} className="btn btn-ghost small-btn" disabled={busy || s.pending === 0} onClick={() => add(n)}><Plus size={14} />{fr(n)}</button>
        ))}
      </div>
      {s.pending === 0 && <p className="muted small" style={{ marginTop: 12 }}>Toutes les recettes disponibles sur Marmiton ont été parcourues.</p>}
      <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>Plus de recettes = plus de propositions faisables avec ton stock. L'import lit une page toutes les 2,5 s pour rester discret envers Marmiton, puis continue d'ajouter ~100 recettes par semaine.</p>
    </div>
  );
}

function DataCard() {
  return (
    <div className="card settings-card">
      <p className="small">Stock, placard, favoris, rejets, préférences, profil et conversations, dans un fichier JSON.</p>
      <a className="btn btn-ghost" href="/api/export" download><Download size={16} />Exporter mes données</a>
    </div>
  );
}

export function SettingsPage() {
  // Incrémenté à chaque enregistrement du questionnaire : le profil recompte ses signaux en attente.
  const [version, setVersion] = useState(0);
  return (
    <>
      <header className="page-head"><div><h1 className="h1">Réglages</h1></div></header>
      <h2 className="h2 settings-title">Mes préférences</h2>
      <div className="card settings-card"><QuestionnaireForm submitLabel="Enregistrer" onSaved={() => { invalidateLists(); setVersion(v => v + 1); toast('Préférences enregistrées'); }} /></div>
      <h2 className="h2 settings-title">Mes rejets</h2>
      <RejectionsCard />
      <h2 className="h2 settings-title">Profil</h2>
      <ProfileCard version={version} />
      <h2 className="h2 settings-title">Catalogue de recettes</h2>
      <CatalogCard />
      <h2 className="h2 settings-title">Mes données</h2>
      <DataCard />
    </>
  );
}
