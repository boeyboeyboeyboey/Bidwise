// Past-term data for Browse: decode the term shards emitted by model/build_site_data.py (build_browse), group them by section, and build
// the course-to-terms lookup. Pure and DOM-free; the component and loaders live elsewhere.
import { formatSlot } from '../../lib/format/slot';

export interface BrowseManifest {
  /** Column names of each shard row, in order. */
  columns: string[];
  /** Course codes, in index.json order; a row's `course` is a position here. */
  codes: string[];
  windows: string[];
  sections: string[];
  instructors: string[];
  /** [days, start, end] as joined in the dataset ("MON; THU", "08:15; 08:15", "09:00; 09:45"); a row's `slot` is a position here. Absent in older data. */
  slots?: (string | null)[][];
  terms: { term: string; file: string; rows: number }[];
}

export interface BrowseShard {
  term: string;
  rows: (number | null)[][];
}

export interface BrowseRow {
  code: string;
  term: string;
  window: string;
  section: string;
  instructor: string | null;
  /** Day and time as text ("Mon, Thu 12:00–15:15"); '' when the section has no timetable. */
  slot: string;
  medianCents: number | null;
  minCents: number | null;
  vacancy: number | null;
  before: number | null;
  after: number | null;
  filled: boolean;
}

/** Window labels in the order BOSS runs them (mirrors WINDOW_ORDER in model/build_site_data.py). Unknown labels sort last. */
export const WINDOW_ORDER = [
  'Incoming Exchange Rnd 1C Win 1', 'Incoming Exchange Rnd 1C Win 2', 'Incoming Exchange Rnd 1C Win 3',
  'Incoming Freshmen Rnd 1 Win 1', 'Incoming Freshmen Rnd 1 Win 2', 'Incoming Freshmen Rnd 1 Win 3', 'Incoming Freshmen Rnd 1 Win 4',
  'Round 1 Window 1', 'Round 1 Window 2', 'Round 1 Window 3', 'Round 1 Window 4',
  'Round 1A Window 1', 'Round 1A Window 2', 'Round 1A Window 3',
  'Round 1B Window 1', 'Round 1B Window 2',
  'Round 2 Window 1', 'Round 2 Window 2', 'Round 2 Window 3', 'Round 2 Window 4',
  'Round 2A Window 1', 'Round 2A Window 2', 'Round 2A Window 3',
];
const WINDOW_RANK = new Map(WINDOW_ORDER.map((w, i) => [w, i]));
export const windowRank = (w: string): number => WINDOW_RANK.get(w) ?? WINDOW_ORDER.length;

// ---- Decode

/** Rows of one shard with every lookup index resolved. Columns are found by name, so their order may change. */
export function decodeShard(man: BrowseManifest, shard: BrowseShard): BrowseRow[] {
  const at = Object.fromEntries(man.columns.map((c, i) => [c, i])) as Record<string, number>;
  const num = (r: (number | null)[], c: string): number | null => r[at[c]] ?? null;
  const look = (r: (number | null)[], c: string, table: string[]): string | null => {
    const i = r[at[c]];
    return i === null || i === undefined || i < 0 ? null : (table[i] ?? null);
  };
  const slotText = (man.slots ?? []).map((x) => formatSlot({ days: x[0], start: x[1], end: x[2] }));
  return shard.rows.map((r) => ({
    code: man.codes[r[at.course] as number],
    term: shard.term,
    window: look(r, 'window', man.windows) ?? '',
    section: look(r, 'section', man.sections) ?? '',
    instructor: look(r, 'instructor', man.instructors),
    slot: slotText[r[at.slot] ?? -1] ?? '',
    medianCents: num(r, 'medianCents'),
    minCents: num(r, 'minCents'),
    vacancy: num(r, 'vacancy'),
    before: num(r, 'before'),
    after: num(r, 'after'),
    filled: r[at.filled] === 1,
  }));
}

// ---- Group

