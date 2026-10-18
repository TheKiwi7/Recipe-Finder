import { useEffect, useState } from 'react';
import { Download, RefreshCw, Undo2 } from 'lucide-react';
import { api, type ImportStatus, type ProfileStatus, type Rejections } from '../api.ts';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';
import { invalidateLists } from '../recipes-store.ts';
import { toast } from '../toast.tsx';

function ago(iso: string | null): string {
  if (!iso) return 'jamais';
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  return h < 1 ? "il y a moins d'une heure" : h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} jours`;
}

function RejectionsCard() {
  const [r, setR] = useState<Rejections | null>(null);
  const load = () => api.rejections().then(setR);
  useEffect(() => { void load(); }, []);
  if (!r) return null;

  const undoRecipe = async (id: number) => { await api.react(id, null); invalidateLists(); await load(); toast('Rejet annulé'); };
  const undoIngredient = async (base: string) => { await api.unban(base); invalidateLists(); await load(); toast(`« ${base} » à nouveau autorisé`); };

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

function ProfileCard() {
  const [p, setP] = useState<ProfileStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.profile().then(setP); }, []);
  if (!p) return null;
  const update = async () => {
    setBusy(true);
    try {
      const r = await api.updateProfile();
      setP(r);
      toast(r.updated ? 'Profil mis à jour' : 'Claude indisponible pour le moment, réessaie plus tard');
    } finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      <p className="small">Claude tient à jour un profil détaillé de tes goûts à partir de tes likes, rejets et questions. Il ne s'affiche pas, mais il oriente les recommandations.</p>
      <dl className="kv">
        <dt>Dernière mise à jour</dt><dd>{ago(p.updatedAt)}</dd>
        <dt>Nouveaux signaux en attente</dt><dd>{p.pendingSignals} <span className="muted">(mise à jour automatique dès 10, au plus une fois par jour)</span></dd>
      </dl>
      <button className="btn btn-ghost" onClick={update} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? 'Claude réfléchit…' : 'Mettre à jour maintenant'}</button>
    </div>
  );
}

function DataCard() {
  const [s, setS] = useState<ImportStatus | null>(null);
  useEffect(() => { api.importStatus().then(setS); }, []);
  return (
    <div className="card settings-card">
      <p className="small">Stock, placard, favoris, rejets, préférences, profil et conversations, dans un fichier JSON.</p>
      <a className="btn btn-ghost" href="/api/export" download><Download size={16} />Exporter mes données</a>
      {s && <p className="muted small" style={{ marginTop: 16 }}>Catalogue : {s.imported.toLocaleString('fr-FR')} recettes Marmiton{s.imported < s.target ? ` (import en cours, objectif ${s.target.toLocaleString('fr-FR')})` : ''} · {s.rejected.toLocaleString('fr-FR')} écartées pour note insuffisante.</p>}
    </div>
  );
}

export function SettingsPage() {
  return (
    <>
      <header className="page-head"><div><h1 className="h1">Réglages</h1></div></header>
      <h2 className="h2 settings-title">Mes préférences</h2>
      <div className="card settings-card"><QuestionnaireForm submitLabel="Enregistrer" onSaved={() => { invalidateLists(); toast('Préférences enregistrées'); }} /></div>
      <h2 className="h2 settings-title">Mes rejets</h2>
      <RejectionsCard />
      <h2 className="h2 settings-title">Profil</h2>
      <ProfileCard />
      <h2 className="h2 settings-title">Mes données</h2>
      <DataCard />
    </>
  );
}
