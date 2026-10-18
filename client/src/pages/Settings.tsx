import { useState } from 'react';
import { Check, Download, Eye, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { api } from '../api.ts';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';
import { AiCard } from '../components/AiCard.tsx';
import { MembersCard } from '../components/MembersCard.tsx';
import { invalidateLists } from '../recipes-store.ts';
import { toast } from '../toast.tsx';
import { LoadState, useLoad } from '../use-load.tsx';
import { LangSwitch } from '../components/LangSwitch.tsx';
import { TranslatedName } from '../components/RecipeCard.tsx';
import { L, num, tTerm, typeLabel, useTranslations } from '../i18n.ts';

function ago(iso: string | null): string {
  if (!iso) return L('jamais', 'never');
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  return h < 1 ? L('il y a moins d’une heure', 'less than an hour ago') : h < 48 ? L(`il y a ${h} h`, `${h} h ago`) : L(`il y a ${Math.round(h / 24)} jours`, `${Math.round(h / 24)} days ago`);
}

function RejectionsCard() {
  useTranslations();
  const { data: r, failed, reload } = useLoad(() => api.rejections());
  if (!r) return <div className="card settings-card"><LoadState failed={failed} onRetry={reload} /></div>;

  const undo = async (action: () => Promise<unknown>, message: string) => {
    try { await action(); invalidateLists(); await reload(); toast(message); } catch (e) { toast((e as Error).message); }
  };
  const undoRecipe = (id: number) => undo(() => api.react(id, null), L('Rejet annulé', 'Rejection undone'));
  const undoIngredient = (base: string) => undo(() => api.unban(base), L(`« ${base} » à nouveau autorisé`, `“${tTerm(base)}” allowed again`));

  return (
    <div className="card settings-card">
      <h3 className="h3">{L('Ingrédients rejetés', 'Rejected ingredients')}</h3>
      {r.ingredients.length === 0 ? <p className="muted small">{L('Aucun.', 'None.')}</p> : (
        <div className="qchips">{r.ingredients.map(i => <span className="chip" key={i.base}>{tTerm(i.base)}<button onClick={() => undoIngredient(i.base)} title={L('Annuler', 'Undo')} aria-label={L(`Autoriser ${i.base}`, `Allow ${tTerm(i.base)}`)}><Undo2 size={13} /></button></span>)}</div>
      )}
      <h3 className="h3" style={{ marginTop: 22 }}>{L('Recettes rejetées', 'Rejected recipes')}</h3>
      {r.recipes.length === 0 ? <p className="muted small">{L('Aucune.', 'None.')}</p> : (
        <ul className="rej-list">
          {r.recipes.map(x => (
            <li key={x.id}>
              {x.image ? <img src={x.image} alt="" /> : <span className="rej-ph" />}
              <span className="rej-name"><TranslatedName id={x.id} name={x.name} /></span>
              <button className="btn btn-ghost small-btn" onClick={() => undoRecipe(x.id)}><Undo2 size={14} />{L('Annuler', 'Undo')}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfileCard({ version }: { version: number }) {
  useTranslations();
  const { data: p, failed, reload, setData: setP } = useLoad(() => api.profile(), [version]);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  if (!p) return <div className="card settings-card"><LoadState failed={failed} onRetry={reload} /></div>;
  const update = async () => {
    setBusy(true);
    try {
      const r = await api.updateProfile();
      setP(r);
      toast({
        updated: L('Profil mis à jour', 'Profile updated'),
        'nothing-new': L('Rien de nouveau depuis la dernière mise à jour : le profil est déjà à jour', 'Nothing new since the last update: the profile is up to date'),
        busy: L('Une mise à jour est déjà en cours', 'An update is already running'),
        'not-yet': L('Pas encore assez de nouveaux signaux', 'Not enough new signals yet'),
        unavailable: L(`L’IA n’a pas pu mettre à jour le profil : ${(r.lastError ?? '').replace(/^\S+\s/, '').slice(0, 160) || 'raison inconnue'}. Réessaie plus tard.`, `The AI could not update the profile: ${(r.lastError ?? '').replace(/^\S+\s/, '').slice(0, 160) || 'unknown reason'}. Try again later.`),
      }[r.result]);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      <p className="small">{L('L’IA tient à jour un profil détaillé de tes goûts à partir de tes likes, rejets, questions et de tes notes. Il oriente les recommandations.', 'The AI keeps a detailed profile of your tastes from your likes, rejections, questions and notes. It steers the recommendations.')}</p>
      <dl className="kv">
        <dt>{L('Dernière mise à jour', 'Last update')}</dt><dd>{ago(p.updatedAt)}</dd>
        <dt>{L('Nouveaux signaux en attente', 'New signals waiting')}</dt><dd>{p.pendingSignals} <span className="muted">{L('(mise à jour automatique dès 10, au plus une fois par heure)', '(automatic update from 10, at most once an hour)')}</span></dd>
        <dt>{L('Exclu d’après tes notes', 'Excluded from your notes')}</dt>
        <dd>{p.exclusions.length ? p.exclusions.map(tTerm).join(', ') : <span className="muted">{L('rien pour l’instant', 'nothing yet')}</span>}
          <span className="muted">{L(' — pour changer, modifie « Autre chose à savoir » puis mets le profil à jour', ' — to change it, edit “Anything else to know” then update the profile')}</span></dd>
      </dl>
      <button className="btn btn-ghost" onClick={update} disabled={busy || p.pendingSignals === 0} title={p.pendingSignals === 0 ? L('Rien de nouveau depuis la dernière mise à jour', 'Nothing new since the last update') : undefined}>{p.pendingSignals === 0 && !busy
        ? <><Check size={16} />{L('Profil à jour', 'Profile up to date')}</>
        : <><RefreshCw size={16} className={busy ? 'spin' : ''} />{busy ? L('L’IA réfléchit… (jusqu’à 2 min)', 'The AI is thinking… (up to 2 min)') : L(`Mettre à jour maintenant (${p.pendingSignals} nouveau${p.pendingSignals > 1 ? 'x' : ''})`, `Update now (${p.pendingSignals} new)`)}</>}</button>
      {p.hasProfile && <button className="btn btn-ghost" style={{ marginLeft: 10 }} onClick={() => setShow(v => !v)}><Eye size={16} />{show ? L('Masquer mon profil', 'Hide my profile') : L('Voir mon profil', 'View my profile')}</button>}
      {show && <ProfileDetails version={version + (p.updatedAt ? Date.parse(p.updatedAt) : 0)} />}
    </div>
  );
}

const fmtW = (w: Record<string, number> | undefined, sign: 1 | -1) =>
  Object.entries(w ?? {}).filter(([, v]) => v * sign > 0).sort((a, b) => b[1] * sign - a[1] * sign).map(([k]) => k);

/** Le profil tel que l'IA l'a rédigé, et ce qu'elle en retient pour le classement. */
function ProfileDetails({ version }: { version: number }) {
  useTranslations();
  const { data: d, failed, reload } = useLoad(() => api.profileDetails(), [version]);
  if (!d) return <LoadState failed={failed} onRetry={reload} />;
  const likes = [...fmtW(d.weights.ingredients, 1), ...fmtW(d.weights.keywords, 1)].map(tTerm);
  const dislikes = [...fmtW(d.weights.ingredients, -1), ...fmtW(d.weights.keywords, -1)].map(tTerm);
  return (
    <div className="profile-details">
      <h3 className="h3">{L('Ce que l’IA a écrit sur toi', 'What the AI wrote about you')}</h3>
      <p className="profile-text">{d.text || L('Pas encore de profil.', 'No profile yet.')}</p>
      <dl className="kv">
        {likes.length > 0 && <><dt>{L('Mis en avant', 'Favoured')}</dt><dd>{likes.join(', ')}</dd></>}
        {dislikes.length > 0 && <><dt>{L('Évité', 'Avoided')}</dt><dd>{dislikes.join(', ')}</dd></>}
        {d.weights.exclude?.length ? <><dt>{L('Exclu', 'Excluded')}</dt><dd>{d.weights.exclude.map(tTerm).join(', ')}</dd></> : null}
        {d.weights.maxTotalMin ? <><dt>{L('Temps visé', 'Target time')}</dt><dd>{d.weights.maxTotalMin} min</dd></> : null}
      </dl>
    </div>
  );
}

const fr = num;
/** ~2,2 s par recette gardée (mesuré : 1 page toutes les ~1,85 s, ~90 % gardées). */
const duration = (recipes: number) => {
  const min = Math.round((recipes * 2.2) / 60);
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
  const skippedPct = Math.round(100 * (1 - acceptance));
  const capped = s.target >= s.reachable; // l'objectif choisi dépasse ce que Marmiton permet : affiché au maximum
  const add = async (n: number) => {
    setBusy(true);
    try {
      setData(await api.importMore(n));
      toast(L(`Import lancé : ${fr(n)} recettes de plus (≈ ${duration(n)}, l’app doit rester ouverte)`, `Import started: ${fr(n)} more recipes (≈ ${duration(n)}, keep the app open)`));
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="card settings-card">
      {reached && s.pending > 0 && (
        <div className="goal-reached"><Check size={16} />{L(`Objectif atteint : ${fr(s.imported)} recettes. Ajoute-en d’autres ci-dessous si tu veux plus de choix.`, `Goal reached: ${fr(s.imported)} recipes. Add more below if you want more choice.`)}</div>
      )}
      <p className="small">
        <b>{fr(s.imported)}</b> {L('recettes dans ton catalogue', 'recipes in your catalogue')}
        {remaining > 0 ? L(` · import en cours vers ${fr(s.target)}${capped ? ', le maximum possible' : ''} (encore ≈ ${duration(remaining)}, quand l’app est ouverte)`, ` · importing up to ${fr(s.target)}${capped ? ', the most possible' : ''} (≈ ${duration(remaining)} left, while the app is open)`) : null}.
      </p>
      <p className="muted small">
        {L(`Marmiton publie ${fr(s.available)} recettes dans son plan du site (le site en annonce davantage, mais les autres n’y sont pas listées). L’app écarte celles qui sont trop mal notées, environ ${skippedPct} % : ton catalogue peut donc atteindre environ ${fr(s.reachable)} recettes. Déjà lues : ${fr(browsed)}, dont ${fr(s.rejected)} écartées ; encore à lire : ${fr(s.pending)}, soit environ ${fr(left)} recettes de plus. La liste est relue chaque semaine.`,
          `Marmiton publishes ${fr(s.available)} recipes in its sitemap (the site announces more, but the others aren’t listed there). The app skips those with a low rating, about ${skippedPct}%: your catalogue can therefore reach about ${fr(s.reachable)} recipes. Already read: ${fr(browsed)}, of which ${fr(s.rejected)} skipped; still to read: ${fr(s.pending)}, i.e. about ${fr(left)} more recipes. The list is re-read every week.`)}
      </p>
      <div className="add-recipes">
        <span className="muted">{L('Ajouter des recettes :', 'Add recipes:')}</span>
        {[500, 1000, 2500].map(n => (
          <button key={n} className="btn btn-ghost small-btn" disabled={busy || s.pending === 0 || s.target >= s.reachable} onClick={() => add(n)}><Plus size={14} />{fr(n)}</button>
        ))}
      </div>
      {s.pending > 0 && s.target >= s.reachable && <p className="muted small" style={{ marginTop: 12 }}>{L('Ton objectif couvre déjà toutes les recettes encore importables depuis Marmiton.', 'Your goal already covers every recipe still importable from Marmiton.')}</p>}
      {s.pending === 0 && <p className="muted small" style={{ marginTop: 12 }}>{L('Toutes les recettes disponibles sur Marmiton ont été parcourues.', 'Every recipe available on Marmiton has been browsed.')}</p>}
      <ImportPriority />
      <p className="muted small" style={{ marginTop: 12, marginBottom: 0 }}>{L('Plus de recettes = plus de propositions faisables avec ton stock. L’import lit une page toutes les 1,5 s pour rester discret envers Marmiton, puis continue d’ajouter ~100 recettes par semaine.', 'More recipes = more suggestions doable with your pantry. The import reads one page every 1.5 s to stay gentle on Marmiton, then keeps adding ~100 recipes a week.')}</p>
    </div>
  );
}

const IMPORT_TYPES = ['Plat', 'Entrée', 'Accompagnement', 'Dessert', 'Apéro', 'Petit-déj.', 'Boisson', 'Sauce'];

/** Types de recettes à importer en priorité (le type est deviné d'après le nom, avant de lire la page). */
function ImportPriority() {
  const { data: p, setData } = useLoad(() => api.importPriority());
  if (!p) return null;
  const toggle = async (t: string) => {
    const types = p.types.includes(t) ? p.types.filter(x => x !== t) : [...p.types, t];
    try { setData(await api.setImportPriority(types)); } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="import-priority">
      <span className="muted small">{L('Importer en priorité :', 'Import first:')}</span>
      <div className="qchips">
        {IMPORT_TYPES.map(t => <button key={t} className={`fchip ${p.types.includes(t) ? 'on' : ''}`} onClick={() => toggle(t)}>{typeLabel(t)}</button>)}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        {p.types.length === 0
          ? L('Aucune priorité : les recettes arrivent dans un ordre aléatoire, tous types mélangés.', 'No priority: recipes arrive in random order, all types mixed.')
          : p.remaining > 0 && p.baseline >= 0.65
            ? L(`Ces types font déjà la majorité des recettes (${Math.round(p.baseline * 10)} sur 10) : la priorité change peu de choses. ${num(p.remaining)} recettes prioritaires restent à importer, puis l’import continue avec les autres types.`,
              `These types are already most recipes (${Math.round(p.baseline * 10)} in 10): the priority makes little difference. ${num(p.remaining)} priority recipes are left to import, then the import carries on with the other types.`)
          : p.remaining > 0
            ? L(`Ces types passent en premier : environ 8 recettes importées sur 10 en seront (contre ${Math.max(1, Math.round(p.baseline * 10))} sur 10 sans priorité). Ce n’est pas un filtre : le type n’est connu qu’une fois la recette lue, l’app le devine d’après son nom. ${num(p.remaining)} recettes prioritaires restent à importer ; ensuite, l’import continue avec les autres types.`,
              `These types come first: about 8 in 10 imported recipes will be of them (vs ${Math.max(1, Math.round(p.baseline * 10))} in 10 without priority). It isn’t a filter: a recipe’s type is only known once it’s read, so the app guesses it from its name. ${num(p.remaining)} priority recipes are left to import; after that, the import carries on with the other types.`)
            : L('Plus de nouvelles recettes de ces types à importer : l’import continue avec les autres types.', 'No more new recipes of these types to import: the import carries on with the other types.')}
      </p>
    </div>
  );
}

function DataCard() {
  return (
    <div className="card settings-card">
      <p className="small">{L('Stock, placard, favoris, rejets, préférences, profil et conversations, dans un fichier JSON.', 'Pantry, cupboard, favourites, rejections, preferences, profile and conversations, in a JSON file.')}</p>
      <a className="btn btn-ghost" href="/api/export" download><Download size={16} />{L('Exporter mes données', 'Export my data')}</a>
    </div>
  );
}

export function SettingsPage() {
  // Incrémenté à chaque enregistrement du questionnaire : le profil recompte ses signaux en attente.
  const [version, setVersion] = useState(0);
  return (
    <>
      <header className="page-head"><div><h1 className="h1">{L('Réglages', 'Settings')}</h1></div></header>
      <h2 className="h2 settings-title">{L('Langue', 'Language')}</h2>
      <div className="card settings-card">
        <LangSwitch />
        <p className="muted small" style={{ margin: '12px 0 0' }}>{L('L’app est pensée pour le français : les recettes viennent de Marmiton, en français. Elle fonctionne aussi en anglais, mais tout doit d’abord être traduit par l’IA : quelques secondes pour les noms, 15 à 30 s pour une recette la première fois qu’elle s’ouvre (ensuite c’est instantané, la traduction est gardée sur ce PC). Sans IA, les recettes restent en français.', 'The app is designed for French: recipes come from Marmiton, in French. It also works in English, but everything must first be translated by the AI: a few seconds for names, 15 to 30 s for a recipe the first time it opens (then it’s instant, the translation is kept on this PC). Without an AI, recipes stay in French.')}</p>
      </div>
      <h2 className="h2 settings-title">{L('Mes préférences', 'My preferences')}</h2>
      <div className="card settings-card"><QuestionnaireForm submitLabel={L('Enregistrer', 'Save')} onSaved={() => { invalidateLists(); setVersion(v => v + 1); toast(L('Préférences enregistrées', 'Preferences saved')); }} /></div>
      <h2 className="h2 settings-title">{L('Pour qui je cuisine', 'Who I cook for')}</h2>
      <div className="card settings-card"><MembersCard /></div>
      <h2 className="h2 settings-title">{L('Intelligence artificielle', 'Artificial intelligence')}</h2>
      <div className="card settings-card"><AiCard /></div>
      <h2 className="h2 settings-title">{L('Mes rejets', 'My rejections')}</h2>
      <RejectionsCard />
      <h2 className="h2 settings-title">{L('Profil', 'Profile')}</h2>
      <ProfileCard version={version} />
      <h2 className="h2 settings-title">{L('Catalogue de recettes', 'Recipe catalogue')}</h2>
      <CatalogCard />
      <h2 className="h2 settings-title">{L('Mes données', 'My data')}</h2>
      <DataCard />
    </>
  );
}
