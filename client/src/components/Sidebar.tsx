import { useEffect, useState } from 'react';
import { BookOpen, CircleDashed, Heart, Lock, Moon, Settings, ShoppingBasket, Soup, Sun } from 'lucide-react';
import { api, type ImportStatus } from '../api.ts';
import { navigate, type Route } from '../router.ts';
import { usePantry } from '../pantry-store.ts';

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

function useImportStatus() {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = () => api.importStatus().then(s => alive && setStatus(s)).catch(() => {});
    tick();
    const t = setInterval(tick, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return status;
}

export function Sidebar({ route }: { route: Route }) {
  const pantry = usePantry();
  const { theme, toggle } = useTheme();
  const status = useImportStatus();
  const locked = !pantry?.gateOpen;

  const item = (page: string, Icon: typeof Heart, label: string, opts: { gated?: boolean } = {}) => (
    <button className={`nav ${route.page === page || (page === 'recettes' && route.page === 'recette') ? 'on' : ''}`} onClick={() => navigate(`/${page}`)}>
      <Icon size={19} strokeWidth={2} />
      <span className="txt">{label}</span>
      {opts.gated && locked && <Lock size={14} className="lock" />}
    </button>
  );

  return (
    <nav className="side">
      <div className="brand"><span className="brand-mark"><Soup size={17} /></span>Recipe Finder</div>
      {item('ingredients', ShoppingBasket, 'Ingrédients')}
      {item('recettes', BookOpen, 'Recettes', { gated: true })}
      {item('presque', CircleDashed, 'Presque', { gated: true })}
      {item('favoris', Heart, 'Favoris')}
      <div className="spacer" />
      {status && status.imported < status.target && (
        <div className="side-foot" title={`${status.rejected} recettes écartées (note insuffisante)`}>
          Catalogue : {status.imported.toLocaleString('fr-FR')} / {status.target.toLocaleString('fr-FR')} recettes
          <div className="progress"><i style={{ width: `${Math.min(100, (100 * status.imported) / status.target)}%` }} /></div>
        </div>
      )}
      <button className="nav" onClick={toggle}>
        {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
        <span className="txt">{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</span>
      </button>
      {item('reglages', Settings, 'Réglages')}
    </nav>
  );
}
