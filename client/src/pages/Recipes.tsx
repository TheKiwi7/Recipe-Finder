import { useEffect } from 'react';
import { CircleDashed, Loader2, SearchX } from 'lucide-react';
import type { Mode } from '../api.ts';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { usePantry } from '../pantry-store.ts';
import { ensureList, loadMore, setFilters, useList } from '../recipes-store.ts';
import { navigate } from '../router.ts';

const TYPES = ['Tous', 'Plat', 'Entrée', 'Dessert', 'Apéro', 'Petit-déj.'];
const TIMES: Array<[number | null, string]> = [[null, 'Toutes durées'], [20, '≤ 20 min'], [45, '≤ 45 min']];

function SkeletonGrid() {
  return <div className="grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="rcard skeleton"><div className="img" /><div className="rcard-body"><i /><i /></div></div>)}</div>;
}

export function RecipesPage({ mode }: { mode: Mode }) {
  const pantry = usePantry();
  const list = useList(mode);
  const version = pantry?.version ?? 0;

  useEffect(() => { void ensureList(mode, version); }, [mode, version, list.stale]);

  const visible = list.items.length;
  const title = mode === 'ready' ? 'Recettes' : 'Presque';
  const sub = mode === 'ready'
    ? 'Faisables avec ce que tu as, sans rien acheter.'
    : 'Il te manque 1 à 3 ingrédients — souvent faciles à trouver.';

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">{title}</h1>
          <p className="sub">{sub}</p>
        </div>
      </header>

      <div className="chips">
        {TYPES.map(t => (
          <button key={t} className={`fchip ${list.filters.type === t ? 'on' : ''}`} onClick={() => setFilters(mode, { ...list.filters, type: t })}>{t}</button>
        ))}
        <span className="chip-sep" />
        {TIMES.map(([v, label]) => (
          <button key={label} className={`fchip ${list.filters.maxTime === v ? 'on' : ''}`} onClick={() => setFilters(mode, { ...list.filters, maxTime: v })}>{label}</button>
        ))}
      </div>

      {list.error && <div className="card empty"><b>Impossible de charger les recettes</b>{list.error}</div>}

      {!list.loaded && list.loading ? <SkeletonGrid /> : visible === 0 && list.loaded ? (
        <div className="card empty">
          <SearchX size={36} />
          <b>{mode === 'ready' ? 'Aucune recette faisable avec ton stock actuel' : 'Rien à proposer pour le moment'}</b>
          {mode === 'ready'
            ? <>Essaie un autre filtre, ajoute des ingrédients, ou regarde <a href="/presque" onClick={e => { e.preventDefault(); navigate('/presque'); }}>les recettes où il manque presque rien</a>.</>
            : 'Essaie un autre filtre ou ajoute des ingrédients à ton stock.'}
        </div>
      ) : (
        <>
          <div className="grid">{list.items.map(c => <RecipeCard key={c.id} card={c} showMissing={mode === 'almost'} />)}</div>
          {list.exhausted ? (
            <p className="endnote">
              {mode === 'ready'
                ? <>Plus d'autres recettes avec ton stock actuel — <a href="/presque" onClick={e => { e.preventDefault(); navigate('/presque'); }}><CircleDashed size={14} style={{ verticalAlign: '-2px' }} /> voir celles où il manque presque rien</a></>
                : 'Plus d’autres recettes pour ces filtres.'}
            </p>
          ) : (
            <button className="btn btn-ghost more" onClick={() => loadMore(mode)} disabled={list.loading}>
              {list.loading ? <Loader2 size={17} className="spin" /> : null}Charger 10 recettes de plus
            </button>
          )}
        </>
      )}
    </>
  );
}
