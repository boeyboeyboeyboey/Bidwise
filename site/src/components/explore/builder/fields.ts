// Chart builder field registry: every field the builder can put on an axis or narrow a line by, read from a decoded Browse row.
// Pure and DOM-free. Row semantics follow BOSS_FACTS.md: vacancy = seats in the section, before = seats offered in this window
// (before-process vacancy), after = seats left after allocation, taken = before - after (successful bids).
import { windowRank, type BrowseRow } from '../browse';

export type FieldKind = 'category' | 'number';
export type FieldUnit = 'e$' | 'seats' | '%' | 'none';
export type Value = string | number | null;

export interface Field {
  id: string;
  label: string;
  kind: FieldKind;
  unit: FieldUnit;
  /** The row's value: string | null for a category, number | null for a number. */
  get: (r: BrowseRow) => Value;
  /** Natural order of two non-null values (terms chronological, windows in BOSS order, sections numeric). */
  compare: (a: Value, b: Value) => number;
  /** Display text of a non-null value ("Round 1 Window 1" shows as "R1 W1", 1250 cents' e$ as "12.50"). */
  fmt: (v: Value) => string;
  /** Text for a missing value when it is not "(none)" ("No time set" for the time fields). Filters still match it as "(none)". */
  noneLabel?: string;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const strCmp = (a: Value, b: Value) => natural(String(a), String(b));
const numCmp = (a: Value, b: Value) => (a as number) - (b as number);
const plain = (v: Value) => String(v);

// ---- Window and round

/** "Round 1A Window 2" -> "R1A W2"; "Incoming Exchange Rnd 1C Win 1" -> "Exch R1C W1"; "Incoming Freshmen Rnd 1 Win 2" -> "Fresh R1 W2". Unknown text is returned as is. */
export function shortWindow(w: string): string {
  const m = /^(Incoming Exchange|Incoming Freshmen)?\s*R(?:ou)?nd\s+(\w+)\s+Win(?:dow)?\s+(\w+)$/i.exec(w.trim());
  if (!m) return w;
  const pre = m[1] ? (/exchange/i.test(m[1]) ? 'Exch ' : 'Fresh ') : '';
  return `${pre}R${m[2]} W${m[3]}`;
}

// ---- Timetable (parsed from the decoded slot text, memoised: a few hundred distinct strings across all rows)

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface Slot {
  /** Day pattern in week order, "Mon, Thu"; null when the section has no timetable. */
  days: string | null;
  /** Earliest start, minutes after midnight; null when none. */
  start: number | null;
}

const slotCache = new Map<string, Slot>();

export function parseSlot(text: string): Slot {
  let s = slotCache.get(text);
  if (s) return s;
  const days = new Set<number>();
  let start: number | null = null;
  for (const part of text.split(' \u00b7 ')) {
    const m = /^([A-Za-z, ]+?)\s+(\d{1,2}):(\d{2})/.exec(part.trim());
    if (!m) continue;
    for (const d of m[1].split(/\s*,\s*/)) {
      const i = DAYS.indexOf(d);
      if (i >= 0) days.add(i);
    }
    const t = Number(m[2]) * 60 + Number(m[3]);
    start = start === null ? t : Math.min(start, t);
  }
  s = { days: days.size ? [...days].sort((a, b) => a - b).map((i) => DAYS[i]).join(', ') : null, start };
  slotCache.set(text, s);
  return s;
}

const dayCmp = (a: Value, b: Value) => {
  const ia = String(a).split(', ').map((d) => DAYS.indexOf(d));
  const ib = String(b).split(', ').map((d) => DAYS.indexOf(d));
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) if (ia[i] !== ib[i]) return ia[i] - ib[i];
  return ia.length - ib.length;
};

export const BANDS = ['Morning', 'Afternoon', 'Evening'];

/** Minutes after midnight as "08:15". */
export const fmtMinutes = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---- Registry

