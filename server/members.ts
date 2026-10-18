import { getMeta, setMeta, type Db } from './db.ts';
import { DEFAULT_QUESTIONNAIRE, exclusionWords, getQuestionnaire, getWeights, type Questionnaire } from './preferences.ts';

// Les personnes pour qui on cuisine. « Moi » (is_self) reprend le questionnaire, les rejets et le profil IA ;
// les autres ont leurs propres régime, allergies et aversions (exclusions strictes, par familles).

export type Member = {
  id: number;
  name: string;
  isSelf: boolean;
  diet: Questionnaire['diet'];
  allergies: string[];
  aversions: string[];
  notes: string;
};

type Row = { id: number; name: string; is_self: number; diet: string; allergies: string; aversions: string; notes: string };
const toMember = (r: Row): Member => ({
  id: r.id, name: r.name, isSelf: !!r.is_self, diet: r.diet as Member['diet'],
  allergies: JSON.parse(r.allergies), aversions: JSON.parse(r.aversions), notes: r.notes,
});

/** Crée la fiche « Moi » au premier lancement. */
export function ensureSelf(db: Db): void {
  if (db.prepare('SELECT 1 FROM members WHERE is_self = 1').get()) return;
  db.prepare(`INSERT INTO members (name, is_self, diet, allergies, aversions, notes) VALUES ('Moi', 1, 'omnivore', '[]', '[]', '')`).run();
}

export function listMembers(db: Db): Member[] {
  return (db.prepare('SELECT * FROM members ORDER BY is_self DESC, id').all() as Row[]).map(toMember);
}

export function addMember(db: Db, name: string): Member {
  const n = name.trim().slice(0, 40);
  if (!n) throw new Error('Nom vide');
  const r = db.prepare(`INSERT INTO members (name, is_self, diet, allergies, aversions, notes) VALUES (?, 0, 'omnivore', '[]', '[]', '') RETURNING *`).get(n) as Row;
  // Un nouveau membre mange avec nous par défaut.
  setEaters(db, [...eaterIds(db), r.id]);
  return toMember(r);
}

export function updateMember(db: Db, id: number, patch: Partial<Omit<Member, 'id' | 'isSelf'>>): void {
  const cur = listMembers(db).find(m => m.id === id);
  if (!cur) throw new Error('Membre introuvable');
  const m = { ...cur, ...patch };
  const clean = (xs: string[]) => [...new Set(xs.map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  db.prepare('UPDATE members SET name = ?, diet = ?, allergies = ?, aversions = ?, notes = ? WHERE id = ?').run(
    m.name.trim().slice(0, 40) || cur.name, m.diet, JSON.stringify(clean(m.allergies)), JSON.stringify(clean(m.aversions)), m.notes.slice(0, 2000), id,
  );
}

export function deleteMember(db: Db, id: number): void {
  db.prepare('DELETE FROM members WHERE id = ? AND is_self = 0').run(id);
  setEaters(db, eaterIds(db).filter(e => e !== id));
}

/** Membres qui mangent ce repas (filtre « Pour : … »). Par défaut : tout le monde. */
export function eaterIds(db: Db): number[] {
  const all = listMembers(db).map(m => m.id);
  const raw = getMeta(db, 'eaters');
  const ids = raw ? (JSON.parse(raw) as number[]).filter(id => all.includes(id)) : all;
  return ids.length ? ids : all;
}

export function setEaters(db: Db, ids: number[]): void {
  const all = new Set(listMembers(db).map(m => m.id));
  const valid = [...new Set(ids)].filter(id => all.has(id));
  if (!valid.length) throw new Error('Choisis au moins une personne');
  setMeta(db, 'eaters', JSON.stringify(valid));
}

/** Contraintes du repas selon qui mange : exclusions cumulées, profil seulement si « Moi » mange. */
export function mealContext(db: Db) {
  const members = listMembers(db);
  const ids = new Set(eaterIds(db));
  const eaters = members.filter(m => ids.has(m.id));
  const self = eaters.find(m => m.isSelf);
  const q = getQuestionnaire(db) ?? DEFAULT_QUESTIONNAIRE;
  const words = new Set<string>();
  if (self) for (const w of exclusionWords(q, getWeights(db).exclude)) words.add(w);
  for (const m of eaters.filter(e => !e.isSelf)) {
    for (const w of exclusionWords({ ...DEFAULT_QUESTIONNAIRE, diet: m.diet, allergies: [...m.allergies, ...m.aversions] })) words.add(w);
  }
  return {
    eaters,
    selfEats: !!self,
    exclusionWords: [...words],
    // Plusieurs membres : les portions suivent le nombre de convives ; sinon, le nombre du questionnaire.
    persons: members.length > 1 ? eaters.length : q.persons,
  };
}
