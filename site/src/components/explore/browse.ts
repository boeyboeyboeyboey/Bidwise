// Browse all sections: decode the term shards emitted by model/build_site_data.py (build_browse), then filter, sort and page them.
// Pure and DOM-free; the component and loaders live elsewhere.
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

export type SortKey = 'course' | 'section' | 'instructor' | 'term' | 'window' | 'median' | 'min' | 'start' | 'seats' | 'filled';
export const SORT_KEYS: SortKey[] = ['course', 'section', 'instructor', 'term', 'window', 'median', 'min', 'start', 'seats', 'filled'];

export interface BrowseState {
  school: string;
  /** '' = the latest term with results, 'all' = every term, else a term label. */
  term: string;
  /** '' = all windows. */
  window: string;
  instructor: string;
  q: string;
  filled: boolean;
  sort: SortKey;
  dir: 'asc' | 'desc';
  /** 0-based. */
  page: number;
}

/** Rows per page on a wide screen: few enough that the table and its pager fit one 1080px-high screen. */
export const PAGE_SIZE = 8;
/** Rows per page where each row is a short card (under 1100px wide). */
export const PAGE_SIZE_CARDS = 10;

export const browseDefaults = (): BrowseState => ({
  school: '', term: '', window: '', instructor: '', q: '', filled: false, sort: 'course', dir: 'asc', page: 0,
});

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

// ---- URL state (shares the page's query string with the builder; `v=browse` selects this mode)

const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
  v && (all as readonly string[]).includes(v) ? (v as T) : d;

export function encodeBrowse(st: BrowseState): string {
  const p = new URLSearchParams({ v: 'browse' });
  if (st.school) p.set('bs', st.school);
  if (st.term) p.set('bt', st.term);
  if (st.window) p.set('bw', st.window);
  if (st.instructor) p.set('bi', st.instructor);
  if (st.q) p.set('bq', st.q);
  if (st.filled) p.set('bf', '1');
  if (st.sort !== 'course') p.set('bo', st.sort);
  if (st.dir === 'desc') p.set('bd', 'desc');
  if (st.page > 0) p.set('bp', String(st.page + 1));
  return p.toString();
}

export function decodeBrowse(search: string): BrowseState {
  const p = new URLSearchParams(search);
  const pg = Number.parseInt(p.get('bp') ?? '', 10);
  return {
    school: p.get('bs') ?? '',
    term: p.get('bt') ?? '',
    window: p.get('bw') ?? '',
    instructor: p.get('bi') ?? '',
    q: p.get('bq') ?? '',
    filled: p.get('bf') === '1',
    sort: pick(p.get('bo'), SORT_KEYS, 'course'),
    dir: p.get('bd') === 'desc' ? 'desc' : 'asc',
    page: Number.isFinite(pg) && pg > 1 ? pg - 1 : 0,
  };
}

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

// ---- Filter

export interface CourseInfo {
  title: string;
  school: string;
}

/** Words of a name or query: lowercase, commas and other punctuation dropped. */
const words = (x: string): string[] => x.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Every word of `query` must start a word of `name`, in any order: "lee yun" matches "LEE, YUN"; "tan" does not match "STAN". */
export function nameMatches(name: string, query: string): boolean {
  const q = words(query);
  if (!q.length) return true;
  const w = words(name);
  return q.every((t) => w.some((x) => x.startsWith(t)));
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Filters combine with AND. Instructor matches by word starts (see nameMatches), course text by substring; both are case-insensitive and a blank one is off. */
export function filterRows(
  rows: readonly BrowseRow[],
  f: Pick<BrowseState, 'school' | 'window' | 'instructor' | 'q' | 'filled'>,
  courses: ReadonlyMap<string, CourseInfo>,
): BrowseRow[] {
  const q = f.q.trim().toLowerCase();
  const qn = norm(q);
  return rows.filter((r) => {
    if (f.window && r.window !== f.window) return false;
    if (f.filled && !r.filled) return false;
    if (f.instructor.trim() && !nameMatches(r.instructor ?? '', f.instructor)) return false;
    const c = courses.get(r.code);
    if (f.school && c?.school !== f.school) return false;
    if (qn && !(norm(r.code).includes(qn) || (c?.title ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
}

// ---- Sort

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Missing values (null) always sort last, whichever the direction. */
const byNum = (a: number | null, b: number | null, dir: number) =>
  a === null || b === null ? (a === null ? 1 : 0) - (b === null ? 1 : 0) : (a - b) * dir;

/** A stable sort: rows that compare equal keep their input order. Input is not modified. */
export function sortRows(rows: readonly BrowseRow[], key: SortKey, dir: 'asc' | 'desc'): BrowseRow[] {
  const d = dir === 'asc' ? 1 : -1;
  const cmp = (a: BrowseRow, b: BrowseRow): number => {
    switch (key) {
      case 'course': return natural(a.code, b.code) * d;
      case 'section': return natural(a.section, b.section) * d;
      case 'instructor':
        return a.instructor === null || b.instructor === null
          ? (a.instructor === null ? 1 : 0) - (b.instructor === null ? 1 : 0)
          : natural(a.instructor, b.instructor) * d;
      case 'term': return (a.term < b.term ? -1 : a.term > b.term ? 1 : 0) * d;
      case 'window': return (windowRank(a.window) - windowRank(b.window)) * d;
      case 'median': return byNum(a.medianCents, b.medianCents, d);
      case 'min': return byNum(a.minCents, b.minCents, d);
      case 'start': return byNum(a.before, b.before, d);
      case 'seats': return byNum(a.after, b.after, d);
      case 'filled': return (Number(a.filled) - Number(b.filled)) * d;
    }
  };
  return rows.map((r, i) => [r, i] as const).sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map((x) => x[0]);
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

/** Groups ordered by their head row (see sortRows). */
export function sortGroups(groups: readonly BrowseGroup[], key: SortKey, dir: 'asc' | 'desc'): BrowseGroup[] {
  const of = new Map(groups.map((g) => [g.head, g] as const));
  return sortRows(groups.map((g) => g.head), key, dir).map((h) => of.get(h)!);
}

// ---- Page

export function pageOf<T>(rows: readonly T[], page: number, size = PAGE_SIZE): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(p * size, (p + 1) * size), page: p, pages };
}

// ---- Display

/** Cents as e$ with 2 decimals; "–" when nobody won. */
export const fmtBid = (cents: number | null): string => (cents === null ? '–' : (cents / 100).toFixed(2));

/** A seat count; "–" for an unknown number. */
export const fmtSeats = (n: number | null): string => (n === null ? '–' : String(n));

/** A stored window label in full words: "Incoming Exchange Rnd 1C Win 1" becomes "Incoming Exchange Round 1C Window 1". */
export const fullWindow = (w: string): string => w.replace(/\bRnd\b/g, 'Round').replace(/\bWin\b/g, 'Window');

/** Seats left after the window, in the course page's form: "2 seats left of 30 at start", "1 seat left of 30 at start"; "–" when unknown. */
export function fmtSeatsLeft(after: number | null, before: number | null): string {
  if (after === null) return '–';
  const left = `${after} ${after === 1 ? 'seat' : 'seats'} left`;
  return before === null ? left : `${left} of ${before} at start`;
}

/** Terms to fetch for a state: [] until the manifest is known. Newest first, so ties in a sort show the latest term first. */
export function termsToLoad(man: BrowseManifest, term: string): string[] {
  const all = man.terms.filter((t) => t.rows > 0).map((t) => t.term);
  if (term === 'all') return [...all].reverse();
  const want = term || all.at(-1);
  return want && all.includes(want) ? [want] : [];
}