/** One section in one term, over all its bidding windows. `head` is the row shown; `others` are the remaining windows, latest first. */
export interface BrowseGroup {
  key: string;
  head: BrowseRow;
  others: BrowseRow[];
}

/**
 * One group per course, section and term. The head is the latest window in which a bid won a seat (the one with a median bid),
 * or the latest window when no window had a winning bid. Windows are ordered as BOSS runs them, so "latest" is the last one run.
 */
export function groupRows(rows: readonly BrowseRow[]): BrowseGroup[] {
  const by = new Map<string, BrowseRow[]>();
  for (const r of rows) {
    const k = `${r.code}|${r.section}|${r.term}`;
    const l = by.get(k);
    if (l) l.push(r);
    else by.set(k, [r]);
  }
  return [...by].map(([key, list]) => {
    const latestFirst = list.map((r, i) => [r, i] as const).sort((a, b) => windowRank(b[0].window) - windowRank(a[0].window) || a[1] - b[1]).map((x) => x[0]);
    const i = Math.max(0, latestFirst.findIndex((r) => r.medianCents !== null));
    return { key, head: latestFirst[i], others: latestFirst.filter((_, j) => j !== i) };
  });
}

// ---- Display

/** Cents as e$ with 2 decimals; "–" when nobody won. */
export const fmtBid = (cents: number | null): string => (cents === null ? '–' : (cents / 100).toFixed(2));

/** A seat count; "–" for an unknown number. */
export const fmtSeats = (n: number | null): string => (n === null ? '–' : String(n));

/** A stored window label in full words: "Incoming Exchange Rnd 1C Win 1" becomes "Incoming Exchange Round 1C Window 1". */
export const fullWindow = (w: string): string => w.replace(/\bRnd\b/g, 'Round').replace(/\bWin\b/g, 'Window');

// ---- Sections of one course in one past term

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** One section of a course in a past term: the details and every bidding window it ran in, in the order BOSS runs them. */
export interface PastSection {
  section: string;
  instructor: string | null;
  /** Day and time as text; '' when none. */
  slot: string;
  windows: BrowseRow[];
}

/** Sections (G2 before G10) of `code` found in `rows`. Rows of other courses are ignored. The details are those of the latest window with a winning bid (see groupRows). */
export function pastSections(rows: readonly BrowseRow[], code: string): PastSection[] {
  return groupRows(rows.filter((r) => r.code === code))
    .map((g) => ({
      section: g.head.section,
      instructor: g.head.instructor,
      slot: g.head.slot,
      windows: [g.head, ...g.others].sort((a, b) => windowRank(a.window) - windowRank(b.window)),
    }))
    .sort((a, b) => natural(a.section, b.section));
}

/** Seats won in one window: seats offered minus seats left after. null when either is unknown. */
export const seatsTaken = (r: Pick<BrowseRow, 'before' | 'after'>): number | null =>
  r.before === null || r.after === null ? null : Math.max(0, r.before - r.after);

// ---- Which terms have data for a course

/** Compact lookup served at /data/browse-terms.json: `by[code]` lists positions in `terms` (oldest first, as in the manifest). */
export interface CourseTerms {
  terms: string[];
  by: Record<string, number[]>;
}

/** Built at build time from the manifest and every shard, so the browser can offer the right terms without loading them. */
export function courseTerms(man: BrowseManifest, shards: readonly BrowseShard[]): CourseTerms {
  const terms = man.terms.map((t) => t.term);
  const by: Record<string, Set<number>> = {};
  const course = man.columns.indexOf('course');
  for (const sh of shards) {
    const t = terms.indexOf(sh.term);
    if (t < 0) continue;
    for (const r of sh.rows) (by[man.codes[r[course] as number]] ??= new Set()).add(t);
  }
  return { terms, by: Object.fromEntries(Object.entries(by).map(([c, s]) => [c, [...s].sort((a, b) => a - b)])) };
}
