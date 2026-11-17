// Course search shared by every course search box: code, title and nickname matching with one ranking.
// Punctuation never matters: "&" reads as "and", apostrophes vanish ("Asia's" = "asias"), anything else splits words.
import { COURSE_ALIASES } from './aliases';

export function searchWords(s: string): string[] {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

/** Lowercase letters and digits only, after the same "&" and apostrophe handling. */
export const flatText = (s: string): string => searchWords(s).join('');

/** The typed words, each flattened: "W&R" stays one word ("wandr"), "Business, Government" is two. */
export const queryTokens = (q: string): string[] => q.split(/\s+/).map(flatText).filter(Boolean);

const ALIASES_BY_CODE = new Map(
  Object.entries(COURSE_ALIASES).map(([code, names]) => [code, [...new Set(names.map(flatText).filter(Boolean))]]),
);

/** Nicknames of a course as written, for display (e.g. a suggestion label); empty when it has none. */
export function nicknamesOf(code: string): readonly string[] {
  return COURSE_ALIASES[code] ?? [];
}

/** Nicknames of a course, flattened (empty when it has none). */
export function aliasesOf(code: string): string[] {
  return ALIASES_BY_CODE.get(code) ?? [];
}

interface Query { flat: string; words: string[] }

/** The search text prepared once per keystroke; null when it has no letters or digits (so "&" or "-" alone finds nothing). */
function prepare(query: string): Query | null {
  if (!/[a-z0-9]/i.test(query)) return null;
  return { flat: flatText(query), words: queryTokens(query) };
}

function rankPrepared(code: string, title: string, q: Query, aliases: readonly string[]): number {
  const full = flatText(code);
  const bare = flatText(code.slice(code.indexOf('-') + 1));
  if (full === q.flat || bare === q.flat) return 0;
  if (aliases.includes(q.flat)) return 1;
  if (full.startsWith(q.flat) || bare.startsWith(q.flat)) return 2;
  const tw = searchWords(title);
  if (q.words.every((w) => tw.some((t) => t.startsWith(w)))) return 3;
  if (q.flat.length >= 2 && aliases.some((a) => a.startsWith(q.flat))) return 4;
  // Each typed word inside one title word, so a joined nickname ("w&r") can't match across words.
  if (full.includes(q.flat) || q.words.every((w) => tw.some((t) => t.includes(w)))) return 5;
  return -1;
}

/**
 * How well a course matches the search text; lower is better, -1 is no match.
 * 0 exact code (with or without its "COR-" style prefix), 1 exact nickname, 2 code prefix, 3 every word starts a title
 * word, 4 nickname prefix, 5 code contains the text or every word sits inside a title word.
 */
export function courseRank(code: string, title: string, query: string, aliases: readonly string[] = aliasesOf(code)): number {
  const q = prepare(query);
  return q ? rankPrepared(code, title, q, aliases) : -1;
}

/** Items matching the text, best first; ties keep their input order. */
export function rankCourses<T>(items: readonly T[], query: string, key: (item: T) => readonly [code: string, title: string]): T[] {
  const q = prepare(query);
  if (!q) return [];
  const hits: { item: T; rank: number; i: number }[] = [];
  items.forEach((item, i) => {
    const [code, title] = key(item);
    const rank = rankPrepared(code, title, q, aliasesOf(code));
    if (rank >= 0) hits.push({ item, rank, i });
  });
  return hits.sort((a, b) => a.rank - b.rank || a.i - b.i).map((h) => h.item);
}

/** True when the text is exactly this course's code (with or without its prefix). */
export function isExactCode(code: string, query: string): boolean {
  return courseRank(code, '', query, []) === 0;
}
