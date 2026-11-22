// Professor search for the home search box: every typed word must start a word of the name, in any order.
// Normalising is the same as course search (see courseSearch.ts): case, "&" and apostrophes are handled there.
// When nothing matches exactly, close matches (typos) are offered with the course search's per-word typo rule.
import { editDistance, flatText, searchWords, wordEdits } from './courseSearch';

/** One professor as the search index holds it: display name, profile slug, course count, teaching this term (1) or not (0). */
export type ProfEntry = readonly [name: string, slug: string, courseCount: number, teachingNow: 0 | 1];

const MIN_LETTERS = 2;

/** Ties: teaching this term first, then more courses, then name. */
const byStanding = (a: ProfEntry, b: ProfEntry): number => b[3] - a[3] || b[2] - a[2] || a[0].localeCompare(b[0]);

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
  hits.sort((a, b) => a.rank - b.rank || byStanding(a.entry, b.entry));
  return hits.slice(0, limit).map((h) => h.entry);
}

/**
 * Close matches (typos): every typed word is within the course search's typo allowance of a name word or its start
 * (none up to 3 letters, 1 up to 7, then 2). Fewest typos first; on equal typos a whole-word match beats one against the start of
 * a longer word ("jhon" lists John before Chong); then the usual ties.
 */
export function closeProfs<T extends ProfEntry>(entries: readonly T[], query: string): T[] {
  if (flatText(query).length < MIN_LETTERS) return [];
  const qWords = searchWords(query);
  const hits: { entry: T; cost: number }[] = [];
  for (const entry of entries) {
    const nameWords = searchWords(entry[0]);
    let cost = 0;
    for (const w of qWords) {
      let best = -1;
      for (const n of nameWords) {
        const e = wordEdits(w, n);
        if (e < 0) continue;
        // Cost in tenths of a typo: +1 when only the start of the name word matches this well.
        const d = e * 10 + (editDistance(w, n, e) <= e ? 0 : 1);
        if (best < 0 || d < best) best = d;
        if (best === 0) break;
      }
      if (best < 0) { cost = -1; break; }
      cost += best;
    }
    if (cost >= 0) hits.push({ entry, cost });
  }
  hits.sort((a, b) => a.cost - b.cost || byStanding(a.entry, b.entry));
  return hits.map((h) => h.entry);
}

/** Exact matches; when there are none, close matches instead, with `close` set (same shape as searchCourses). */
export function findProfs<T extends ProfEntry>(entries: readonly T[], query: string): { items: T[]; close: boolean } {
  const exact = searchProfs(entries, query);
  if (exact.length) return { items: exact, close: false };
  const near = closeProfs(entries, query);
  return { items: near, close: near.length > 0 };
}
