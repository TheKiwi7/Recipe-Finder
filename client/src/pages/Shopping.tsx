import { useEffect, useState } from 'react';
import { Check, CheckCheck, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { api, UNITS, type ShoppingItem } from '../api.ts';
import { Autocomplete } from '../components/Autocomplete.tsx';
import { fmtQty } from '../format.ts';
import { L, tName, tTerm, unitLabel, useTranslations } from '../i18n.ts';
import { refreshPantry } from '../pantry-store.ts';
import { navigate } from '../router.ts';
import { refreshShopping, setShopping, useShopping } from '../shopping-store.ts';
import { toast } from '../toast.tsx';

const parseQty = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')) || null);

/** Unité lisible : celles du menu du stock sont traduites, celles des recettes (« cuillères à soupe ») restent telles quelles. */
const unitText = (u: string | null) => (u ? (UNITS.includes(u) ? unitLabel(u) : tTerm(u)) : '');

function AddRow() {
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(UNITS[0]);
  const add = async (name = label) => {
    if (!name.trim()) return;
    try {
      setShopping(await api.addShopping({ label: name.trim(), qty: parseQty(qty), unit: qty.trim() ? unit : null }));
      setLabel(''); setQty(''); setUnit(UNITS[0]);
    } catch (e) { toast((e as Error).message); }
  };
  return (
    <div className="card add-row">
      <Autocomplete value={label} onChange={setLabel} onSubmit={add} placeholder={L('Ajouter à la liste… (ex. lait, citrons)', 'Add to the list… (e.g. milk, lemons)')} />
      <input className="field" inputMode="decimal" placeholder={L('Qté', 'Qty')} value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} aria-label={L('Quantité', 'Quantity')} />
      <select className="field" value={unit} onChange={e => setUnit(e.target.value)} aria-label={L('Unité', 'Unit')}>
        {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
      </select>
      <button className="btn btn-primary" onClick={() => add()} disabled={!label.trim()}><Plus size={17} />{L('Ajouter', 'Add')}</button>
    </div>
  );
}

function Row({ item }: { item: ShoppingItem }) {
  const act = async (action: () => Promise<ShoppingItem[]>, message?: string) => {
    try { setShopping(await action()); await refreshPantry(); if (message) toast(message); }
    catch (e) { toast((e as Error).message); }
  };
  return (
    <li>
      <span className="label">
        {tTerm(item.base)}
        {item.qty !== null && <span className="shop-qty"> · {fmtQty(item.qty, item.unit)} {unitText(item.unit)}</span>}
        {item.recipes.length > 0 && (
          <span className="base">
            {L('pour : ', 'for: ')}
            {item.recipes.map((r, i) => (
              <span key={r.id}>{i > 0 && ', '}<a href={`/recette/${r.id}`} onClick={e => { e.preventDefault(); navigate(`/recette/${r.id}`); }}>{tName(r.id, r.name)}</a></span>
            ))}
          </span>
        )}
      </span>
      <button className="urgent-btn" onClick={() => act(() => api.buyShopping(item.id), L(`${tTerm(item.base)} rangé dans ton stock`, `${tTerm(item.base)} added to your pantry`))}
        title={L('Acheté : passe dans ton stock', 'Bought: moves to your pantry')}>
        <Check size={14} />{L('Acheté', 'Bought')}
      </button>
      <button className="icon-btn danger" onClick={() => act(() => api.removeShopping(item.id))} title={L('Retirer', 'Remove')} aria-label={L(`Retirer ${item.base}`, `Remove ${tTerm(item.base)}`)}><Trash2 size={17} /></button>
    </li>
  );
}

export function ShoppingPage() {
  useTranslations();
  const items = useShopping();
  useEffect(() => { refreshShopping().catch(() => {}); }, []);
  const all = async (action: () => Promise<ShoppingItem[]>, message: string) => {
    try { setShopping(await action()); await refreshPantry(); toast(message); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">{L('Courses', 'Shopping')}</h1>
          <p className="sub">{L('Ce qu’il te manque pour les recettes que tu veux faire. Une fois acheté, c’est rangé dans ton stock.', 'What you’re missing for the recipes you want to make. Once bought, it goes into your pantry.')}</p>
        </div>
        {items && items.length > 0 && (
          <div className="confirm-bar">
            <button className="btn btn-ghost" onClick={() => all(api.clearShopping, L('Liste vidée', 'List cleared'))}><Trash2 size={16} />{L('Vider', 'Clear')}</button>
            <button className="btn btn-primary" onClick={() => all(api.buyAllShopping, L('Tout est rangé dans ton stock', 'Everything is in your pantry'))}><CheckCheck size={17} />{L('Tout est acheté', 'Bought everything')}</button>
          </div>
        )}
      </header>

      <AddRow />

      <div className="section-title"><h2 className="h2">{L('À acheter', 'To buy')}</h2><span className="count">{items?.length || ''}</span></div>
      <div className="card">
        {items && items.length === 0 ? (
          <div className="empty">
            <ShoppingCart size={36} />
            <b>{L('Ta liste est vide', 'Your list is empty')}</b>
            {L('Sur une recette, « Je la fais » ajoute ici ce qu’il te manque, pour le nombre de personnes choisi.', 'On a recipe, “I’ll make it” adds what you’re missing here, for the number of people you picked.')}
          </div>
        ) : (
          <ul className="pantry shop">{items?.map(i => <Row key={`${i.id}-${i.qty}`} item={i} />)}</ul>
        )}
      </div>
    </>
  );
}
