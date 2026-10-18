import { useRef, useState } from 'react';
import { ArrowRight, Check, Flame, Plus, ShoppingBasket, Trash2, X } from 'lucide-react';
import { api, UNITS, type PantryItem } from '../api.ts';
import { Autocomplete } from '../components/Autocomplete.tsx';
import { refreshPantry, usePantry } from '../pantry-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';

function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  return `il y a ${Math.round(min / 60)} h`;
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
      toast(item.showBase ? `Ajouté — compte comme « ${item.base} »` : `« ${item.label} » ajouté`);
      setLabel(''); setQty(''); setUnit(UNITS[0]);
      input.current?.focus();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="card add-row">
      <Autocomplete value={label} onChange={setLabel} onSubmit={add} placeholder="Ajouter un ingrédient… (ex. poireaux, crème fraîche)" inputRef={input} />
      <input className="field" inputMode="decimal" placeholder="Qté" value={qty} onChange={e => setQty(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} aria-label="Quantité" />
      <select className="field" value={unit} onChange={e => setUnit(e.target.value)} aria-label="Unité">
        {UNITS.map(u => <option key={u}>{u}</option>)}
      </select>
      <button className="btn btn-primary" onClick={() => add()} disabled={!label.trim()}><Plus size={17} />Ajouter</button>
    </div>
  );
}

function Row({ item }: { item: PantryItem }) {
  const [qty, setQty] = useState(item.qty?.toString().replace('.', ',') ?? '');
  const save = async (patch: Parameters<typeof api.updateItem>[1]) => {
    try { await api.updateItem(item.id, patch); await refreshPantry(); } catch (e) { toast((e as Error).message); }
  };
  const commitQty = () => {
    const v = parseQty(qty);
    if (v !== item.qty) save({ qty: v, unit: v === null ? null : item.unit ?? UNITS[0] });
  };
  const remove = async () => {
    await api.deleteItem(item.id);
    await refreshPantry();
    toast(`« ${item.label} » retiré`);
  };

  return (
    <li>
      <span className="label">
        {item.label}
        {item.showBase && <span className="base">compte comme : {item.base}</span>}
      </span>
      <span className="qty">
        <input className="field" inputMode="decimal" placeholder="—" value={qty} onChange={e => setQty(e.target.value)} onBlur={commitQty}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={`Quantité de ${item.label}`} />
        <select className="field" value={item.unit ?? ''} onChange={e => save({ unit: e.target.value || null })} aria-label={`Unité de ${item.label}`}>
          <option value="">—</option>
          {UNITS.map(u => <option key={u}>{u}</option>)}
        </select>
      </span>
      <button className={`urgent-btn ${item.urgent ? 'on' : ''}`} onClick={() => save({ urgent: !item.urgent })} title="Les recettes qui l'utilisent passeront en priorité">
        <Flame size={14} />À finir vite
      </button>
      <button className="icon-btn danger" onClick={remove} title="Retirer" aria-label={`Retirer ${item.label}`}><Trash2 size={17} /></button>
    </li>
  );
}

function Staples({ staples }: { staples: string[] }) {
  const [value, setValue] = useState('');
  const save = async (next: string[]) => { await api.setStaples(next); await refreshPantry(); };
  const add = async (v = value) => {
    if (!v.trim()) return;
    await save([...staples, v.trim()]);
    setValue('');
  };
  return (
    <div className="card staples">
      {staples.map(s => (
        <span className="chip" key={s}>{s}<button onClick={() => save(staples.filter(x => x !== s))} aria-label={`Retirer ${s} du placard`}><X size={13} /></button></span>
      ))}
      <Autocomplete value={value} onChange={setValue} onSubmit={add} placeholder="+ ajouter au placard" />
    </div>
  );
}

export function IngredientsPage() {
  const pantry = usePantry();
  if (!pantry) return null;

  const confirm = async () => {
    await api.confirm();
    await refreshPantry();
    navigate('/recettes');
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">Mes ingrédients</h1>
          <p className="sub">
            {pantry.items.length === 0 ? 'Ajoute ce que tu as dans ta cuisine.' : `${pantry.items.length} ingrédient${pantry.items.length > 1 ? 's' : ''} en stock`}
            {pantry.confirmedAt && ` · confirmé ${ago(pantry.confirmedAt)}`}
          </p>
        </div>
        <div className="confirm-bar">
          {pantry.gateOpen
            ? <button className="btn btn-ghost" onClick={() => navigate('/recettes')}>Voir les recettes<ArrowRight size={17} /></button>
            : <button className="btn btn-primary" onClick={confirm} disabled={pantry.items.length === 0}><Check size={17} />Mes ingrédients sont à jour</button>}
        </div>
      </header>

      <AddRow />

      <div className="section-title"><h2 className="h2">En stock</h2><span className="count">{pantry.items.length || ''}</span></div>
      <div className="card">
        {pantry.items.length === 0 ? (
          <div className="empty"><ShoppingBasket size={36} /><b>Ton stock est vide</b>Commence par ce que tu as au frigo : légumes, viande, fromages…</div>
        ) : (
          <ul className="pantry">{pantry.items.map(i => <Row key={`${i.id}-${i.qty}`} item={i} />)}</ul>
        )}
      </div>

      <div className="section-title"><h2 className="h2">Placard de base</h2><span className="muted">· toujours considéré comme disponible</span></div>
      <Staples staples={pantry.staples} />
    </>
  );
}
