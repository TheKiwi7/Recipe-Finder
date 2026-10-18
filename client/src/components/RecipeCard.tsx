import { useState } from 'react';
import { Clock, CookingPot, Flame, Heart, ImageOff, Star, X } from 'lucide-react';
import { api, type Reaction, type RecipeCard as Card } from '../api.ts';
import { dishesLabel, fmtTime } from '../format.ts';
import { patchReaction } from '../recipes-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';
import { dec, L, tName, tTerm, typeLabel, useTranslations } from '../i18n.ts';

export async function react(card: { id: number; reaction: Reaction }, kind: 'like' | 'dislike', onChange?: (r: Reaction) => void) {
  const next: Reaction = card.reaction === kind ? null : kind;
  try {
    await api.react(card.id, next);
    patchReaction(card.id, next);
    onChange?.(next);
    toast(next === 'like' ? L('Ajoutée aux favoris', 'Added to favourites') : next === 'dislike' ? L('On ne te la proposera plus', 'You won’t see it again') : kind === 'like' ? L('Retirée des favoris', 'Removed from favourites') : L('Rejet annulé', 'Rejection undone'));
  } catch (e) { toast((e as Error).message); }
}

export function ReactButtons({ card, onChange, large }: { card: { id: number; reaction: Reaction }; onChange?: (r: Reaction) => void; large?: boolean }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className={`react ${large ? 'large' : ''}`} onClick={stop}>
      <button className={`rbtn ${card.reaction === 'like' ? 'liked' : ''}`} onClick={() => react(card, 'like', onChange)}
        title={card.reaction === 'like' ? L('Retirer des favoris', 'Remove from favourites') : L('J’aime', 'I like it')} aria-pressed={card.reaction === 'like'} aria-label={L('J’aime', 'I like it')}>
        <Heart size={large ? 19 : 17} fill={card.reaction === 'like' ? 'currentColor' : 'none'} />
      </button>
      <button className={`rbtn ${card.reaction === 'dislike' ? 'disliked' : ''}`} onClick={() => react(card, 'dislike', onChange)}
        title={card.reaction === 'dislike' ? L('Annuler le rejet', 'Undo rejection') : L('Pas pour moi', 'Not for me')} aria-pressed={card.reaction === 'dislike'} aria-label={L('Pas pour moi', 'Not for me')}>
        <X size={large ? 19 : 17} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function RecipeImage({ src, className }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={`img img-missing ${className ?? ''}`}><ImageOff size={26} /><span>{L('Pas de photo', 'No photo')}</span></div>;
  return <img className={`img ${className ?? ''}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function RecipeCard({ card, showMissing, showType, onReaction }: { card: Card; showMissing?: boolean; showType?: boolean; onReaction?: (r: Reaction) => void }) {
  useTranslations();
  const open = () => navigate(`/recette/${card.id}`);
  return (
    <article className={`rcard ${card.reaction === 'dislike' ? 'gone' : ''}`} onClick={open} onKeyDown={e => e.key === 'Enter' && open()} tabIndex={0}>
      <div className="rcard-media">
        <RecipeImage src={card.image} />
        {card.usesUrgent && <span className="tag-urgent"><Flame size={12} />{L('À finir vite', 'Use soon')}</span>}
        <ReactButtons card={card} onChange={onReaction} />
      </div>
      <div className="rcard-body">
        <h3 className="rcard-name">{tName(card.id, card.name)}</h3>
        {showMissing && card.missing.length > 0 && (
          <p className="rcard-missing">{L('Manque : ', 'Missing: ')}{card.missing.map(tTerm).join(', ')}</p>
        )}
        <div className="meta">
          <span title={L('Temps total', 'Total time')}><Clock size={14} />{fmtTime(card.totalMin)}</span>
          <span title={dishesLabel(card.dishes)}><CookingPot size={14} />{card.dishes}</span>
          {card.rating !== null && <span title={L(`${card.reviews} avis`, `${card.reviews} reviews`)}><Star size={14} />{dec(card.rating)}</span>}
          {showType && card.type !== 'Autre' && <span className="meta-type">{typeLabel(card.type)}</span>}
        </div>
      </div>
    </article>
  );
}
