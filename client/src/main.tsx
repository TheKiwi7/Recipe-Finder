import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './recipes.css';
import { Sidebar } from './components/Sidebar.tsx';
import { IngredientsPage } from './pages/Ingredients.tsx';
import { ComingSoon, LockedPage } from './pages/Placeholders.tsx';
import { FavoritesPage } from './pages/Favorites.tsx';
import { RecipeDetailPage } from './pages/RecipeDetail.tsx';
import { RecipesPage } from './pages/Recipes.tsx';
import { refreshPantry, usePantry } from './pantry-store.ts';
import { navigate, useRoute } from './router.ts';
import { Toast } from './toast.tsx';

function App() {
  const route = useRoute();
  const pantry = usePantry();

  useEffect(() => { refreshPantry().catch(() => {}); }, []);

  // Accueil : directement aux recettes si le stock a été confirmé il y a moins de 12 h.
  useEffect(() => {
    if (pantry && route.page === 'home') navigate(pantry.gateOpen ? '/recettes' : '/ingredients', true);
  }, [pantry, route.page]);

  if (!pantry) return null;
  const gated = (el: React.ReactNode) => (pantry.gateOpen ? el : <LockedPage />);

  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="content">
        {route.page === 'ingredients' && <IngredientsPage />}
        {route.page === 'recettes' && gated(<RecipesPage mode="ready" />)}
        {route.page === 'presque' && gated(<RecipesPage mode="almost" />)}
        {route.page === 'favoris' && <FavoritesPage />}
        {route.page === 'recette' && <RecipeDetailPage key={route.id} id={route.id} />}
        {route.page === 'reglages' && <ComingSoon title="Réglages" />}
      </main>
      <Toast />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
