import { useEffect, useState } from 'react';
import { BookOpen, CircleDashed, Compass, Heart, Lock, Moon, RefreshCw, Settings, ShoppingBasket, ShoppingCart, Soup, Sun } from 'lucide-react';
import { api, type UpdateState } from '../api.ts';
import { refreshImportStatus, useImportStatus } from '../import-store.ts';
import { navigate, type Route } from '../router.ts';
import { usePantry } from '../pantry-store.ts';
import { invalidateLists } from '../recipes-store.ts';
import { L, num } from '../i18n.ts';
import { refreshShopping, useShopping } from '../shopping-store.ts';

function useTheme() {
  const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme as 'light' | 'dark') ?? (systemDark() ? 'dark' : 'light'));
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* stockage indisponible : thème non mémorisé */ }
    setTheme(next);
  };
  return { theme, toggle };
}

// Version de l'interface au chargement de la page : si le serveur en annonce une autre, on propose de recharger.
const LOADED_BUILD: { value: string | null } = { value: null };
// Démarrage du serveur vu en dernier : s'il change, les règles ont pu changer → listes recalculées sans bruit.
const SEEN_SERVER: { value: string | null } = { value: null };

/** Relit l'état de l'import toutes les 15 s (partagé avec la carte Catalogue des Réglages) et l'état des mises à jour. */
function useServerPolling() {
  const status = useImportStatus();
  const [update, setUpdate] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => refreshImportStatus().then(s => {
      api.update().then(u => { if (alive) setUpdate(u); }).catch(() => {});
      LOADED_BUILD.value ??= s.build;
      if (SEEN_SERVER.value && SEEN_SERVER.value !== s.server) invalidateLists();
      SEEN_SERVER.value = s.server;
    }).catch(() => {});
    tick();
    const t = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return { status, update };
}

export function Sidebar({ route }: { route: Route }) {
  const pantry = usePantry();
  const { theme, toggle } = useTheme();
  const { status, update } = useServerPolling();
  const locked = !pantry?.gateOpen;
  const shopping = useShopping();
  useEffect(() => { refreshShopping().catch(() => {}); }, []);

  const item = (page: string, Icon: typeof Heart, label: string, opts: { gated?: boolean; count?: number } = {}) => (
    <button className={`nav ${route.page === page || (page === 'recettes' && route.page === 'recette') ? 'on' : ''}`} onClick={() => navigate(`/${page}`)}>
      <Icon size={19} strokeWidth={2} />
      <span className="txt">{label}</span>
      {opts.gated && locked && <Lock size={14} className="lock" />}
      {!!opts.count && <span className="badge">{opts.count}</span>}
    </button>
  );

  const outdated = !!status && !!LOADED_BUILD.value && status.build !== LOADED_BUILD.value;

  return (
    <>
      {outdated && (
        <div className="update-banner" role="status">
          {L('L’app a été mise à jour.', 'The app has been updated.')}
          <button className="btn btn-primary small-btn" onClick={() => location.reload()}><RefreshCw size={14} />{L('Recharger', 'Reload')}</button>
        </div>
      )}
      <nav className="side">
        <div className="brand"><span className="brand-mark"><Soup size={17} /></span>Recipe Finder</div>
        {item('ingredients', ShoppingBasket, L('Ingrédients', 'Ingredients'))}
        {item('recettes', BookOpen, L('Recettes', 'Recipes'), { gated: true })}
        {item('presque', CircleDashed, L('Presque', 'Almost'), { gated: true })}
        {item('decouvrir', Compass, L('Découvrir', 'Discover'))}
        {item('favoris', Heart, L('Favoris', 'Favourites'))}
        {item('courses', ShoppingCart, L('Courses', 'Shopping'), { count: shopping?.length })}
        <div className="spacer" />
        {status && status.imported < status.target && (
          <div className="side-foot" title={L(`${status.rejected} recettes écartées (note insuffisante)`, `${status.rejected} recipes skipped (rating too low)`)}>
            {L('Catalogue : ', 'Catalogue: ')}{num(status.imported)} / {num(status.target)} {L('recettes', 'recipes')}
            <div className="progress"><i style={{ width: `${Math.min(100, (100 * status.imported) / status.target)}%` }} /></div>
          </div>
        )}
        {status && status.imported >= status.target && status.pending > 0 && (
          <div className="side-foot">
            {L('Catalogue complet : ', 'Catalogue complete: ')}{num(status.imported)} {L('recettes', 'recipes')} ·{' '}
            <a href="/reglages" onClick={e => { e.preventDefault(); navigate('/reglages'); }}>{L('en ajouter', 'add more')}</a>
          </div>
        )}
        {!!update?.behind && (
          <div className="side-foot">
            <a href="/reglages" onClick={e => { e.preventDefault(); navigate('/reglages'); }}>{L('Nouvelle version disponible', 'New version available')}</a>
          </div>
        )}
        <button className="nav" onClick={toggle}>
          {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
          <span className="txt">{theme === 'dark' ? L('Thème clair', 'Light theme') : L('Thème sombre', 'Dark theme')}</span>
        </button>
        {item('reglages', Settings, L('Réglages', 'Settings'))}
      </nav>
    </>
  );
}
