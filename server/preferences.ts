import { getMeta, setMeta, type Db } from './db.ts';

/** Réponses au questionnaire de départ (Q8). */
export type Questionnaire = {
  persons: number;
  maxTime: number;                          // minutes, préférence (pas un filtre strict)
  dishTolerance: 'low' | 'medium' | 'high'; // tolérance à la vaisselle
  diet: 'omnivore' | 'vegetarian' | 'vegan' | 'pescetarian';
  allergies: string[];                      // ingrédients de base, exclus strictement
  equipment: string[];                      // appareils possédés, parmi OPTIONAL_EQUIPMENT
  notes: string;                            // texte libre pour Claude
};

/** Appareils qu'on peut ne pas avoir : une recette qui en demande un absent est exclue. */
export const OPTIONAL_EQUIPMENT = ['Four', 'Micro-ondes', 'Robot / mixeur', 'Batteur électrique', 'Robot cuiseur', 'Airfryer', 'Autocuiseur', 'Friteuse', 'Cuit-vapeur', 'Crêpière', 'Gaufrier', 'Wok'];

export const DEFAULT_QUESTIONNAIRE: Questionnaire = {
  persons: 2,
  maxTime: 45,
  dishTolerance: 'medium',
  diet: 'omnivore',
  allergies: [],
  equipment: ['Four', 'Micro-ondes', 'Robot / mixeur', 'Batteur électrique'],
  notes: '',
};

/** Réglages structurés produits par Claude à partir du profil, consommés par le classement local (Q18). */
export type ProfileWeights = {
  ingredients?: Record<string, number>; // base → poids entre -1 et 1
  keywords?: Record<string, number>;    // mot du nom ou des mots-clés (« curry », « gratin »)
  types?: Record<string, number>;       // Plat, Dessert…
  maxTotalMin?: number;
  maxDishes?: number;
};

export function getQuestionnaire(db: Db): Questionnaire | null {
  const raw = getMeta(db, 'questionnaire');
  return raw ? { ...DEFAULT_QUESTIONNAIRE, ...JSON.parse(raw) } : null;
}

export function setQuestionnaire(db: Db, q: Questionnaire): void {
  setMeta(db, 'questionnaire', JSON.stringify(q));
}

export function getWeights(db: Db): ProfileWeights {
  const raw = getMeta(db, 'profile_weights');
  return raw ? JSON.parse(raw) : {};
}

export function recordSignal(db: Db, kind: string, detail: string): void {
  db.prepare('INSERT INTO signals (kind, detail, at) VALUES (?, ?, ?)').run(kind, detail, new Date().toISOString());
}

// Ingrédients exclus selon le régime. Comparés aux bases normalisées du catalogue.
const MEAT = ['poulet', 'dinde', 'canard', 'boeuf', 'boeuf haché', 'veau', 'porc', 'agneau', 'lardons', 'jambon', 'jambon cru', 'chorizo', 'saucisse', 'bacon', 'lapin', 'pintade', 'caille', 'magret', 'foie gras', 'gibier', 'chair à saucisse', 'rillettes', 'boudin', 'andouille', 'gélatine'];
const FISH = ['saumon', 'saumon fumé', 'thon', 'cabillaud', 'dorade', 'crevette', 'moule', 'sardine', 'surimi', 'saint-jacques', 'anchois', 'truite', 'maquereau', 'calamar', 'poulpe', 'crabe', 'homard', 'langoustine', 'bar', 'sole', 'merlan', 'oeufs de saumon', 'poisson', 'fruits de mer'];
const ANIMAL = ['oeuf', 'lait', 'crème fraîche', 'beurre', 'yaourt', 'fromage blanc', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyère', 'chèvre', 'roquefort', 'feta', 'reblochon', 'camembert', 'raclette', 'cheddar', 'miel', 'fromage', 'lait concentré'];

export function dietExclusions(diet: Questionnaire['diet']): Set<string> {
  if (diet === 'vegetarian') return new Set([...MEAT, ...FISH]);
  if (diet === 'pescetarian') return new Set(MEAT);
  if (diet === 'vegan') return new Set([...MEAT, ...FISH, ...ANIMAL]);
  return new Set();
}
