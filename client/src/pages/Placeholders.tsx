import { BookOpen, Check } from 'lucide-react';
import { navigate } from '../router.ts';
import { L } from '../i18n.ts';

/** Recettes et Presque restent verrouillés tant que le stock n'a pas été confirmé dans les 12 dernières heures. */
export function LockedPage() {
  return (
    <div className="lock-screen">
      <div className="ico"><BookOpen size={28} /></div>
      <h1 className="h1" style={{ fontSize: 24 }}>{L('Ton stock est-il à jour ?', 'Is your pantry up to date?')}</h1>
      <p className="sub" style={{ margin: '10px 0 24px' }}>{L('Vérifie tes ingrédients avant de chercher des recettes, pour qu’on te propose des plats vraiment faisables.', 'Check your ingredients before looking for recipes, so the suggestions are dishes you can really make.')}</p>
      <button className="btn btn-primary" onClick={() => navigate('/ingredients')}><Check size={17} />{L('Vérifier mes ingrédients', 'Check my ingredients')}</button>
    </div>
  );
}
