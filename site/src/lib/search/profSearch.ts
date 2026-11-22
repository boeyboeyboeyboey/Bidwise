// Professor search for the home search box: every typed word must start a word of the name, in any order.
// Normalising is the same as course search (see courseSearch.ts): case, "&" and apostrophes are handled there.
import { flatText, searchWords } from './courseSearch';

/** One professor as the search index holds it: display name, profile slug, course count, teaching this term (1) or not (0). */
export type ProfEntry = readonly [name: string, slug: string, courseCount: number, teachingNow: 0 | 1];

const MIN_LETTERS = 2;

/**
 * Every professor matching the text, best first. Pass `limit` to keep only the first rows.
 * Rank: 0 the full name (same words, any order), 1 the name starts with the text, 2 other matches.
 * Ties: teaching this term first, then more courses, then name.
 */
export function searchProfs<T extends ProfEntry>(entries: readonly T[], query: string, limit = Infinity): T[] {
  if (flatText(query).length < MIN_LETTERS) return [];
  const qWords = searchWords(query);
  const qJoined = qWords.join(' ');
  const qSorted = [...qWords].sort().join(' ');
  const hits: { entry: T; rank: number }[] = [];
  for (const entry of entries) {
    const nameWords = searchWords(entry[0]);
    if (!qWords.every((w) => nameWords.some((n) => n.startsWith(w)))) continue;
    const nameJoined = nameWords.join(' ');
    const rank = [...nameWords].sort().join(' ') === qSorted ? 0 : nameJoined.startsWith(qJoined) ? 1 : 2;
    hits.push({ entry, rank });
  }
  hits.sort((a, b) =>
    a.rank - b.rank ||
    b.entry[3] - a.entry[3] ||
    b.entry[2] - a.entry[2] ||
    a.entry[0].localeCompare(b.entry[0]),
  );
  return hits.slice(0, limit).map((h) => h.entry);
}
