// This term's section rows for Browse (built at build time) with their day, time and seat helpers. Pure, so it is unit tested (logic.test.ts).
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
  /** The current term, e.g. "2026-27 Term 2". */
  term: string;
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

/** Short seat text: "12 left", "Full", "~3 left" (estimate), "Likely full". */
export function seatText(r: ClassRow): string {
  const approx = r[R.approx] === 1;
  if (r[R.left] <= 0) return approx ? 'Likely full' : 'Full';
  return `${approx ? '~' : ''}${r[R.left]} left`;
}

export const bitsToIds = (mask: number, ids: readonly { id: string; bit: number }[]) => ids.filter((x) => mask & x.bit).map((x) => x.id).join(',');
export const idsToBits = (s: string | null, ids: readonly { id: string; bit: number }[]) =>
  (s ?? '').split(',').reduce((m, p) => m | (ids.find((x) => x.id === p.trim().toLowerCase())?.bit ?? 0), 0);

export const DAY_IDS = DAYS.map((d, i) => ({ id: d.toLowerCase(), bit: 1 << i }));
