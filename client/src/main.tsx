import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './recipes.css';
import './panels.css';
import { api } from './api.ts';
import { ChatPanel } from './components/ChatPanel.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { FavoritesPage } from './pages/Favorites.tsx';
import { IngredientsPage } from './pages/Ingredients.tsx';
import { LockedPage } from './pages/Placeholders.tsx';
import { RecipeDetailPage } from './pages/RecipeDetail.tsx';
import { RecipesPage } from './pages/Recipes.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { WelcomePage } from './pages/Welcome.tsx';
import { refreshPantry, usePantry } from './pantry-store.ts';
import { navigate, useRoute } from './router.ts';
import { Toast } from './toast.tsx';

function App() {
  const route = useRoute();
  const pantry = usePantry();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);

  // Au lancement, le serveur peut mettre quelques secondes à répondre : on réessaie pendant ~1 min.
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const boot = () => Promise.all([refreshPantry(), api.questionnaire()])
      .then(([, r]) => { setOffline(false); setOnboarded(!!r.questionnaire); })
      .catch(() => { if (++tries < 30) timer = setTimeout(boot, 2000); else setOffline(true); });
    void boot();
    return () => clearTimeout(timer);
  }, []);

  // Accueil : directement aux recettes si le stock a été confirmé il y a moins de 12 h.
  useEffect(() => {
    if (pantry && onboarded && route.page === 'home') navigate(pantry.gateOpen ? '/recettes' : '/ingredients', true);
  }, [pantry, onboarded, route.page]);

  if (offline) return <div className="lock-screen"><h1 className="h1" style={{ fontSize: 22 }}>Le serveur de Recipe Finder ne répond pas</h1><p className="sub">Relance l'app depuis le raccourci du bureau.</p></div>;
  if (!pantry || onboarded === null) return null;
  if (!onboarded) return <WelcomePage onDone={() => { setOnboarded(true); navigate('/ingredients', true); }} />;
  const gated = (el: React.ReactNode) => (pantry.gateOpen ? el : <LockedPage />);

  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="content">
        {route.page === 'ingredients' && <IngredientsPage />}
        {route.page === 'recettes' && gated(<RecipesPage mode="ready" />)}
        {route.page === 'presque' && gated(<RecipesPage mode="almost" />)}
        {route.page === 'favoris' && <FavoritesPage />}
        {route.page === 'reglages' && <SettingsPage />}
        {route.page === 'recette' && <RecipeDetailPage key={route.id} id={route.id} onChat={r => <ChatPanel recipe={r} />} />}
      </main>
      <Toast />
    </div>
  );
}

// Fermeture de la fenêtre : le serveur s'arrête (et arrête l'IA) s'il ne revoit pas la page dans les 20 s.
window.addEventListener('pagehide', () => navigator.sendBeacon('/api/bye'));
// Signe de vie, sur toutes les pages (y compris l'accueil, sans barre latérale).
setInterval(() => { fetch('/api/ping').catch(() => {}); }, 30_000);

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
