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

/**
 * Matching items, best first; when nothing matches exactly, close matches (typos) instead, with `close` set.
 * Every course search box uses this.
 */
export function searchCourses<T>(items: readonly T[], query: string, key: (item: T) => readonly [code: string, title: string]): { items: T[]; close: boolean } {
  const exact = rankCourses(items, query, key);
  if (exact.length) return { items: exact, close: false };
  const q = prepare(query);
  if (!q) return { items: [], close: false };
  const hits: { item: T; cost: number; i: number }[] = [];
  items.forEach((item, i) => {
    const [code, title] = key(item);
    const cost = closePrepared(code, title, q, aliasesOf(code));
    if (cost >= 0) hits.push({ item, cost, i });
  });
  return { items: hits.sort((a, b) => a.cost - b.cost || a.i - b.i).map((h) => h.item), close: hits.length > 0 };
}

/** True when the text is exactly this course's code (with or without its prefix). */
export function isExactCode(code: string, query: string): boolean {
  return courseRank(code, '', query, []) === 0;
}

// ---- Close matches (typos), used only when nothing matches exactly.

/** Typos forgiven in a typed word of this length: none up to 3 letters, 1 up to 7, then 2. */
const allowedEdits = (n: number): number => (n <= 3 ? 0 : n <= 7 ? 1 : 2);

/** Edit distance where swapping two neighbouring letters counts as one edit; any value above `max` comes back as max + 1. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[b.length], max + 1);
}

/** Typos between a typed word and a title word, or the start of it (a word still being typed); -1 if too many. */
function wordEdits(w: string, t: string): number {
  const max = allowedEdits(w.length);
  if (max === 0) return t.startsWith(w) ? 0 : -1;
  let best = editDistance(w, t, max);
  // Against the start of a longer word only one typo is forgiven; two would let "intrenal" find "international".
  for (let len = w.length - 1; len <= w.length + 1 && best > 1; len++) {
    if (len < 1 || len >= t.length) continue;
    const d = editDistance(w, t.slice(0, len), 1);
    if (d <= 1) best = Math.min(best, d);
  }
  return best <= max ? best : -1;
}

const titleWordCache = new Map<string, string[]>();
function titleWords(title: string): string[] {
  let tw = titleWordCache.get(title);
  if (!tw) titleWordCache.set(title, (tw = searchWords(title)));
  return tw;
}

/**
 * Cost of a close match, lower is better, -1 for none: 300 per typo, plus 0 for a code, 100 for a nickname, 200 for a
 * title plus its word count (so on a tie the tighter title, "Management Communication", beats a longer one).
 * Codes forgive one typo in the whole code (5+ characters typed), nicknames the usual number for their length, titles
 * the usual number per typed word.
 */
function closePrepared(code: string, title: string, q: Query, aliases: readonly string[]): number {
  let best = Infinity;
  if (q.flat.length >= 5) {
    const d = Math.min(editDistance(q.flat, flatText(code), 1), editDistance(q.flat, flatText(code.slice(code.indexOf('-') + 1)), 1));
    if (d <= 1) best = d * 300;
  }
  const maxNick = allowedEdits(q.flat.length);
  for (const a of aliases) {
    const d = editDistance(q.flat, a, maxNick);
    if (d <= maxNick) best = Math.min(best, d * 300 + 100);
  }
  const tw = titleWords(title);
  let sum = 0;
  for (const w of q.words) {
    let wb = -1;
    for (const t of tw) {
      const d = wordEdits(w, t);
      if (d >= 0 && (wb < 0 || d < wb)) wb = d;
      if (wb === 0) break;
    }
    if (wb < 0) { sum = -1; break; }
    sum += wb;
  }
  if (sum >= 0) best = Math.min(best, sum * 300 + 200 + Math.min(tw.length, 99));
  return best === Infinity ? -1 : best;
}

/** Close-match cost of one course (see closePrepared), for callers that rank their own lists; -1 for none. */
export function closeCost(code: string, title: string, query: string, aliases: readonly string[] = aliasesOf(code)): number {
  const q = prepare(query);
  return q ? closePrepared(code, title, q, aliases) : -1;
}
