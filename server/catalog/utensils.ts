import { normalizeKey } from './text.ts';

// big = compte dans la vaisselle ; small = petit outil (affiché, pas compté) ; device = appareil ; consumable = jetable.
type Kind = 'big' | 'small' | 'device' | 'consumable';

// Vocabulaire canonique. Sert à la fois à nettoyer la liste du site (qui mélange de la pub :
// « Table induction SaphirMatt Electrolux ») et à déduire les ustensiles depuis les étapes.
// Les mots-clés sont comparés mot à mot après normalisation (« four » ne matche pas « fourchette »).
const CANON: Array<[name: string, kind: Kind, keywords: string[]]> = [
  ['Four', 'device', ['four', 'enfourner', 'prechauffer', 'thermostat']],
  ['Robot cuiseur', 'device', ['thermomix', 'cookeo', 'companion', 'monsieur cuisine', 'robot cuiseur', 'multicuiseur', 'magimix cook']],
  ['Airfryer', 'device', ['airfryer', 'air fryer', 'actifry', 'friteuse sans huile']],
  ['Machine à pain', 'device', ['machine a pain', 'map']],
  ['Micro-ondes', 'device', ['micro onde', 'micro-ondes']],
  ['Plaque de cuisson', 'device', ['plaque de cuisson', 'plaque induction', 'table induction', 'plaque vitroceramique', 'gaziniere', 'cuisiniere']],
  ['Réfrigérateur', 'device', ['refrigerateur', 'frigo']],
  ['Congélateur', 'device', ['congelateur']],
  ['Balance', 'device', ['balance']],
  ['Robot / mixeur', 'big', ['mixeur', 'mixer', 'blender', 'robot', 'hachoir']],
  ['Batteur électrique', 'small', ['batteur']],
  ['Autocuiseur', 'big', ['autocuiseur', 'cocotte minute']],
  ['Cocotte', 'big', ['cocotte', 'faitout', 'marmite']],
  ['Casserole', 'big', ['casserole']],
  ['Poêle', 'big', ['poele', 'sauteuse']],
  ['Wok', 'big', ['wok']],
  ['Plat à gratin', 'big', ['plat a gratin', 'plat allant au four', 'plat a four', 'plat de cuisson']],
  ['Moule', 'big', ['moule', 'cercle a patisserie', 'ramequin']],
  ['Plaque du four', 'big', ['plaque du four', 'plaque de four', 'plaque a patisserie', 'lechefrite']],
  ['Saladier', 'big', ['saladier', 'jatte', 'cul de poule']],
  ['Bol', 'big', ['bol']],
  ['Cuit-vapeur', 'big', ['cuit vapeur', 'panier vapeur']],
  ['Friteuse', 'big', ['friteuse']],
  ['Crêpière', 'big', ['crepiere']],
  ['Gaufrier', 'big', ['gaufrier']],
  ['Couteau', 'small', ['couteau']],
  ['Planche à découper', 'small', ['planche a decouper', 'couper', 'emincer', 'decouper', 'hacher', 'ciseler', 'trancher']],
  ['Fouet', 'small', ['fouet', 'fouetter']],
  ['Spatule', 'small', ['spatule', 'maryse']],
  ['Cuillère en bois', 'small', ['cuillere en bois']],
  ['Louche', 'small', ['louche']],
  ['Écumoire', 'small', ['ecumoire']],
  ['Râpe', 'small', ['rape', 'raper']],
  ['Passoire', 'small', ['passoire', 'egoutter', 'chinois']],
  ['Économe', 'small', ['econome', 'eplucheur', 'eplucher']],
  ['Rouleau à pâtisserie', 'small', ['rouleau a patisserie', 'etaler la pate', 'abaisser']],
  ['Emporte-pièce', 'small', ['emporte piece']],
  ['Grille', 'small', ['grille']],
  ['Pinceau', 'small', ['pinceau']],
  ['Presse-agrumes', 'small', ['presse agrume']],
  ['Poche à douille', 'small', ['poche a douille', 'douille']],
  ['Mandoline', 'small', ['mandoline']],
  ['Ciseaux', 'small', ['ciseaux']],
  ['Couvercle', 'small', ['couvercle']],
  ['Papier cuisson', 'consumable', ['papier sulfurise', 'papier cuisson']],
  ['Papier aluminium', 'consumable', ['papier aluminium', 'papier alu']],
  ['Film alimentaire', 'consumable', ['film alimentaire']],
];

const CANON_KEYS = CANON.map(([name, kind, words]) => ({ name, kind, keys: words.map(w => ` ${normalizeKey(w)} `) }));

