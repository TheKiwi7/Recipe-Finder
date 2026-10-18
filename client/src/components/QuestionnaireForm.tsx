import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { api, type Questionnaire } from '../api.ts';
import { Autocomplete } from './Autocomplete.tsx';
import { LoadState, useLoad } from '../use-load.tsx';
import { toast } from '../toast.tsx';
import { DIET_LABELS, L, tTerm, useTranslations } from '../i18n.ts';

const TIMES = [20, 30, 45, 60, 90];
const DISHES: Array<[Questionnaire['dishTolerance'], string, string]> = [
  ['low', L('Le minimum', 'The minimum'), L('Une casserole, une poêle, pas plus', 'One pan, one pot, no more')],
  ['medium', L('Raisonnable', 'Reasonable'), L('Deux ou trois pièces, ça va', 'Two or three items is fine')],
  ['high', L('Peu importe', 'Don’t mind'), L('La vaisselle ne me fait pas peur', 'Washing up doesn’t scare me')],
];
const DIETS = (['omnivore', 'pescetarian', 'vegetarian', 'vegan'] as const).map(d => [d, L(...DIET_LABELS[d])] as [Questionnaire['diet'], string]);

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([v, label]) => <button type="button" key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{label}</button>)}
    </div>
  );
}

/** Questionnaire de départ (Q8), aussi utilisé dans les Réglages. */
export function QuestionnaireForm({ submitLabel, onSaved }: { submitLabel: string; onSaved: (q: Questionnaire) => void }) {
  useTranslations();
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
        <div className="qlabel"><b>{L('Pour combien de personnes cuisines-tu ?', 'How many people do you cook for?')}</b><span>{L('Les quantités des recettes seront recalculées.', 'Recipe quantities will be scaled.')}</span></div>
        <span className="portions big">
          <button type="button" onClick={() => up({ persons: Math.max(1, q.persons - 1) })} aria-label={L('Moins', 'Fewer')}><Minus size={16} /></button>
          <b>{q.persons}</b>
          <button type="button" onClick={() => up({ persons: q.persons + 1 })} aria-label={L('Plus', 'More')}><Plus size={16} /></button>
        </span>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('Combien de temps max, en général ?', 'How much time, usually, at most?')}</b><span>{L('Une préférence, pas une limite stricte.', 'A preference, not a strict limit.')}</span></div>
        <Segmented value={q.maxTime} options={TIMES.map(t => [t, t >= 60 ? `${t / 60 === 1.5 ? '1 h 30' : `${t / 60} h`}` : `${t} min`] as [number, string])} onChange={v => up({ maxTime: v })} />
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('La vaisselle ?', 'Washing up?')}</b></div>
        <div className="cards3">
          {DISHES.map(([v, t, d]) => (
            <button type="button" key={v} className={`optcard ${q.dishTolerance === v ? 'on' : ''}`} onClick={() => up({ dishTolerance: v })}><b>{t}</b><span>{d}</span></button>
          ))}
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('Régime', 'Diet')}</b></div>
        <Segmented value={q.diet} options={DIETS} onChange={v => up({ diet: v })} />
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('Allergies ou ingrédients à éviter absolument', 'Allergies or ingredients to avoid at all costs')}</b><span>{L('Aucune recette ne les contiendra.', 'No recipe will contain them.')}</span></div>
        <div className="qchips">
          {q.allergies.map(a => <span className="chip" key={a}>{tTerm(a)}<button type="button" onClick={() => up({ allergies: q.allergies.filter(x => x !== a) })} aria-label={L(`Retirer ${a}`, `Remove ${tTerm(a)}`)}><X size={13} /></button></span>)}
          <div className="qchip-input"><Autocomplete value={allergy} onChange={setAllergy} onSubmit={addAllergy} placeholder={L('+ ajouter (ex. arachide)', '+ add (e.g. peanut)')} /></div>
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('Tes appareils', 'Your appliances')}</b><span>{L('Les recettes qui demandent un appareil que tu n’as pas sont écartées.', 'Recipes needing an appliance you don’t have are left out.')}</span></div>
        <div className="qchips">
          {equipment.map(e => {
            const on = q.equipment.includes(e);
            return <button type="button" key={e} className={`fchip ${on ? 'on' : ''}`} onClick={() => up({ equipment: on ? q.equipment.filter(x => x !== e) : [...q.equipment, e] })}>{tTerm(e)}</button>;
          })}
        </div>
      </section>

      <section className="qrow">
        <div className="qlabel"><b>{L('Autre chose à savoir ?', 'Anything else to know?')}</b><span>{L('Tes goûts, ce que tu adores ou détestes, ton niveau… L’IA s’en servira.', 'Your tastes, what you love or hate, your skill level… The AI will use it.')}</span></div>
        <textarea className="field area" rows={6} value={q.notes} onChange={e => up({ notes: e.target.value })} placeholder={L('Ex. : j’adore la cuisine asiatique et les plats mijotés, pas fan des desserts trop sucrés…', 'E.g. I love Asian food and slow-cooked dishes, not a fan of very sweet desserts…')} />
      </section>

      <div className="qsave"><button className="btn btn-primary" onClick={save} disabled={saving}>{submitLabel}</button></div>
    </div>
  );
}
