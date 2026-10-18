import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api } from '../api.ts';

function Highlight({ text, query }: { text: string; query: string }) {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (!query.trim() || i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + query.trim().length)}</mark>{text.slice(i + query.trim().length)}</>;
}

/**
 * Saisie libre avec suggestions tirées du vocabulaire du catalogue. Entrée valide la saisie.
 * submitOnPick : choisir une suggestion l'ajoute aussitôt (listes de puces : placard, rejets, allergies) ; sinon elle
 * remplit seulement le champ (ajout au stock, où l'on précise ensuite la quantité).
 */
export function Autocomplete({ value, onChange, onSubmit, placeholder, inputRef, submitOnPick }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  submitOnPick?: boolean;
}) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (!q) { setItems([]); return; }
    const id = ++seq.current;
    const t = setTimeout(() => api.suggest(q).then(r => { if (id === seq.current) { setItems(r); setActive(-1); } }).catch(() => {}), 120);
    return () => clearTimeout(t);
  }, [value]);

  const pick = (v: string) => { onChange(v); setOpen(false); setItems([]); if (submitOnPick) onSubmit(v); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const shown = open && items.length > 0;
    if (e.key === 'ArrowDown' && shown) { e.preventDefault(); setActive(a => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp' && shown) { e.preventDefault(); setActive(a => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown && active >= 0) pick(items[active]);
      else { setOpen(false); onSubmit(value); }
    }
  };

  return (
    <div className="ac">
      <input
        ref={inputRef}
        className="field"
        value={value}
        placeholder={placeholder}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
      />
      {open && items.length > 0 && (
        <ul className="ac-list" role="listbox">
          {items.map((s, i) => (
            <li key={s} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(s); }}>
              <Highlight text={s} query={value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
