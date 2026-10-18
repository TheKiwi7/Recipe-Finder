import { Soup } from 'lucide-react';
import type { Questionnaire } from '../api.ts';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';

/** Premier lancement : questionnaire rapide avant tout le reste (Q8). */
export function WelcomePage({ onDone }: { onDone: (q: Questionnaire) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-head">
        <span className="brand-mark big"><Soup size={26} /></span>
        <h1 className="h1">Bienvenue dans Recipe Finder</h1>
        <p className="sub">Une minute pour faire connaissance : on s'en sert pour te proposer des recettes qui te ressemblent dès le départ. Tout reste modifiable dans les Réglages.</p>
      </div>
      <div className="card settings-card"><QuestionnaireForm submitLabel="C'est parti" onSaved={onDone} /></div>
    </div>
  );
}
