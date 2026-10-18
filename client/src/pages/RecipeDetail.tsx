import { useEffect, useState } from 'react';
import { ArrowLeft, Archive, ExternalLink, Languages, Loader2, Minus, Plus, RefreshCw, Star, ThumbsDown, Undo2 } from 'lucide-react';
import { api, type RecipeDetail, type RecipeTranslation } from '../api.ts';
import { RecipeImage, ReactButtons } from '../components/RecipeCard.tsx';
import { dishesLabel, fmtTime, scaleLine } from '../format.ts';
import { dec, L, lang, rememberName, tName, tTerm, typeLabel, useTranslations } from '../i18n.ts';
import { invalidateLists } from '../recipes-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><small>{label}</small><b>{value}</b></div>;
}

/** App en anglais : la recette (en français sur le site) traduite par l'IA, une fois, puis gardée sur le PC. */
function useRecipeTranslation(id: number) {
  const [tx, setTx] = useState<RecipeTranslation | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (lang === 'fr') return;
    // Le serveur traduit en arrière-plan (≈ 30 s la première fois) : on revient voir régulièrement,
    // sans garder de connexion ouverte, et on arrête en quittant la page.
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = () => api.recipeTranslation(id)
      .then(r => {
        if (!alive) return;
        if ('pending' in r) { timer = setTimeout(poll, 2500); return; }
        setTx(r); rememberName(id, r.name); setState('idle');
      })
      .catch(e => {
        if (!alive) return;
        // Serveur injoignable un instant (redémarrage) : on réessaie ; erreur de traduction : on l'affiche.
        if (e instanceof TypeError && ++failures < 5) { timer = setTimeout(poll, 3000); return; }
        setError((e as Error).message); setState('error');
      });
    setTx(null); setState('loading'); void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, attempt]);
  return { tx, state, error, retry: () => setAttempt(a => a + 1) };
}

