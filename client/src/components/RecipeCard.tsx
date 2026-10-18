import { useState } from 'react';
import { Clock, CookingPot, Flame, Heart, ImageOff, Star, X } from 'lucide-react';
import { api, type Reaction, type RecipeCard as Card } from '../api.ts';
import { dishesLabel, fmtTime } from '../format.ts';
import { patchReaction } from '../recipes-store.ts';
import { navigate } from '../router.ts';
import { toast } from '../toast.tsx';

export async function react(card: { id: number; reaction: Reaction }, kind: 'like' | 'dislike', onChange?: (r: Reaction) => void) {
  const next: Reaction = card.reaction === kind ? null : kind;
  try {
    await api.react(card.id, next);
    patchReaction(card.id, next);
    onChange?.(next);
    toast(next === 'like' ? 'Ajoutée aux favoris' : next === 'dislike' ? 'On ne te la proposera plus' : kind === 'like' ? 'Retirée des favoris' : 'Rejet annulé');
  } catch (e) { toast((e as Error).message); }
}

export function ReactButtons({ card, onChange, large }: { card: { id: number; reaction: Reaction }; onChange?: (r: Reaction) => void; large?: boolean }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className={`react ${large ? 'large' : ''}`} onClick={stop}>
      <button className={`rbtn ${card.reaction === 'like' ? 'liked' : ''}`} onClick={() => react(card, 'like', onChange)}
        title={card.reaction === 'like' ? 'Retirer des favoris' : "J'aime"} aria-pressed={card.reaction === 'like'} aria-label="J'aime">
        <Heart size={large ? 19 : 17} fill={card.reaction === 'like' ? 'currentColor' : 'none'} />
      </button>
      <button className={`rbtn ${card.reaction === 'dislike' ? 'disliked' : ''}`} onClick={() => react(card, 'dislike', onChange)}
        title={card.reaction === 'dislike' ? 'Annuler le rejet' : 'Pas pour moi'} aria-pressed={card.reaction === 'dislike'} aria-label="Pas pour moi">
        <X size={large ? 19 : 17} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function RecipeImage({ src, className }: { src: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <div className={`img img-missing ${className ?? ''}`}><ImageOff size={28} /></div>;
  return <img className={`img ${className ?? ''}`} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

export function RecipeCard({ card, showMissing, onReaction }: { card: Card; showMissing?: boolean; onReaction?: (r: Reaction) => void }) {
  const open = () => navigate(`/recette/${card.id}`);
  return (
    <article className={`rcard ${card.reaction === 'dislike' ? 'gone' : ''}`} onClick={open} onKeyDown={e => e.key === 'Enter' && open()} tabIndex={0}>
      <div className="rcard-media">
        <RecipeImage src={card.image} />
        {card.usesUrgent && <span className="tag-urgent"><Flame size={12} />À finir vite</span>}
        <ReactButtons card={card} onChange={onReaction} />
      </div>
      <div className="rcard-body">
        <h3 className="rcard-name">{card.name}</h3>
        {showMissing && card.missing.length > 0 && (
          <p className="rcard-missing">Manque : {card.missing.join(', ')}</p>
        )}
        <div className="meta">
          <span title="Temps total"><Clock size={14} />{fmtTime(card.totalMin)}</span>
          <span title={dishesLabel(card.dishes)}><CookingPot size={14} />{card.dishes}</span>
          {card.rating !== null && <span title={`${card.reviews} avis`}><Star size={14} />{card.rating.toFixed(1).replace('.', ',')}</span>}
        </div>
      </div>
    </article>
  );
}
