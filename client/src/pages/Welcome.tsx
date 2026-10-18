import { useState } from 'react';
import { ArrowRight, Soup } from 'lucide-react';
import type { Questionnaire } from '../api.ts';
import { AiCard } from '../components/AiCard.tsx';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';

/** Premier lancement : questionnaire rapide (Q8), puis connexion de l'IA (facultative). */
export function WelcomePage({ onDone }: { onDone: (q: Questionnaire) => void }) {
  const [saved, setSaved] = useState<Questionnaire | null>(null);

  if (saved) {
    return (
      <div className="welcome">
        <div className="welcome-head">
          <span className="brand-mark big"><Soup size={26} /></span>
          <h1 className="h1">Connecter une IA</h1>
          <p className="sub">Facultatif : l'app fonctionne sans. Avec une IA, tu as un chat sur chaque recette et un profil qui apprend tes goûts. Un clic suffit, l'app installe ce qu'il faut.</p>
        </div>
        <div className="card settings-card"><AiCard /></div>
        <div className="welcome-next">
          <button className="btn btn-primary" onClick={() => onDone(saved)}>Continuer<ArrowRight size={17} /></button>
          <span className="muted small">Tu pourras le faire plus tard dans les Réglages.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-head">
        <span className="brand-mark big"><Soup size={26} /></span>
        <h1 className="h1">Bienvenue dans Recipe Finder</h1>
        <p className="sub">Une minute pour faire connaissance : on s'en sert pour te proposer des recettes qui te ressemblent dès le départ. Tout reste modifiable dans les Réglages.</p>
      </div>
      <div className="card settings-card"><QuestionnaireForm submitLabel="Continuer" onSaved={setSaved} /></div>
    </div>
  );
}
