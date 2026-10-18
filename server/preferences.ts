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
  /** Aversions fermes déclarées (ingrédients ou familles : « poisson », « fruit de mer »…) : exclusion stricte. */
  exclude?: string[];
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

// Ingrédients exclus selon le régime. Comparés mot à mot aux ingrédients ET au texte des lignes d'ingrédients
// (« bouillon de volaille » est rangé sous « bouillon », mais « volaille » l'écarte pour un végétarien).
const MEAT = [
  'viande', 'boeuf', 'veau', 'porc', 'agneau', 'mouton', 'cheval', 'poulet', 'dinde', 'canard', 'oie', 'pintade', 'caille',
  'chapon', 'coq', 'volaille', 'lapin', 'gibier', 'cerf', 'chevreuil', 'sanglier', 'biche', 'faisan', 'perdrix', 'pigeon',
  'jambon', 'jambonneau', 'lardon', 'lard', 'bacon', 'pancetta', 'coppa', 'bresaola', 'prosciutto', 'speck', 'saucisse', 'saucisson',
  'salami', 'chorizo', 'pepperoni', 'merguez', 'chipolata', 'knack', 'francfort', 'boudin', 'andouille', 'andouillette', 'rillette',
  'chair a saucisse', 'foie', 'rognon', 'gesier', 'abat', 'tripe', 'magret', 'confit', 'escalope', 'cote de porc', 'echine', 'poitrine',
  'travers', 'filet mignon', 'gigot', 'jarret', 'joue', 'cordon bleu', 'nugget', 'kebab', 'gelatine', 'fond de veau',
  'graisse de canard', 'graisse d oie', 'saindoux', 'suif', 'steak hache', 'paupiette', 'osso buco',
];
const SEA = ['poisson', 'fruit de mer', 'anchois', 'surimi', 'fumet', 'nuoc mam', 'sauce poisson', 'dashi', 'bonite', 'caviar', 'tarama', 'oeufs de saumon'];
const ANIMAL = [
  'oeuf', 'lait', 'creme', 'beurre', 'yaourt', 'fromage', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte',
  'chevre', 'roquefort', 'feta', 'reblochon', 'camembert', 'raclette', 'cheddar', 'miel', 'mayonnaise', 'chantilly', 'ghee', 'meringue', 'brioche',
];

export function dietExclusions(diet: Questionnaire['diet']): Set<string> {
  // Poisson et fruits de mer : toute la famille (saumon, cabillaud, crevettes…), comme pour les allergies.
  const sea = () => [...SEA, ...ALLERGEN_FAMILIES['poisson'], ...ALLERGEN_FAMILIES['fruit de mer']];
  if (diet === 'vegetarian') return new Set([...MEAT, ...sea()]);
  if (diet === 'pescetarian') return new Set(MEAT);
  if (diet === 'vegan') return new Set([...MEAT, ...sea(), ...ANIMAL]);
  return new Set();
}

// Familles d'allergènes : une allergie déclarée exclut tous les ingrédients de la famille.
const ALLERGEN_FAMILIES: Record<string, string[]> = {
  arachide: ['arachide', 'cacahuete', 'cacahouete', 'beurre de cacahuete'],
  cacahuete: ['arachide', 'cacahuete', 'cacahouete'],
  'fruit a coque': ['noix', 'noisette', 'amande', 'cajou', 'pistache', 'pecan', 'macadamia', 'pignon', 'praline', 'nougat', 'frangipane', 'massepain'],
  gluten: ['gluten', 'farine', 'pate', 'pates', 'pain', 'semoule', 'chapelure', 'biscuit', 'boulgour', 'ble', 'orge', 'seigle', 'epeautre', 'avoine', 'brioche', 'couscous', 'tortilla', 'crouton', 'boudoir', 'speculoos', 'biere', 'sauce soja', 'crepe', 'gaufre', 'cracker', 'wrap', 'blini', 'nouille', 'gnocchi', 'ravioli', 'lasagne', 'spaghetti', 'tagliatelle', 'macaroni', 'vermicelle'],
  lactose: ['lait', 'creme', 'beurre', 'fromage', 'yaourt', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'camembert', 'reblochon', 'raclette', 'cheddar', 'roquefort', 'bechamel', 'chantilly', 'lactose', 'petit suisse', 'kiri', 'babybel'],
  lait: ['lait', 'creme', 'beurre', 'fromage', 'yaourt', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'camembert', 'reblochon', 'raclette', 'cheddar', 'roquefort', 'bechamel', 'chantilly', 'lactose', 'petit suisse', 'kiri', 'babybel'],
  'produit laitier': ['lait', 'creme', 'beurre', 'fromage', 'yaourt', 'mascarpone', 'ricotta', 'mozzarella', 'parmesan', 'gruyere', 'emmental', 'comte', 'chevre', 'feta', 'camembert', 'reblochon', 'raclette', 'cheddar', 'roquefort', 'bechamel', 'chantilly', 'lactose', 'petit suisse', 'kiri', 'babybel'],
  oeuf: ['oeuf', 'mayonnaise', 'meringue'],
  // Fromages au goût prononcé : bleus et croûtes lavées.
  'fromage fort': ['fromage bleu', 'roquefort', 'gorgonzola', 'bleu', 'fourme', 'munster', 'maroille', 'livarot', 'epoisse', 'pont l eveque', 'langres', 'vieux lille', 'herve'],
  poisson: ['poisson', 'saumon', 'thon', 'cabillaud', 'dorade', 'daurade', 'sardine', 'anchois', 'truite', 'maquereau', 'merlu', 'colin', 'lieu', 'bar', 'loup', 'sole', 'surimi', 'fumet', 'pangasius', 'merou', 'limande', 'lotte', 'hareng', 'haddock', 'morue', 'eglefin', 'fletan', 'turbot', 'saint pierre', 'raie', 'rouget', 'anguille', 'sandre', 'brochet', 'carpe', 'perche', 'espadon', 'merlan', 'tilapia', 'mulet', 'congre', 'tarama', 'caviar'],
  crustace: ['crevette', 'gambas', 'crabe', 'homard', 'langoustine', 'ecrevisse', 'surimi'],
  'fruit de mer': ['fruit de mer', 'crevette', 'gambas', 'crabe', 'homard', 'langouste', 'langoustine', 'ecrevisse', 'moule', 'huitre', 'saint jacques', 'petoncle', 'calamar', 'calmar', 'encornet', 'poulpe', 'seiche', 'coque', 'palourde', 'bigorneau', 'bulot', 'couteaux', 'oursin', 'surimi'],
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
/**
 * Saisie libre → clé d'allergène : « Sans gluten », « intolérance au lactose », « allergie aux arachides »,
 * « produits laitiers » sont ramenés à « gluten », « lactose », « arachide », « produit laitier ».
 */
export function allergenKey(text: string): string {
  return normalizeKey(text)
    .replace(/^(san|sans|intolerance|intolerant|intolerante|allergie|allergique|allergi)\b\s*/, '')
    .replace(/^(au|aux|a la|a l|a|de|du|des|d)\b\s*/, '')
    .trim();
}

export function exclusionWords(q: Questionnaire, aversions: string[] = []): string[] {
  const words = new Set<string>();
  for (const a of [...q.allergies, ...aversions]) {
    const k = allergenKey(a);
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
