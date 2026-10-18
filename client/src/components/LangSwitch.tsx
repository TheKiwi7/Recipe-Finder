import { useState } from 'react';
import { api } from '../api.ts';
import { applyLang, lang, type Lang } from '../i18n.ts';
import { toast } from '../toast.tsx';

const OPTIONS: Array<[Lang, string]> = [['fr', 'Français'], ['en', 'English']];

/** Choix de la langue de l'app ; la page se recharge dans la langue choisie. */
export function LangSwitch() {
  const [busy, setBusy] = useState(false);
  const pick = async (l: Lang) => {
    if (l === lang || busy) return;
    setBusy(true);
    try { await api.setLang(l); applyLang(l); }
    catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <div className="seg" role="group" aria-label="Langue / Language">
      {OPTIONS.map(([v, label]) => <button type="button" key={v} className={lang === v ? 'on' : ''} onClick={() => pick(v)} disabled={busy}>{label}</button>)}
    </div>
  );
}
