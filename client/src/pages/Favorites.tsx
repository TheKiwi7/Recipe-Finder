import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { api, type RecipeCard as Card } from '../api.ts';
import { RecipeCard } from '../components/RecipeCard.tsx';
import { usePantry } from '../pantry-store.ts';

export function FavoritesPage() {
  const [items, setItems] = useState<Card[] | null>(null);
  const version = usePantry()?.version;
  useEffect(() => { api.favorites().then(setItems).catch(() => setItems([])); }, [version]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1 className="h1">Favoris</h1>
          <p className="sub">{items?.length ? `${items.length} recette${items.length > 1 ? 's' : ''} enregistrée${items.length > 1 ? 's' : ''}, gardée${items.length > 1 ? 's' : ''} en local.` : 'Les recettes que tu aimes, gardées même si elles disparaissent du site.'}</p>
        </div>
      </header>
      {items && items.length === 0 ? (
        <div className="card empty"><Heart size={36} /><b>Aucun favori pour l'instant</b>Clique sur le cœur d'une recette pour la retrouver ici.</div>
      ) : (
        <div className="grid">
          {/* Une recette dont on retire le cœur disparaît des favoris au prochain affichage. */}
          {items?.map(c => <RecipeCard key={c.id} card={c} showMissing onReaction={r => setItems(list => list && list.map(i => (i.id === c.id ? { ...i, reaction: r } : i)))} />)}
        </div>
      )}
    </>
  );
}