function match(text: string): typeof CANON_KEYS {
  const t = ` ${normalizeKey(text)} `;
  return CANON_KEYS.filter(c => c.keys.some(k => t.includes(k)));
}

/** Ramène la liste du site au vocabulaire canonique ; les entrées inconnues (pub, marques) sont ignorées. */
export function canonicalUtensils(titles: string[]): string[] {
  const names = new Set<string>();
  for (const title of titles) {
    const first = match(title)[0];
    if (first) names.add(first.name);
  }
  return order([...names]);
}

// La liste de Marmiton est saisie par l'auteur et contient souvent des ustensiles inutiles (un mixeur pour une
// sauce à la crème). Un ustensile de cette liste n'est gardé que si les étapes en ont besoin : son nom, ou un
// geste qui l'implique (« remuer » → cuillère en bois). Sans geste connu, seul son nom dans les étapes compte.
const CONFIRM: Record<string, string[]> = {
  'Casserole': ['bouillir', 'ebullition', 'chauffer', 'fondre', 'cuire', 'blanchir', 'reduire'],
  'Poêle': ['faire revenir', 'revenir', 'dorer', 'saisir', 'rissoler', 'sauter', 'griller'],
  'Cocotte': ['mijoter', 'braiser', 'cuire a feu doux'],
  'Plat à gratin': ['plat', 'gratiner'],
  'Moule': ['moule', 'demouler'],
  'Saladier': ['recipient', 'melanger', 'bol'],
  'Bol': ['recipient', 'melanger'],
  'Robot / mixeur': ['mixer', 'mixez', 'broyer', 'moudre', 'reduire en puree', 'hacher finement'],
  'Fouet': ['battre', 'fouetter', 'emulsionner', 'monter en neige', 'blanchir'],
  'Batteur électrique': ['battre', 'fouetter', 'monter en neige'],
  'Couteau': ['couper', 'emincer', 'trancher', 'hacher', 'ciseler', 'decouper', 'peler', 'eplucher', 'tailler'],
  'Planche à découper': ['couper', 'emincer', 'trancher', 'hacher', 'ciseler', 'decouper', 'tailler'],
  'Spatule': ['melanger', 'remuer', 'racler', 'incorporer'],
  'Cuillère en bois': ['melanger', 'remuer', 'tourner'],
  'Balance': ['peser'],
  'Réfrigérateur': ['au frais', 'refroidir', 'laisser prendre', 'reserver au frais'],
  'Grille': ['demouler', 'refroidir'],
  'Passoire': ['egoutter', 'rincer'],
  'Plaque du four': ['plaque'],
  'Papier cuisson': ['papier'],
};

/** Ustensiles de la recette : ceux de la liste du site que les étapes justifient, plus ceux que les étapes citent. */
export function utensilsFor(site: string[], steps: string[]): string[] {
  const text = ` ${normalizeKey(steps.join(' '))} `;
  const deduced = deduceUtensils(steps);
  const confirmed = site.filter(u => deduced.includes(u) || (CONFIRM[u] ?? []).some(w => text.includes(` ${normalizeKey(w)} `)));
  return order([...new Set([...confirmed, ...deduced])]);
}

/** Déduction par mots-clés dans les étapes, quand le site ne liste pas ses ustensiles. */
export function deduceUtensils(steps: string[]): string[] {
  return order(match(steps.join(' ')).map(c => c.name));
}

function order(names: string[]): string[] {
  const rank = (n: string) => CANON.findIndex(([c]) => c === n);
  return names.sort((a, b) => rank(a) - rank(b));
}

// Appareils spéciaux souvent cités seulement dans le titre (« Saumon au Thermomix »).
const NAME_DEVICES = new Set(['Robot cuiseur', 'Airfryer', 'Machine à pain', 'Autocuiseur', 'Friteuse', 'Wok', 'Micro-ondes', 'Crêpière', 'Gaufrier', 'Cuit-vapeur']);

export function devicesInName(name: string): string[] {
  return match(name).filter(c => NAME_DEVICES.has(c.name)).map(c => c.name);
}

/** Ajoute les appareils cités dans le titre à la liste d'ustensiles. */
export function withNameDevices(utensils: string[], name: string): string[] {
  return order([...new Set([...utensils, ...devicesInName(name)])]);
}

/** Nombre de grosses pièces à laver, au moins 1. */
export function countDishes(utensils: string[]): number {
  return Math.max(1, utensils.filter(u => CANON.find(([n]) => n === u)?.[1] === 'big').length);
}
