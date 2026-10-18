import { BookOpen, Check } from 'lucide-react';
import { navigate } from '../router.ts';

/** Recettes et Presque restent verrouillés tant que le stock n'a pas été confirmé dans les 12 dernières heures. */
export function LockedPage() {
  return (
    <div className="lock-screen">
      <div className="ico"><BookOpen size={28} /></div>
      <h1 className="h1" style={{ fontSize: 24 }}>Ton stock est-il à jour ?</h1>
      <p className="sub" style={{ margin: '10px 0 24px' }}>Vérifie tes ingrédients avant de chercher des recettes, pour qu'on te propose des plats vraiment faisables.</p>
      <button className="btn btn-primary" onClick={() => navigate('/ingredients')}><Check size={17} />Vérifier mes ingrédients</button>
    </div>
  );
}