const cat = (id: string, label: string, get: (r: BrowseRow) => string | null, extra: Partial<Pick<Field, 'compare' | 'fmt' | 'noneLabel'>> = {}): Field => ({
  id, label, kind: 'category', unit: 'none', get, compare: extra.compare ?? strCmp, fmt: extra.fmt ?? plain, noneLabel: extra.noneLabel,
});
const num = (id: string, label: string, unit: FieldUnit, get: (r: BrowseRow) => number | null, fmt: (v: Value) => string): Field => ({
  id, label, kind: 'number', unit, get, compare: numCmp, fmt,
});

const fmtE = (v: Value) => (v as number).toFixed(2);
const fmtInt = (v: Value) => String(Math.round(v as number));
const taken = (r: BrowseRow) => (r.before === null || r.after === null ? null : r.before - r.after);

/** Term and window in one label: "2025-26 Term 1 \u00b7 Round 1 Window 1" is stored in full and shown as "2025-26 Term 1 \u00b7 R1 W1". */
const TW_SEP = ' \u00b7 ';
const termWindowCmp = (a: Value, b: Value) => {
  const [ta, wa = ''] = String(a).split(TW_SEP);
  const [tb, wb = ''] = String(b).split(TW_SEP);
  return natural(ta, tb) || windowRank(wa) - windowRank(wb) || natural(wa, wb);
};

export const FIELDS: Field[] = [
  cat('term', 'Term', (r) => r.term),
  cat('window', 'Window', (r) => r.window || null, { compare: (a, b) => windowRank(String(a)) - windowRank(String(b)) || strCmp(a, b), fmt: (v) => shortWindow(String(v)) }),
  cat('termWindow', 'Term \u00d7 window', (r) => (r.window ? `${r.term}${TW_SEP}${r.window}` : null), {
    compare: termWindowCmp,
    fmt: (v) => { const [t, w = ''] = String(v).split(TW_SEP); return `${t}${TW_SEP}${shortWindow(w)}`; },
  }),
  cat('course', 'Course', (r) => r.code),
  cat('section', 'Section', (r) => r.section || null),
  cat('instructor', 'Professor', (r) => r.instructor),
  cat('day', 'Day', (r) => parseSlot(r.slot).days, { compare: dayCmp, noneLabel: 'No time set' }),
  cat('band', 'Time of day', (r) => {
    const s = parseSlot(r.slot).start;
    return s === null ? null : band(fmtMinutes(s));
  }, { compare: (a, b) => BANDS.indexOf(String(a)) - BANDS.indexOf(String(b)), noneLabel: 'No time set' }),
  num('vacancy', 'Seats in section', 'seats', (r) => r.vacancy, fmtInt),
  num('before', 'Seats offered', 'seats', (r) => r.before, fmtInt),
  num('after', 'Seats left', 'seats', (r) => r.after, fmtInt),
  num('taken', 'Seats taken', 'seats', taken, fmtInt),
  num('fillPct', '% filled', '%', (r) => {
    const t = taken(r);
    return t === null || !r.before ? null : (t / r.before) * 100;
  }, (v) => `${Math.round(v as number)}%`),
  num('median', 'Median bid', 'e$', (r) => (r.medianCents === null ? null : r.medianCents / 100), fmtE),
  num('min', 'Lowest bid', 'e$', (r) => (r.minCents === null ? null : r.minCents / 100), fmtE),
];

export const FIELD_IDS: string[] = FIELDS.map((f) => f.id);
const BY_ID = new Map(FIELDS.map((f) => [f.id, f]));

export const fieldById = (id: string): Field | undefined => BY_ID.get(id);
export const isFieldId = (id: string): boolean => BY_ID.has(id);

/** "e$", "seats", "%" for the axis title; '' for none. */
export const unitLabel = (u: FieldUnit): string => (u === 'none' ? '' : u);

export function band(start: string): string {
  if (!start) return 'No time set';
  const h = Number(start.slice(0, 2));
  return h < 12 ? 'Morning' : h < 16 ? 'Afternoon' : 'Evening';
}
