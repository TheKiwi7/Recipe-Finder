import { Component, StrictMode, useEffect, useState, type ReactNode } from 'react';
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
import { applyLang, L, lang } from './i18n.ts';

function App() {
  const route = useRoute();
  const pantry = usePantry();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [offline, setOffline] = useState(false);

  // Au lancement, le serveur peut mettre quelques secondes à répondre : on réessaie pendant ~1 min.
  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Langue : un serveur d'une version plus ancienne ne la connaît pas, ce n'est pas bloquant.
    const boot = () => Promise.all([refreshPantry(), api.questionnaire(), api.settings().catch(() => ({ lang }))])
      // Langue changée ailleurs (ou première visite) : la page se recharge dans la bonne langue.
      .then(([, r, s]) => { if (applyLang(s.lang)) return; setOffline(false); setOnboarded(!!r.questionnaire); })
      .catch(() => { if (++tries < 30) timer = setTimeout(boot, 2000); else setOffline(true); });
    void boot();
    return () => clearTimeout(timer);
  }, []);

  // Accueil : directement aux recettes si le stock a été confirmé il y a moins de 12 h.
  useEffect(() => {
    if (pantry && onboarded && route.page === 'home') navigate(pantry.gateOpen ? '/recettes' : '/ingredients', true);
  }, [pantry, onboarded, route.page]);

  if (offline) return <div className="lock-screen"><h1 className="h1" style={{ fontSize: 22 }}>{L('Le serveur de Recipe Finder ne répond pas', 'The Recipe Finder server is not responding')}</h1><p className="sub">{L('Relance l’app depuis le raccourci du bureau.', 'Relaunch the app from the desktop shortcut.')}</p></div>;
  // Démarrage (le serveur peut mettre quelques secondes à répondre) : un message plutôt qu'un écran vide.
  if (!pantry || onboarded === null) return <div className="lock-screen"><p className="sub">{L('Démarrage de Recipe Finder…', 'Starting Recipe Finder…')}</p></div>;
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

// Signe de vie de cette page (onglet / fenêtre) : le serveur s'arrête, et arrête l'IA, quand plus aucune page de
// l'app n'est ouverte. Fermer un onglet ne coupe pas l'app dans un autre.
const PAGE_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
const ping = () => { fetch(`/api/ping?page=${PAGE_ID}`).catch(() => {}); };
ping();
setInterval(ping, 20_000);
window.addEventListener('pagehide', () => navigator.sendBeacon(`/api/bye?page=${PAGE_ID}`));
// Retour sur une page restée en mémoire (bouton Précédent du navigateur) : elle se signale de nouveau.
window.addEventListener('pageshow', e => { if (e.persisted) ping(); });

/** Erreur d'affichage : un message et un bouton plutôt qu'un écran vide. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="lock-screen">
        <h1 className="h1" style={{ fontSize: 22 }}>{L('Oups, l’affichage a planté', 'Oops, the display crashed')}</h1>
        <p className="sub">{L('Si ça persiste, ferme l’app puis relance-la (le serveur se met alors à jour).', 'If it keeps happening, close the app and relaunch it (this updates the server).')}<br /><small className="muted">{this.state.error.message}</small></p>
        <button className="btn btn-primary" onClick={() => location.reload()}>{L('Recharger', 'Reload')}</button>
      </div>
    );
  }
}

// Fenêtre d'app (Chrome, Edge, Brave… ouverts par le raccourci, sans barre d'adresse) : le navigateur la rouvre à
// une taille par défaut, sans tenir compte de l'écran. À l'ouverture, elle prend toute la zone utile de l'écran ;
// une fois par fenêtre seulement (un rechargement ne défait pas une taille choisie à la main).
try {
  const appWindow = !window.toolbar.visible;
  if (appWindow && !sessionStorage.getItem('rf-sized')) {
    sessionStorage.setItem('rf-sized', '1');
    const s = screen as Screen & { availLeft?: number; availTop?: number };
    if (window.outerWidth < s.availWidth * 0.9 || window.outerHeight < s.availHeight * 0.9) {
      window.moveTo(s.availLeft ?? 0, s.availTop ?? 0);
      window.resizeTo(s.availWidth, s.availHeight);
    }
  }
} catch { /* navigateur qui refuse : la fenêtre garde sa taille */ }

createRoot(document.getElementById('root')!).render(<StrictMode><Crash><App /></Crash></StrictMode>);
