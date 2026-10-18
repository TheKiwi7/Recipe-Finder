import { useRef, useState } from 'react';
import { ArrowRight, Check, Flame, Plus, ShoppingBasket, Trash2, X } from 'lucide-react';
import { api, UNITS, type PantryItem } from '../api.ts';
import { Autocomplete } from '../components/Autocomplete.tsx';
import { refreshPantry, usePantry } from '../pantry-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';
import { L, plural, tTerm, unitLabel, useTranslations } from '../i18n.ts';

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return L('à l’instant', 'just now');
  if (min < 60) return L(`il y a ${min} min`, `${min} min ago`);
  return L(`il y a ${Math.round(min / 60)} h`, `${Math.round(min / 60)} h ago`);
}

const parseQty = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')) || null);

function AddRow() {
  const [label, setLabel] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState(UNITS[0]);
  const input = useRef<HTMLInputElement>(null);

  const add = async (name = label) => {
    if (!name.trim()) return;
    try {
      const item = await api.addItem({ label: name.trim(), qty: parseQty(qty), unit: qty.trim() ? unit : null });
      await refreshPantry();
      toast(showBase(item) ? L(`Ajouté — compte comme « ${item.base} »`, `Added — counts as “${tTerm(item.base)}”`) : L(`« ${item.label} » ajouté`, `“${item.label}” added`));
      setLabel(''); setQty(''); setUnit(UNITS[0]);
      input.current?.focus();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="card add-row">
      <Autocomplete value={label} onChange={setLabel} onSubmit={add} placeholder={L('Ajouter un ingrédient… (ex. poireaux, crème fraîche)', 'Add an ingredient… (e.g. leeks, cream)')} inputRef={input} />
      <input className="field" inputMode="decimal" placeholder={L('Qté', 'Qty')} value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} aria-label={L('Quantité', 'Quantity')} />
      <select className="field" value={unit} onChange={e => setUnit(e.target.value)} aria-label={L('Unité', 'Unit')}>
        {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
      </select>
      <button className="btn btn-primary" onClick={() => add()} disabled={!label.trim()}><Plus size={17} />{L('Ajouter', 'Add')}</button>
    </div>
  );
}

/** « compte comme » : seulement si l'ingrédient reconnu diffère de la saisie (dans la langue affichée). */
const showBase = (item: PantryItem) => item.showBase && tTerm(item.base).toLowerCase() !== tTerm(item.label).trim().toLowerCase();

function Row({ item }: { item: PantryItem }) {
  useTranslations();
  const [qty, setQty] = useState(item.qty?.toString().replace('.', ',') ?? '');
  const save = async (patch: Parameters<typeof api.updateItem>[1]) => {
    try { await api.updateItem(item.id, patch); await refreshPantry(); } catch (e) { toast((e as Error).message); }
  };
  const commitQty = () => {
    const v = parseQty(qty);
    if (v !== item.qty) save({ qty: v, unit: v === null ? null : item.unit ?? UNITS[0] });
  };
  const remove = async () => {
    try {
      await api.deleteItem(item.id);
      await refreshPantry();
      toast(L(`« ${item.label} » retiré`, `“${item.label}” removed`));
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <li>
      <span className="label">
        {tTerm(item.label)}
        {showBase(item) && <span className="base">{L('compte comme : ', 'counts as: ')}{tTerm(item.base)}</span>}
      </span>
      <span className="qty">
        <input className="field" inputMode="decimal" placeholder="—" value={qty} onChange={e => setQty(e.target.value)} onBlur={commitQty}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={L(`Quantité de ${item.label}`, `Quantity of ${item.label}`)} />
        <select className="field" value={item.unit ?? ''} onChange={e => save({ unit: e.target.value || null })} aria-label={L(`Unité de ${item.label}`, `Unit of ${item.label}`)}>
          <option value="">—</option>
          {UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
        </select>
      </span>
      <button className={`urgent-btn ${item.urgent ? 'on' : ''}`} onClick={() => save({ urgent: !item.urgent })} title={L('Les recettes qui l’utilisent passeront en priorité', 'Recipes that use it will come first')}>
        <Flame size={14} />{L('À finir vite', 'Use soon')}
      </button>
      <button className="icon-btn danger" onClick={remove} title={L('Retirer', 'Remove')} aria-label={L(`Retirer ${item.label}`, `Remove ${item.label}`)}><Trash2 size={17} /></button>
    </li>
  );
}

// Basiques qui bloquent souvent une recette à un seul ingrédient près : ajout en un clic.
const STAPLE_SUGGESTIONS = ['levure chimique', 'vanille', 'bouillon', 'maïzena', 'vinaigre', 'moutarde', 'miel', 'cannelle', 'cumin', 'curry', 'paprika', 'muscade', 'thym', 'laurier', 'herbes de Provence', 'sauce soja', 'concentré de tomate', 'chapelure', 'sucre glace', 'bicarbonate'];

function Staples({ staples, pantryBases }: { staples: string[]; pantryBases: string[] }) {
  useTranslations();
  const [value, setValue] = useState('');
  const save = async (next: string[]): Promise<boolean> => {
    try { await api.setStaples(next); await refreshPantry(); return true; }
    catch (e) { toast((e as Error).message); return false; }
  };
  const add = async (v = value) => {
    if (!v.trim()) return;
    if (await save([...staples, v.trim()])) setValue('');
  };
  const have = new Set([...staples, ...pantryBases].map(s => s.toLowerCase()));
  const suggestions = STAPLE_SUGGESTIONS.filter(s => !have.has(s.toLowerCase()));
  return (
    <div className="card staples">
      <div className="staples-row">
        {staples.map(s => (
          <span className="chip" key={s}>{tTerm(s)}<button onClick={() => save(staples.filter(x => x !== s))} aria-label={L(`Retirer ${s} du placard`, `Remove ${tTerm(s)} from the cupboard`)}><X size={13} /></button></span>
        ))}
        <Autocomplete value={value} onChange={setValue} onSubmit={add} placeholder={L('+ ajouter au placard', '+ add to the cupboard')} />
      </div>
      {suggestions.length > 0 && (
        <div className="staples-sugg">
          <span className="muted">{L('Tu en as sûrement :', 'You probably have:')}</span>
          {suggestions.map(s => <button key={s} className="sugg-chip" onClick={() => add(s)}><Plus size={13} />{tTerm(s)}</button>)}
        </div>
      )}
    </div>
  );
}

export function IngredientsPage() {
  const pantry = usePantry();
  if (!pantry) return null;

  const confirm = async () => {
    try {
      await api.confirm();
      await refreshPantry();
      navigate('/recettes');
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">{L('Mes ingrédients', 'My ingredients')}</h1>
          <p className="sub">
            {pantry.items.length === 0
              ? L('Ajoute ce que tu as dans ta cuisine.', 'Add what you have in your kitchen.')
              : L(`${pantry.items.length} ingrédient${pantry.items.length > 1 ? 's' : ''} en stock`, `${pantry.items.length} ${plural(pantry.items.length, 'ingredient', 'ingredients')} in stock`)}
            {pantry.confirmedAt && ` · ${L('confirmé', 'confirmed')} ${ago(pantry.confirmedAt)}`}
          </p>
        </div>
        <div className="confirm-bar">
          {pantry.gateOpen
            ? <button className="btn btn-ghost" onClick={() => navigate('/recettes')}>{L('Voir les recettes', 'See the recipes')}<ArrowRight size={17} /></button>
            : <button className="btn btn-primary" onClick={confirm} disabled={pantry.items.length === 0}><Check size={17} />{L('Mes ingrédients sont à jour', 'My ingredients are up to date')}</button>}
        </div>
      </header>

      <AddRow />

      <div className="section-title"><h2 className="h2">{L('En stock', 'In stock')}</h2><span className="count">{pantry.items.length || ''}</span></div>
      <div className="card">
        {pantry.items.length === 0 ? (
          <div className="empty"><ShoppingBasket size={36} /><b>{L('Ton stock est vide', 'Your pantry is empty')}</b>{L('Commence par ce que tu as au frigo : légumes, viande, fromages…', 'Start with what’s in your fridge: vegetables, meat, cheese…')}</div>
        ) : (
          <ul className="pantry">{pantry.items.map(i => <Row key={`${i.id}-${i.qty}`} item={i} />)}</ul>
        )}
      </div>

      <div className="section-title"><h2 className="h2">{L('Placard de base', 'Cupboard basics')}</h2><span className="muted">· {L('toujours considéré comme disponible', 'always counted as available')}</span></div>
      <Staples staples={pantry.staples} pantryBases={pantry.items.map(i => i.base)} />
    </>
  );
}
