import { useEffect } from 'react';
import { CircleDashed, Loader2, SearchX } from 'lucide-react';
import type { Mode } from '../api.ts';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { usePantry } from '../pantry-store.ts';
import { ensureList, listFilters, loadMore, setFilters, useList } from '../recipes-store.ts';
import { navigate } from '../router.ts';
import { refreshMembers, toggleEater, useMembers } from '../members-store.ts';
import { toast } from '../toast.tsx';
import { L, memberName, typeLabel } from '../i18n.ts';

/** « Pour : Moi · Julie · Léo » — qui mange ce repas (affiché dès qu'il y a plusieurs membres). */
function EatersFilter({ mode }: { mode: Mode }) {
  const data = useMembers();
  useEffect(() => { if (!data) refreshMembers().catch(() => {}); }, [data]);
  if (!data || data.members.length < 2) return null;
  const toggle = async (id: number) => {
    try { await toggleEater(id); await setFilters(mode, listFilters(mode)); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="chips eaters">
      <span className="muted small">{L('Pour :', 'For:')}</span>
      {data.members.map(m => (
        <button key={m.id} className={`fchip ${data.eaters.includes(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)} aria-pressed={data.eaters.includes(m.id)}>{memberName(m)}</button>
      ))}
      <span className="muted small">· {data.eaters.length} {L('pers.', data.eaters.length > 1 ? 'people' : 'person')}</span>
    </div>
  );
}

const TYPES = ['Tous', 'Plat', 'Entrée', 'Accompagnement', 'Dessert', 'Apéro', 'Petit-déj.', 'Boisson', 'Sauce'];
const TIMES: Array<[number | null, string]> = [[null, L('Toutes durées', 'Any time')], [20, '≤ 20 min'], [45, '≤ 45 min']];

function SkeletonGrid() {
  return <div className="grid">{Array.from({ length: 8 }, (_, i) => <div key={i} className="rcard skeleton"><div className="img" /><div className="rcard-body"><i /><i /></div></div>)}</div>;
}

export function RecipesPage({ mode }: { mode: Mode }) {
  const pantry = usePantry();
  const list = useList(mode);
  const version = pantry?.version ?? 0;

  useEffect(() => { void ensureList(mode, version); }, [mode, version, list.stale]);

  const visible = list.items.length;
  const title = mode === 'ready' ? L('Recettes', 'Recipes') : L('Presque', 'Almost');
  const sub = mode === 'ready'
    ? L('Faisables avec ce que tu as, sans rien acheter.', 'Doable with what you have, nothing to buy.')
    : L('Il te manque 1 à 3 ingrédients — souvent faciles à trouver.', 'You’re missing 1 to 3 ingredients — usually easy to find.');

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">{title}</h1>
          <p className="sub">{sub}</p>
        </div>
      </header>

      <EatersFilter mode={mode} />
      <div className="chips">
        {TYPES.map(t => (
          <button key={t} className={`fchip ${list.filters.type === t ? 'on' : ''}`} onClick={() => setFilters(mode, { ...list.filters, type: t })}>{typeLabel(t)}</button>
        ))}
        <span className="chip-sep" />
        {TIMES.map(([v, label]) => (
          <button key={label} className={`fchip ${list.filters.maxTime === v ? 'on' : ''}`} onClick={() => setFilters(mode, { ...list.filters, maxTime: v })}>{label}</button>
        ))}
      </div>

      {list.error && <div className="card empty"><b>{L('Impossible de charger les recettes', 'Could not load the recipes')}</b>{list.error}</div>}

      {!list.loaded && list.loading ? <SkeletonGrid /> : visible === 0 && list.loaded ? (
        <div className="card empty">
          <SearchX size={36} />
          <b>{mode === 'ready' ? L('Aucune recette faisable avec ton stock actuel', 'No recipe doable with your current pantry') : L('Rien à proposer pour le moment', 'Nothing to suggest for now')}</b>
          {mode === 'ready'
            ? <>{L('Essaie un autre filtre, ajoute des ingrédients, ou regarde ', 'Try another filter, add ingredients, or look at ')}<a href="/presque" onClick={e => { e.preventDefault(); navigate('/presque'); }}>{L('les recettes où il manque presque rien', 'the recipes where almost nothing is missing')}</a>.</>
            : L('Essaie un autre filtre ou ajoute des ingrédients à ton stock.', 'Try another filter or add ingredients to your pantry.')}
        </div>
      ) : (
        <>
          <div className="grid">{list.items.map(c => <RecipeCard key={c.id} card={c} showMissing={mode === 'almost'} showType={list.filters.type === 'Tous'} />)}</div>
          {list.exhausted ? (
            <p className="endnote">
              {mode === 'ready'
                ? <>{L('Plus d’autres recettes avec ton stock actuel — ', 'No more recipes with your current pantry — ')}<a href="/presque" onClick={e => { e.preventDefault(); navigate('/presque'); }}><CircleDashed size={14} style={{ verticalAlign: '-2px' }} /> {L('voir celles où il manque presque rien', 'see those where almost nothing is missing')}</a></>
                : L('Plus d’autres recettes pour ces filtres.', 'No more recipes for these filters.')}
            </p>
          ) : (
            <button className="btn btn-ghost more" onClick={() => loadMore(mode)} disabled={list.loading}>
              {list.loading ? <Loader2 size={17} className="spin" /> : null}{L('Charger 10 recettes de plus', 'Load 10 more recipes')}
            </button>
          )}
        </>
      )}
    </>
  );
}
