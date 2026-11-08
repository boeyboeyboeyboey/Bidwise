import type { CourseData } from '../../lib/data/types';

/** Tidy row: one section in one past bidding window. Bids are null when nobody won. */
export interface Row {
  course: string;
  section: string;
  instructor: string;
  day: string;
  start: string;
  term: string;
  window: string;
  medianE: number | null;
  minE: number | null;
  seatsOffered: number;
  seatsLeft: number;
  filled: boolean;
}

export const ROW_COLUMNS: (keyof Row)[] = [
  'course', 'section', 'instructor', 'day', 'start', 'term', 'window',
  'medianE', 'minE', 'seatsOffered', 'seatsLeft', 'filled',
];

export function buildRows(courses: CourseData[]): Row[] {
  const out: Row[] = [];
  for (const c of courses) {
    for (const h of c.history) {
      out.push({
        course: c.code,
        section: h.section,
        instructor: h.instructor,
        day: h.days,
        start: h.start,
        term: h.term,
        window: h.window,
        medianE: h.medianCents === null ? null : h.medianCents / 100,
        minE: h.minCents === null ? null : h.minCents / 100,
        seatsOffered: h.vacancy,
        seatsLeft: h.after,
        filled: h.vacancy > 0 && h.after === 0,
      });
    }
  }
  return out;
}

/** Section codes seen in a course's history, in natural order (G2 before G10). */
export function sectionsOf(c: CourseData): string[] {
  return [...new Set(c.history.map((h) => h.section))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function band(start: string): string {
  if (!start) return 'No time set';
  const h = Number(start.slice(0, 2));
  return h < 12 ? 'Morning' : h < 16 ? 'Afternoon' : 'Evening';
}

function cell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(cols: string[], data: Record<string, unknown>[]): string {
  return [cols.join(','), ...data.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
