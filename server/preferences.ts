import { getMeta, setMeta, type Db } from './db.ts';
import { normalizeKey } from './catalog/text.ts';

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
export const OPTIONAL_EQUIPMENT = ['Four', 'Micro-ondes', 'Robot / mixeur', 'Batteur électrique', 'Robot cuiseur', 'Airfryer', 'Machine à pain', 'Autocuiseur', 'Friteuse', 'Cuit-vapeur', 'Crêpière', 'Gaufrier', 'Wok'];

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

// Familles d'allergènes : une allergie déclarée exclut tous les ingrédients de la famille.
const ALLERGEN_FAMILIES: Record<string, string[]> = {
  arachide: ['arachide', 'cacahuete', 'cacahouete', 'beurre de cacahuete'],
  cacahuete: ['arachide', 'cacahuete', 'cacahouete'],
  'fruit a coque': ['noix', 'noisette', 'amande', 'cajou', 'pistache', 'pecan', 'macadamia', 'pignon', 'praline', 'nougat', 'frangipane', 'massepain'],
  gluten: ['farine', 'pate', 'pates', 'pain', 'semoule', 'chapelure', 'biscuit', 'boulgour', 'ble', 'orge', 'seigle', 'epeautre', 'brioche', 'couscous', 'tortilla', 'croutons', 'boudoir', 'speculoos'],
  lactose: ['lait', 'creme', 'beurre', 'fromage', 'yaourt', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'camembert', 'reblochon', 'raclette', 'cheddar', 'roquefort', 'bechamel'],
  lait: ['lait', 'creme', 'beurre', 'fromage', 'yaourt', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'camembert', 'reblochon', 'raclette', 'cheddar', 'roquefort', 'bechamel'],
  oeuf: ['oeuf', 'mayonnaise', 'meringue'],
  poisson: ['poisson', 'saumon', 'thon', 'cabillaud', 'dorade', 'sardine', 'anchois', 'truite', 'maquereau', 'merlu', 'colin', 'bar', 'sole', 'surimi', 'fumet'],
  crustace: ['crevette', 'gambas', 'crabe', 'homard', 'langoustine', 'ecrevisse', 'surimi'],
  'fruit de mer': ['crevette', 'gambas', 'crabe', 'homard', 'langoustine', 'moule', 'huitre', 'saint jacques', 'calamar', 'poulpe', 'seiche', 'coque', 'palourde'],
  soja: ['soja', 'tofu', 'edamame', 'miso', 'tempeh'],
  sesame: ['sesame', 'tahini', 'tahin'],
  celeri: ['celeri'],
  moutarde: ['moutarde'],
  sulfite: ['vin', 'vinaigre'],
};

/**
 * Mots (normalisés) qui excluent une recette dès qu'ils apparaissent dans un de ses ingrédients de base :
 * allergies (avec leur famille) et régime. Par mot plutôt que par nom exact : « arachide » doit aussi
 * exclure « huile d'arachide », « porc » doit exclure « filet de porc ».
 */
export function exclusionWords(q: Questionnaire): string[] {
  const words = new Set<string>();
  for (const a of q.allergies) {
    const k = normalizeKey(a);
    if (!k) continue;
    words.add(k);
    for (const w of ALLERGEN_FAMILIES[k] ?? []) words.add(normalizeKey(w));
  }
  for (const d of dietExclusions(q.diet)) words.add(normalizeKey(d));
  return [...words];
}

/** Un ingrédient de base (clé normalisée) contient-il un des mots, en entier ? */
export function containsWord(baseKey: string, words: string[]): boolean {
  const padded = ` ${baseKey} `;
  return words.some(w => padded.includes(` ${w} `));
}

/** Résumé lisible de ce qui a changé dans le questionnaire, pour le signal envoyé au profil. */
export function questionnaireDiff(before: Questionnaire, after: Questionnaire): string {
  const changes: string[] = [];
  for (const k of Object.keys(after) as Array<keyof Questionnaire>) {
    const a = JSON.stringify(before[k]), b = JSON.stringify(after[k]);
    if (a !== b) changes.push(`${k} : ${a} → ${b}`);
  }
  return changes.join(' ; ').slice(0, 1500);
}
