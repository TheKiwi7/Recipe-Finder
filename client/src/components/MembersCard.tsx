import { useEffect, useState } from 'react';
import { Trash2, UserPlus, X } from 'lucide-react';
import { api, type Member } from '../api.ts';
import { refreshMembers, useMembers } from '../members-store.ts';
import { invalidateLists } from '../recipes-store.ts';
import { toast } from '../toast.tsx';
import { Autocomplete } from './Autocomplete.tsx';

const DIETS: Array<[Member['diet'], string]> = [['omnivore', 'Mange de tout'], ['pescetarian', 'Pas de viande'], ['vegetarian', 'Végétarien'], ['vegan', 'Végan']];

async function save(id: number, patch: Partial<Omit<Member, 'id' | 'isSelf'>>) {
  try { await api.updateMember(id, patch); await refreshMembers(); invalidateLists(); }
  catch (e) { toast((e as Error).message); }
}

function ChipList({ label, hint, values, placeholder, onChange }: { label: string; hint: string; values: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  const add = (v = input) => {
    const x = v.trim().toLowerCase();
    if (x && !values.includes(x)) onChange([...values, x]);
    setInput('');
  };
  return (
    <div className="member-field">
      <span className="member-label">{label}<small>{hint}</small></span>
      <div className="qchips">
        {values.map(v => <span className="chip" key={v}>{v}<button onClick={() => onChange(values.filter(x => x !== v))} aria-label={`Retirer ${v}`}><X size={13} /></button></span>)}
        <div className="qchip-input"><Autocomplete value={input} onChange={setInput} onSubmit={add} placeholder={placeholder} /></div>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: Member }) {
  const [name, setName] = useState(m.name);
  const [notes, setNotes] = useState(m.notes);
  useEffect(() => { setName(m.name); setNotes(m.notes); }, [m.name, m.notes]);

  return (
    <div className="member">
      <div className="member-head">
        <input className="field member-name" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && save(m.id, { name })}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Prénom" />
        {m.isSelf && <span className="ai-pill ok">Moi</span>}
        {!m.isSelf && (
          <button className="icon-btn danger" title={`Retirer ${m.name}`} aria-label={`Retirer ${m.name}`}
            onClick={async () => { await api.deleteMember(m.id); await refreshMembers(); invalidateLists(); toast(`${m.name} retiré·e`); }}><Trash2 size={17} /></button>
        )}
      </div>
      {m.isSelf ? (
        <p className="muted small member-self">Tes goûts, allergies et rejets sont dans « Mes préférences », « Mes rejets » et ton profil.</p>
      ) : (
        <div className="member-body">
          <div className="member-field">
            <span className="member-label">Régime</span>
            <div className="seg">{DIETS.map(([v, l]) => <button key={v} className={m.diet === v ? 'on' : ''} onClick={() => save(m.id, { diet: v })}>{l}</button>)}</div>
          </div>
          <ChipList label="Allergies" hint="exclues strictement, par famille (« gluten », « lactose », « fruits à coque »…)" values={m.allergies} placeholder="+ allergie" onChange={allergies => save(m.id, { allergies })} />
          <ChipList label="N'aime pas" hint="aucune recette qui en contient (« poisson » écarte tous les poissons)" values={m.aversions} placeholder="+ ingrédient" onChange={aversions => save(m.id, { aversions })} />
          <div className="member-field">
            <span className="member-label">Notes<small>pour l'IA (goûts, âge…)</small></span>
            <textarea className="field area" rows={2} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== m.notes && save(m.id, { notes })} placeholder="Ex. : 6 ans, adore les pâtes, pas fan des plats épicés" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Réglages → « Pour qui je cuisine » : les membres de la famille et leurs contraintes. */
export function MembersCard() {
  const data = useMembers();
  const [name, setName] = useState('');
  useEffect(() => { void refreshMembers(); }, []);
  if (!data) return null;

  const add = async () => {
    if (!name.trim()) return;
    try { const m = await api.addMember(name); setName(''); await refreshMembers(); invalidateLists(); toast(`${m.name} ajouté·e`); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="members">
      <p className="small">Ajoute les personnes pour qui tu cuisines. Dans Recettes et Presque, tu choisis ensuite qui mange : leurs exclusions s'appliquent et les portions s'adaptent.</p>
      {data.members.map(m => <MemberRow key={m.id} m={m} />)}
      <div className="member-add">
        <input className="field" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Prénom (ex. Julie)" aria-label="Prénom du nouveau membre" />
        <button className="btn btn-ghost small-btn" onClick={add} disabled={!name.trim()}><UserPlus size={15} />Ajouter</button>
      </div>
    </div>
  );
}
