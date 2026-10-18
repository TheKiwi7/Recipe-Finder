import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { L } from './i18n.ts';

/**
 * Charge une donnée au montage, en réessayant quelques fois (le serveur peut être en train de redémarrer).
 * `reload` relance le chargement, par ex. après une modification.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    setFailed(false);
    for (let attempt = 0; attempt < 6; attempt++) {
      try { setData(await fnRef.current()); return; }
      catch { await new Promise(r => setTimeout(r, 1500)); }
    }
    setFailed(true);
  }, []);

  useEffect(() => { void load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, failed, reload: load, setData };
}

/** Affichage commun pendant le chargement ou après un échec. */
export function LoadState({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return <div className="load-state"><span className="load-bar" /><span className="load-bar short" /></div>;
  return (
    <div className="load-state failed">
      <span className="muted">{L('Impossible de charger cette section.', 'Could not load this section.')}</span>
      <button className="btn btn-ghost small-btn" onClick={onRetry}><RefreshCw size={14} />{L('Réessayer', 'Retry')}</button>
    </div>
  );
}
