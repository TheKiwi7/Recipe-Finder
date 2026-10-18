import { useState } from 'react';
import { ArrowRight, Soup } from 'lucide-react';
import type { Questionnaire } from '../api.ts';
import { AiCard } from '../components/AiCard.tsx';
import { QuestionnaireForm } from '../components/QuestionnaireForm.tsx';
import { LangSwitch } from '../components/LangSwitch.tsx';
import { L } from '../i18n.ts';

/** Premier lancement : questionnaire rapide (Q8), puis connexion de l'IA (facultative). */
export function WelcomePage({ onDone }: { onDone: (q: Questionnaire) => void }) {
  const [saved, setSaved] = useState<Questionnaire | null>(null);

  if (saved) {
    return (
      <div className="welcome">
        <div className="welcome-head">
          <span className="brand-mark big"><Soup size={26} /></span>
          <h1 className="h1">{L('Connecter une IA', 'Connect an AI')}</h1>
          <p className="sub">{L('Facultatif : l’app fonctionne sans. Avec une IA, tu as un chat sur chaque recette et un profil qui apprend tes goûts. Un clic suffit, l’app installe ce qu’il faut.', 'Optional: the app works without one. With an AI you get a chat on every recipe and a profile that learns your tastes. One click is enough, the app installs what it needs.')}</p>
        </div>
        <div className="card settings-card"><AiCard /></div>
        <div className="welcome-next">
          <button className="btn btn-primary" onClick={() => onDone(saved)}>{L('Continuer', 'Continue')}<ArrowRight size={17} /></button>
          <span className="muted small">{L('Tu pourras le faire plus tard dans les Réglages.', 'You can do it later in Settings.')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-head">
        <span className="brand-mark big"><Soup size={26} /></span>
        <h1 className="h1">{L('Bienvenue dans Recipe Finder', 'Welcome to Recipe Finder')}</h1>
        <p className="sub">{L('Une minute pour faire connaissance : on s’en sert pour te proposer des recettes qui te ressemblent dès le départ. Tout reste modifiable dans les Réglages.', 'A minute to get to know you, so the recipes suit you from the start. Everything can be changed later in Settings.')}</p>
        <LangSwitch />
      </div>
      <div className="card settings-card"><QuestionnaireForm submitLabel={L('Continuer', 'Continue')} onSaved={setSaved} /></div>
    </div>
  );
}
