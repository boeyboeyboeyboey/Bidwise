// Class search: row building (build time) and filter / sort / URL state (browser). Pure, so it is unit tested (logic.test.ts).
// Course status ("Biddable", "Completed/Enrolled") describes the scanning student and is never part of a row.
import { formatSlot } from '../../lib/format/slot';
import { formatExam, type ExamSlot } from '../../lib/format/exam';
import { seatsOf, type SeatInput } from '../../lib/data/seats';
import type { Meeting } from '../../lib/data/types';

/** [code, title, section, instructor, day/time text, seats left, seats total, approx 0|1, day mask, time-of-day mask, exam text ("Thu 29 Apr, 13:00", '' = none listed)]. */
export type ClassRow = [
  code: string, title: string, section: string, instructor: string, slot: string,
  left: number, total: number, approx: 0 | 1, days: number, times: number, exam: string,
];
export const R = { code: 0, title: 1, section: 2, instructor: 3, slot: 4, left: 5, total: 6, approx: 7, days: 8, times: 9, exam: 10 } as const;

export interface ClassesPayload {
  /** ISO time of the newest live seat scan, or null. */
  scannedAt: string | null;
  rows: ClassRow[];
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
/** Time of day by meeting start: morning before 12:00, afternoon 12:00 to 17:59, evening 18:00 on. */
export const TIMES = [
  { id: 'm', label: 'Morning', bit: 1 },
  { id: 'a', label: 'Afternoon', bit: 2 },
  { id: 'e', label: 'Evening', bit: 4 },
] as const;

export const subjectOf = (code: string): string => code.replace(/\d.*$/, '');

const timeBit = (start: string | null | undefined): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec((start ?? '').trim());
  if (!m) return 0;
  const h = +m[1];
  return h < 12 ? 1 : h < 18 ? 2 : 4;
};

const dayBit = (day: string | null | undefined): number => {
  const i = DAYS.findIndex((d) => d.toLowerCase() === (day ?? '').trim().slice(0, 3).toLowerCase());
  return i < 0 ? 0 : 1 << i;
};

const sectionCmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

interface CourseLike {
  code: string;
  title: string;
  sectionsNow: (SeatInput & { section: string; instructor: string; exam?: ExamSlot | null; meetings: Pick<Meeting, 'day' | 'start' | 'end'>[] })[];
}

/** One compact row per section offered this term, in code then section order. */
export function buildRows(courses: readonly CourseLike[]): ClassRow[] {
  const rows: ClassRow[] = [];
  for (const c of courses) {
    for (const s of c.sectionsNow) {
      const seats = seatsOf(s);
      let days = 0, times = 0;
      for (const m of s.meetings) { days |= dayBit(m.day); times |= dayBit(m.day) ? timeBit(m.start) : 0; }
      rows.push([
        c.code, c.title, s.section, (s.instructor ?? '').trim(), formatSlot(s.meetings),
        Math.max(0, seats.left), seats.total, seats.source === 'approx' ? 1 : 0, days, times, formatExam(s.exam),
      ]);
    }
  }
  return rows.sort((a, b) => a[R.code].localeCompare(b[R.code]) || sectionCmp(a[R.section], b[R.section]));
}

export type SortKey = 'code' | 'seats';
export type ExamFilter = 'any' | 'has' | 'none';

export interface Filters {
  q: string;
  /** Code prefix such as "ECON" or "COR-LAW"; '' for all. */
  subject: string;
  /** Day mask (bit 0 = Mon); 0 for any day. */
  days: number;
  /** Time-of-day mask (TIMES bits); 0 for any time. */
  times: number;
  hasSeats: boolean;
  /** Final exam: any section, only those with an exam listed, or only those without. */
  exam: ExamFilter;
  sort: SortKey;
}

export const NO_FILTERS: Filters = { q: '', subject: '', days: 0, times: 0, hasSeats: false, exam: 'any', sort: 'code' };

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every word must appear in the code, title or professor. "econ 111" and "econ111" both find ECON111. */
export function matchesQuery(r: ClassRow, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${r[R.code]} ${r[R.title]} ${r[R.instructor]}`.toLowerCase();
  const hayFlat = flat(hay);
  return words.every((w) => hay.includes(w) || (flat(w) !== '' && hayFlat.includes(flat(w))));
}

export function filterRows(rows: readonly ClassRow[], f: Filters): ClassRow[] {
  const out = rows.filter((r) =>
    (!f.subject || subjectOf(r[R.code]) === f.subject) &&
    (!f.days || (r[R.days] & f.days) !== 0) &&
    (!f.times || (r[R.times] & f.times) !== 0) &&
    (!f.hasSeats || r[R.left] > 0) &&
    (f.exam === 'any' || (f.exam === 'has') === (r[R.exam] !== '')) &&
    matchesQuery(r, f.q));
  // Array.prototype.sort is stable, so the seat sort keeps code order inside equal seat counts.
  if (f.sort === 'seats') out.sort((a, b) => b[R.left] - a[R.left]);
  return out;
}

/** Subjects present in the rows, sorted. */
export function subjectsOf(rows: readonly ClassRow[]): string[] {
  return [...new Set(rows.map((r) => subjectOf(r[R.code])))].sort();
}

/** Short seat text: "12 left", "Full", "~3 left" (estimate), "Likely full". */
export function seatText(r: ClassRow): string {
  const approx = r[R.approx] === 1;
  if (r[R.left] <= 0) return approx ? 'Likely full' : 'Full';
  return `${approx ? '~' : ''}${r[R.left]} left`;
}

const bitsToIds = (mask: number, ids: readonly { id: string; bit: number }[]) => ids.filter((x) => mask & x.bit).map((x) => x.id).join(',');
const idsToBits = (s: string | null, ids: readonly { id: string; bit: number }[]) =>
  (s ?? '').split(',').reduce((m, p) => m | (ids.find((x) => x.id === p.trim().toLowerCase())?.bit ?? 0), 0);

const DAY_IDS = DAYS.map((d, i) => ({ id: d.toLowerCase(), bit: 1 << i }));

/** Filters as a query string without the leading "?"; defaults are left out. */
export function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.subject) p.set('sub', f.subject);
  if (f.days) p.set('day', bitsToIds(f.days, DAY_IDS));
  if (f.times) p.set('time', bitsToIds(f.times, TIMES));
  if (f.hasSeats) p.set('seats', '1');
  if (f.exam !== 'any') p.set('exam', f.exam);
  if (f.sort !== 'code') p.set('sort', f.sort);
  return p.toString().replace(/%2C/g, ',');
}

export function filtersFromQuery(search: string): Filters {
  const p = new URLSearchParams(search);
  return {
    q: p.get('q') ?? '',
    subject: p.get('sub') ?? '',
    days: idsToBits(p.get('day'), DAY_IDS),
    times: idsToBits(p.get('time'), TIMES),
    hasSeats: p.get('seats') === '1',
    exam: p.get('exam') === 'has' || p.get('exam') === 'none' ? (p.get('exam') as ExamFilter) : 'any',
    sort: p.get('sort') === 'seats' ? 'seats' : 'code',
  };
}

/** Number of non-default filters, for the Filters button (search text and sort not counted). */
export function activeFilterCount(f: Filters): number {
  return (f.subject ? 1 : 0) + (f.days ? 1 : 0) + (f.times ? 1 : 0) + (f.hasSeats ? 1 : 0) + (f.exam !== 'any' ? 1 : 0);
}
