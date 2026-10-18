import { useEffect, useState } from 'react';
import { ArrowLeft, Archive, ExternalLink, Minus, Plus, Star, ThumbsDown, Undo2 } from 'lucide-react';
import { api, type RecipeDetail } from '../api.ts';
import { RecipeImage, ReactButtons } from '../components/RecipeCard.tsx';
import { dishesLabel, fmtTime, scaleLine } from '../format.ts';
import { invalidateLists } from '../recipes-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><small>{label}</small><b>{value}</b></div>;
}

export function RecipeDetailPage({ id, onChat }: { id: number; onChat?: (r: RecipeDetail) => React.ReactNode }) {
  const [r, setR] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persons, setPersons] = useState<number | null>(null);
  const [pendingBans, setPendingBans] = useState<Set<string>>(new Set());

  useEffect(() => {
    setR(null); setError(null); setPersons(null);
    api.recipe(id).then(setR).catch(e => setError((e as Error).message));
  }, [id]);

  if (error) return <div className="card empty"><b>Recette introuvable</b>{error}</div>;
  if (!r) return <div className="detail-loading" />;

  const people = persons ?? r.persons;
  const factor = people / (r.servings || people);
  const available = new Set(r.available);
  const banned = new Set(r.banned);

  const toggleBan = async (base: string) => {
    if (pendingBans.has(base)) return; // un double-clic ne doit pas exclure puis réautoriser aussitôt
    const isBanned = banned.has(base);
    setPendingBans(s => new Set(s).add(base));
    try {
      if (isBanned) await api.unban(base); else await api.ban(base);
      // Mise à jour fonctionnelle : plusieurs clics rapides sur des lignes différentes s'additionnent.
      setR(cur => cur && { ...cur, banned: isBanned ? cur.banned.filter(b => b !== base) : [...cur.banned, base] });
      invalidateLists();
      toast(isBanned ? `« ${base} » à nouveau autorisé` : `Plus de recettes avec « ${base} »`);
    } catch (e) { toast((e as Error).message); }
    finally { setTimeout(() => setPendingBans(s => { const n = new Set(s); n.delete(base); return n; }), 800); }
  };

  return (
    <>
      <button className="back" onClick={() => (history.length > 1 ? history.back() : navigate('/recettes'))}><ArrowLeft size={17} />Retour</button>
      <div className="detail">
        <div className="detail-media">
          <RecipeImage src={r.image} className="detail-img" />
          <div className="detail-actions">
            <ReactButtons card={r} large onChange={reaction => setR({ ...r, reaction })} />
            {r.url && <a className="srclink" href={r.url} target="_blank" rel="noopener noreferrer">Voir sur Marmiton<ExternalLink size={15} /></a>}
          </div>
          {r.archived && <p className="archived"><Archive size={14} />Copie locale : la recette n'est plus disponible sur le site.</p>}
        </div>

        <div className="detail-body">
          <h1 className="h1">{r.name}</h1>
          <div className="meta detail-meta">
            {r.rating !== null && <span><Star size={14} />{r.rating.toFixed(1).replace('.', ',')} · {r.reviews} avis</span>}
            <span>{r.type}</span>
            {r.missing.length > 0 && <span className="missing-pill">Il te manque {r.missing.length} ingrédient{r.missing.length > 1 ? 's' : ''}</span>}
          </div>

          <div className="stats">
            <Stat label="Total" value={fmtTime(r.totalMin)} />
            <Stat label="Préparation" value={fmtTime(r.prepMin)} />
            <Stat label="Cuisson" value={fmtTime(r.cookMin)} />
            <Stat label="Vaisselle" value={dishesLabel(r.dishes).replace(' à laver', '')} />
          </div>

          <section className="block">
            <div className="block-head">
              <h2 className="h2">Ingrédients</h2>
              <span className="portions">
                <button onClick={() => setPersons(Math.max(1, people - 1))} aria-label="Une personne de moins"><Minus size={15} /></button>
                <b>{people} pers.</b>
                <button onClick={() => setPersons(people + 1)} aria-label="Une personne de plus"><Plus size={15} /></button>
              </span>
            </div>
            <ul className="ing">
              {r.ingredients.map((l, i) => {
                const isBanned = !!l.base && banned.has(l.base);
                const isMissing = !!l.base && !available.has(l.base);
                return (
                  <li key={i} className={`${isBanned ? 'banned' : ''} ${isMissing ? 'missing' : ''}`}>
                    <span className="dot" title={isMissing ? 'Pas dans ton stock' : 'Dans ton stock'} />
                    <span className="ing-text">{scaleLine(l.raw, l.qty, l.unit, factor)}</span>
                    {l.base && (
                      <button className="ban" disabled={pendingBans.has(l.base)} onClick={() => toggleBan(l.base!)} title={isBanned ? 'Annuler' : `Ne plus me proposer de recettes avec « ${l.base} »`}>
                        {isBanned ? <><Undo2 size={13} />Annuler</> : <><ThumbsDown size={13} />Je n'aime pas</>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {r.utensils.length > 0 && (
            <section className="block">
              <h2 className="h2">Ustensiles</h2>
              <div className="tools">{r.utensils.map(u => <span className="tool" key={u}>{u}</span>)}</div>
            </section>
          )}

          <section className="block">
            <h2 className="h2">Préparation</h2>
            <ol className="steps">{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </section>
        </div>
      </div>
      {onChat?.(r)}
    </>
  );
}
