import { useEffect, useState } from 'react';
import { Trash2, UserPlus, X } from 'lucide-react';
import { api, type Member } from '../api.ts';
import { refreshMembers, useMembers } from '../members-store.ts';
import { invalidateLists } from '../recipes-store.ts';
import { toast } from '../toast.tsx';
import { Autocomplete } from './Autocomplete.tsx';
import { DIET_LABELS, L, memberName, tTerm, useTranslations } from '../i18n.ts';

const DIETS = (['omnivore', 'pescetarian', 'vegetarian', 'vegan'] as const).map(d => [d, d === 'omnivore' ? L('Mange de tout', 'Eats everything') : L(...DIET_LABELS[d])] as [Member['diet'], string]);

async function save(id: number, patch: Partial<Omit<Member, 'id' | 'isSelf'>>) {
  try { await api.updateMember(id, patch); await refreshMembers(); invalidateLists(); }
  catch (e) { toast((e as Error).message); }
}

function ChipList({ label, hint, values, placeholder, onChange }: { label: string; hint: string; values: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  useTranslations();
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
        {values.map(v => <span className="chip" key={v}>{tTerm(v)}<button onClick={() => onChange(values.filter(x => x !== v))} aria-label={L(`Retirer ${v}`, `Remove ${tTerm(v)}`)}><X size={13} /></button></span>)}
        <div className="qchip-input"><Autocomplete submitOnPick value={input} onChange={setInput} onSubmit={add} placeholder={placeholder} /></div>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: Member }) {
  const [name, setName] = useState(memberName(m));
  const [notes, setNotes] = useState(m.notes);
  useEffect(() => { setName(memberName(m)); setNotes(m.notes); }, [m.name, m.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="member">
      <div className="member-head">
        <input className="field member-name" value={name} onChange={e => setName(e.target.value)} onBlur={() => name.trim() && name !== memberName(m) && save(m.id, { name })}
          onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label={L('Prénom', 'First name')} />
        {m.isSelf && <span className="ai-pill ok">{L('Moi', 'Me')}</span>}
        {!m.isSelf && (
          <button className="icon-btn danger" title={L(`Retirer ${m.name}`, `Remove ${m.name}`)} aria-label={L(`Retirer ${m.name}`, `Remove ${m.name}`)}
            onClick={async () => {
              try { await api.deleteMember(m.id); await refreshMembers(); invalidateLists(); toast(L(`${m.name} retiré·e`, `${m.name} removed`)); }
              catch (e) { toast((e as Error).message); }
            }}><Trash2 size={17} /></button>
        )}
      </div>
      {m.isSelf ? (
        <p className="muted small member-self">{L('Tes goûts, allergies et rejets sont dans « Mes préférences », « Mes rejets » et ton profil.', 'Your tastes, allergies and rejections are in “My preferences”, “My rejections” and your profile.')}</p>
      ) : (
        <div className="member-body">
          <div className="member-field">
            <span className="member-label">{L('Régime', 'Diet')}</span>
            <div className="seg">{DIETS.map(([v, l]) => <button key={v} className={m.diet === v ? 'on' : ''} onClick={() => save(m.id, { diet: v })}>{l}</button>)}</div>
          </div>
          <ChipList label={L('Allergies', 'Allergies')} hint={L('exclues strictement, par famille (« gluten », « lactose », « fruits à coque »…)', 'strictly excluded, by family (“gluten”, “lactose”, “nuts”…)')} values={m.allergies} placeholder={L('+ allergie', '+ allergy')} onChange={allergies => save(m.id, { allergies })} />
          <ChipList label={L('N’aime pas', 'Dislikes')} hint={L('aucune recette qui en contient (« poisson » écarte tous les poissons)', 'no recipe containing it (“fish” rules out every fish)')} values={m.aversions} placeholder={L('+ ingrédient', '+ ingredient')} onChange={aversions => save(m.id, { aversions })} />
          <div className="member-field">
            <span className="member-label">{L('Notes', 'Notes')}<small>{L('pour l’IA (goûts, âge…)', 'for the AI (tastes, age…)')}</small></span>
            <textarea className="field area" rows={2} value={notes} onChange={e => setNotes(e.target.value)} onBlur={() => notes !== m.notes && save(m.id, { notes })} placeholder={L('Ex. : 6 ans, adore les pâtes, pas fan des plats épicés', 'E.g. 6 years old, loves pasta, not keen on spicy food')} />
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
  useEffect(() => { refreshMembers().catch(() => {}); }, []);
  if (!data) return null;

  const add = async () => {
    if (!name.trim()) return;
    try { const m = await api.addMember(name); setName(''); await refreshMembers(); invalidateLists(); toast(L(`${m.name} ajouté·e`, `${m.name} added`)); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="members">
      <p className="small">{L('Ajoute les personnes pour qui tu cuisines. Dans Recettes et Presque, tu choisis ensuite qui mange : leurs exclusions s’appliquent et les portions s’adaptent.', 'Add the people you cook for. In Recipes and Almost you then pick who is eating: their exclusions apply and portions adjust.')}</p>
      {data.members.map(m => <MemberRow key={m.id} m={m} />)}
      <div className="member-add">
        <input className="field" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder={L('Prénom (ex. Julie)', 'First name (e.g. Julie)')} aria-label={L('Prénom du nouveau membre', 'New member’s first name')} />
        <button className="btn btn-ghost small-btn" onClick={add} disabled={!name.trim()}><UserPlus size={15} />{L('Ajouter', 'Add')}</button>
      </div>
    </div>
  );
}
