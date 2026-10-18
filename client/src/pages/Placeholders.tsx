import { BookOpen, Check, Hammer } from 'lucide-react';
import { navigate } from '../router.ts';

/** Recettes et Presque restent verrouillés tant que le stock n'a pas été confirmé dans les 12 dernières heures. */
export function LockedPage() {
  return (
    <div className="lock-screen">
      <div className="ico"><BookOpen size={28} /></div>
      <h1 className="h1" style={{ fontSize: 24 }}>Ton stock est-il à jour ?</h1>
      <p className="sub" style={{ margin: '10px 0 24px' }}>Vérifie tes ingrédients avant de chercher des recettes, pour qu'on te propose des plats vraiment faisables.</p>
      <button className="btn btn-primary" onClick={() => navigate('/ingredients')}><Check size={17} />Vérifier mes ingrédients</button>
    </div>
  );
}

export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <header className="page-head"><h1 className="h1">{title}</h1></header>
      <div className="card empty"><Hammer size={34} /><b>Bientôt</b>Cette partie arrive dans une prochaine étape.</div>
    </>
  );
}