export function RecipeDetailPage({ id, onChat }: { id: number; onChat?: (r: RecipeDetail) => React.ReactNode }) {
  useTranslations();
  const [r, setR] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persons, setPersons] = useState<number | null>(null);
  const [pendingBans, setPendingBans] = useState<Set<string>>(new Set());
  const { tx, state: txState, error: txError, retry } = useRecipeTranslation(id);

  useEffect(() => {
    setR(null); setError(null); setPersons(null);
    // Serveur injoignable un instant (il redémarre) : quelques nouvelles tentatives avant d'afficher l'erreur.
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (tries: number): void => void api.recipe(id)
      .then(d => { if (alive) setR(d); })
      .catch(e => {
        if (!alive) return;
        if (e instanceof TypeError && tries < 5) timer = setTimeout(() => load(tries + 1), 2000);
        else setError((e as Error).message);
      });
    load(0);
    return () => { alive = false; clearTimeout(timer); };
  }, [id]);

  if (error) return <div className="card empty"><b>{L('Recette introuvable', 'Recipe not found')}</b>{error}</div>;
  if (!r) return <div className="detail-loading"><Loader2 size={22} className="spin" />{L('Chargement de la recette…', 'Loading the recipe…')}</div>;

  const people = persons ?? r.persons;
  const factor = people / (r.servings || people);
  const available = new Set(r.available);
  const banned = new Set(r.banned);
  const steps = tx?.steps ?? r.steps;

  const toggleBan = async (base: string) => {
    if (pendingBans.has(base)) return; // un double-clic ne doit pas exclure puis réautoriser aussitôt
    const isBanned = banned.has(base);
    setPendingBans(s => new Set(s).add(base));
    try {
      if (isBanned) await api.unban(base); else await api.ban(base);
      // Mise à jour fonctionnelle : plusieurs clics rapides sur des lignes différentes s'additionnent.
      setR(cur => cur && { ...cur, banned: isBanned ? cur.banned.filter(b => b !== base) : [...cur.banned, base] });
      invalidateLists();
      toast(isBanned ? L(`« ${base} » à nouveau autorisé`, `“${tTerm(base)}” allowed again`) : L(`Plus de recettes avec « ${base} »`, `No more recipes with “${tTerm(base)}”`));
    } catch (e) { toast((e as Error).message); }
    finally { setTimeout(() => setPendingBans(s => { const n = new Set(s); n.delete(base); return n; }), 800); }
  };

  return (
    <>
      <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate('/recettes'))}><ArrowLeft size={17} />{L('Retour', 'Back')}</button>
      <div className="detail">
        <div className="detail-media">
          <RecipeImage src={r.image} className="detail-img" />
          <div className="detail-actions">
            <ReactButtons card={r} large onChange={reaction => setR({ ...r, reaction })} />
            {r.url && <a className="srclink" href={r.url} target="_blank" rel="noopener noreferrer">{L('Voir sur Marmiton', 'View on Marmiton (French)')}<ExternalLink size={15} /></a>}
          </div>
          {r.archived && <p className="archived"><Archive size={14} />{L('Copie locale : la recette n’est plus disponible sur le site.', 'Local copy: the recipe is no longer available on the site.')}</p>}
        </div>

        <div className="detail-body">
          <h1 className="h1">{tx?.name ?? tName(r.id, r.name)}</h1>
          <div className="meta detail-meta">
            {r.rating !== null && <span><Star size={14} />{dec(r.rating)} · {r.reviews} {L('avis', 'reviews')}</span>}
            <span>{typeLabel(r.type)}</span>
            {r.missing.length > 0 && <span className="missing-pill">{L(`Il te manque ${r.missing.length} ingrédient${r.missing.length > 1 ? 's' : ''}`, `${r.missing.length} ingredient${r.missing.length > 1 ? 's' : ''} missing`)}</span>}
          </div>
          {txState === 'loading' && <p className="tx-note"><Loader2 size={14} className="spin" />{L('Traduction de la recette…', 'Translating the recipe…')}</p>}
          {txState === 'error' && (
            <p className="tx-note"><Languages size={14} />{L('Traduction indisponible pour le moment, recette affichée en français', 'Translation unavailable for now, recipe shown in French')} ({txError})
              <button className="btn btn-ghost small-btn" onClick={retry}><RefreshCw size={13} />{L('Réessayer', 'Retry')}</button></p>
          )}

          <div className="stats">
            <Stat label={L('Total', 'Total')} value={fmtTime(r.totalMin)} />
            <Stat label={L('Préparation', 'Prep')} value={fmtTime(r.prepMin)} />
            <Stat label={L('Cuisson', 'Cooking')} value={fmtTime(r.cookMin)} />
            <Stat label={L('Vaisselle', 'Washing up')} value={dishesLabel(r.dishes).replace(L(' à laver', ' to wash'), '')} />
          </div>

          <section className="block">
            <div className="block-head">
              <h2 className="h2">{L('Ingrédients', 'Ingredients')}</h2>
              <span className="portions">
                <button onClick={() => setPersons(Math.max(1, people - 1))} aria-label={L('Une personne de moins', 'One person fewer')}><Minus size={15} /></button>
                <b>{people} {L('pers.', people > 1 ? 'people' : 'person')}</b>
                <button onClick={() => setPersons(people + 1)} aria-label={L('Une personne de plus', 'One more person')}><Plus size={15} /></button>
              </span>
            </div>
            <ul className="ing">
              {r.ingredients.map((l, i) => {
                const isBanned = !!l.base && banned.has(l.base);
                const isMissing = !!l.base && !available.has(l.base);
                return (
                  <li key={i} className={`${isBanned ? 'banned' : ''} ${isMissing ? 'missing' : ''}`}>
                    <span className="dot" title={isMissing ? L('Pas dans ton stock', 'Not in your pantry') : L('Dans ton stock', 'In your pantry')} />
                    <span className="ing-text">{scaleLine(tx?.ingredients[i] ?? l.raw, l.qty, l.unit, factor)}</span>
                    {l.base && (
                      <button className="ban" disabled={pendingBans.has(l.base)} onClick={() => toggleBan(l.base!)}
                        title={isBanned ? L('Annuler', 'Undo') : L(`Ne plus me proposer de recettes avec « ${l.base} »`, `Stop suggesting recipes with “${tTerm(l.base)}”`)}>
                        {isBanned ? <><Undo2 size={13} />{L('Annuler', 'Undo')}</> : <><ThumbsDown size={13} />{L('Je n’aime pas : ', 'I don’t like: ')}{tTerm(l.base)}</>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {r.utensils.length > 0 && (
            <section className="block">
              <h2 className="h2">{L('Ustensiles', 'Equipment')}</h2>
              <div className="tools">{r.utensils.map(u => <span className="tool" key={u}>{tTerm(u)}</span>)}</div>
            </section>
          )}

          <section className="block">
            <h2 className="h2">{L('Préparation', 'Method')}</h2>
            <ol className="steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </section>
        </div>
      </div>
      {onChat?.(r)}
    </>
  );
}
