import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { api, type Questionnaire } from '../api.ts';
import { Autocomplete } from './Autocomplete.tsx';
import { LoadState, useLoad } from '../use-load.tsx';
import { toast } from '../toast.tsx';

const TIMES = [20, 30, 45, 60, 90];
const DISHES: Array<[Questionnaire['dishTolerance'], string, string]> = [
  ['low', 'Le minimum', 'Une casserole, une poêle, pas plus'],
  ['medium', 'Raisonnable', "Deux ou trois pièces, ça va"],
  ['high', 'Peu importe', 'La vaisselle ne me fait pas peur'],
];
const DIETS: Array<[Questionnaire['diet'], string]> = [['omnivore', 'Je mange de tout'], ['pescetarian', 'Pas de viande'], ['vegetarian', 'Végétarien'], ['vegan', 'Végan']];

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => <button type="button" key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

/** Questionnaire de départ (Q8), aussi utilisé dans les Réglages. */
export function QuestionnaireForm({ submitLabel, onSaved }: { submitLabel: string; onSaved: (q: Questionnaire) => void }) {
  const [q, setQ] = useState<Questionnaire | null>(null);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [allergy, setAllergy] = useState('');
  const [saving, setSaving] = useState(false);

  const { failed, reload } = useLoad(async () => {
    const r = await api.questionnaire();
    setQ(r.questionnaire ?? r.defaults);
    setEquipment(r.equipment);
    return r;
  });
  if (!q) return <LoadState failed={failed} onRetry={reload} />;
  const up = (patch: Partial<Questionnaire>) => setQ({ ...q, ...patch });
  const addAllergy = (v = allergy) => {
    const a = v.trim().toLowerCase();
    if (a && !q.allergies.includes(a)) up({ allergies: [...q.allergies, a] });
    setAllergy('');
  };

  const save = async () => {
    setSaving(true);
    try { onSaved((await api.saveQuestionnaire(q)).questionnaire); }
    catch (e) { toast((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="qform">
      <section className="qrow">
        <div className="qlabel"><b>Pour combien de personnes cuisines-tu ?</b><span>Les quantités des recettes seront recalculées.</span></div>
        <span className="portions big">
          <button type="button" onClick={() => up({ persons: Math.max(1, q.persons - 1) })} aria-label="Moins"><Minus size={16} /></button>
          <b>{q.persons}</b>
          <button type="button" onClick={() => up({ persons: q.persons + 1 })} aria-label="Plus"><Plus size={16} /></button>
        </span>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>Combien de temps max, en général ?</b><span>Une préférence, pas une limite stricte.</span></div>
        <Segmented value={q.maxTime} options={TIMES.map(t => [t, t >= 60 ? `${t / 60 === 1.5 ? '1 h 30' : `${t / 60} h`}` : `${t} min`] as [number, string])} onChange={v => up({ maxTime: v })} />
      </section>

      <section className="qrow">
        <div className="qlabel"><b>La vaisselle ?</b></div>
        <div className="cards3">
          {DISHES.map(([v, t, d]) => (
            <button type="button" key={v} className={`optcard ${q.dishTolerance === v ? 'on' : ''}`} onClick={() => up({ dishTolerance: v })}><b>{t}</b><span>{d}</span></button>
          ))}
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>Régime</b></div>
        <Segmented value={q.diet} options={DIETS} onChange={v => up({ diet: v })} />
      </section>

      <section className="qrow">
        <div className="qlabel"><b>Allergies ou ingrédients à éviter absolument</b><span>Aucune recette ne les contiendra.</span></div>
        <div className="qchips">
          {q.allergies.map(a => <span className="chip" key={a}>{a}<button type="button" onClick={() => up({ allergies: q.allergies.filter(x => x !== a) })} aria-label={`Retirer ${a}`}><X size={13} /></button></span>)}
          <div className="qchip-input"><Autocomplete value={allergy} onChange={setAllergy} onSubmit={addAllergy} placeholder="+ ajouter (ex. arachide)" /></div>
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>Tes appareils</b><span>Les recettes qui demandent un appareil que tu n'as pas sont écartées.</span></div>
        <div className="qchips">
          {equipment.map(e => {
            const on = q.equipment.includes(e);
            return <button type="button" key={e} className={`fchip ${on ? 'on' : ''}`} onClick={() => up({ equipment: on ? q.equipment.filter(x => x !== e) : [...q.equipment, e] })}>{e}</button>;
          })}
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>Autre chose à savoir ?</b><span>Tes goûts, ce que tu adores ou détestes, ton niveau… L'IA s'en servira.</span></div>
        <textarea className="field area" rows={6} value={q.notes} onChange={e => up({ notes: e.target.value })} placeholder="Ex. : j'adore la cuisine asiatique et les plats mijotés, pas fan des desserts trop sucrés…" />
      </section>

      <div className="qsave"><button className="btn btn-primary" onClick={save} disabled={saving}>{submitLabel}</button></div>
    </div>
  );
}
