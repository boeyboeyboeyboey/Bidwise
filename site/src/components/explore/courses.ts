// Browse: courses with this term's sections, filters, term list per course and URL state. Pure and DOM-free, so it is unit tested (courses.test.ts).
// Course status ("Biddable", "Completed/Enrolled") describes the scanning student and is never part of any of this.
import { DAY_IDS, R, TIMES, bitsToIds, idsToBits, subjectOf, type ClassRow } from '../classes/logic';

export interface CourseEntry {
  code: string;
  title: string;
  subject: string;
  /** This term's sections, in section order; empty for a course with past terms only. */
  sections: ClassRow[];
  /** Instructors of this term's sections, each once. */
  professors: string[];
}

/** Every course in `index`, plus any course that only the section rows know, ordered by code. Titles come from the index; a missing title stays ''. */
export function groupCourses(rows: readonly ClassRow[], index: readonly { code: string; title: string }[]): CourseEntry[] {
  const by = new Map<string, CourseEntry>();
  const entry = (code: string, title: string): CourseEntry => {
    let e = by.get(code);
    if (!e) by.set(code, (e = { code, title, subject: subjectOf(code), sections: [], professors: [] }));
    return e;
  };
  for (const c of index) entry(c.code, c.title);
  for (const r of rows) {
    const e = entry(r[R.code], r[R.title]);
    if (!e.title) e.title = r[R.title];
    e.sections.push(r);
    const p = r[R.instructor].trim();
    if (p && !e.professors.includes(p)) e.professors.push(p);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export interface BrowseState {
  q: string;
  /** Code prefix such as "ECON" or "COR-LAW"; '' for all. */
  sub: string;
  /** Day mask (bit 0 = Mon); 0 for any day. */
  days: number;
  /** Time-of-day mask (TIMES bits); 0 for any time. */
  times: number;
  seats: boolean;
  /** Only sections with no final exam listed. */
  nofinal: boolean;
  /** Open course code, '' for the list. */
  course: string;
  /** Term label of the open course; '' for its first term (this term when it has sections). */
  term: string;
  /** Expanded section of the open course. */
  sec: string;
}

export const browseDefaults = (): BrowseState => ({ q: '', sub: '', days: 0, times: 0, seats: false, nofinal: false, course: '', term: '', sec: '' });

/** Day, time, seats and exam filters describe sections of this term, so they hide courses with no section this term. */
export const sectionFilterOn = (f: Pick<BrowseState, 'days' | 'times' | 'seats' | 'nofinal'>): boolean => !!(f.days || f.times || f.seats || f.nofinal);

/** Number of filters set, for the Filters button (search text not counted). */
export const activeFilterCount = (f: Pick<BrowseState, 'sub' | 'days' | 'times' | 'seats' | 'nofinal'>): number =>
  (f.sub ? 1 : 0) + (f.days ? 1 : 0) + (f.times ? 1 : 0) + (f.seats ? 1 : 0) + (f.nofinal ? 1 : 0);

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Every word of `q` must appear in `hay`. "econ 111" and "econ111" both find ECON111. */
export function matchesWords(hay: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = hay.toLowerCase();
  const hf = flat(h);
  return words.every((w) => h.includes(w) || (flat(w) !== '' && hf.includes(flat(w))));
}

export function sectionMatches(r: ClassRow, f: Pick<BrowseState, 'days' | 'times' | 'seats' | 'nofinal'>): boolean {
  return (!f.days || (r[R.days] & f.days) !== 0)
    && (!f.times || (r[R.times] & f.times) !== 0)
    && (!f.seats || r[R.left] > 0)
    && (!f.nofinal || r[R.exam] === '');
}

export interface CourseHit {
  course: CourseEntry;
  /** This term's sections that pass the section filters (all of them when none is set). */
  sections: ClassRow[];
}

/** Courses matching the search text (code, title or a professor of this term) and subject, with at least one section passing the section filters when any is set. Courses whose code starts with the text come first. */
export function filterCourses(courses: readonly CourseEntry[], f: BrowseState): CourseHit[] {
  const on = sectionFilterOn(f);
  const hits: CourseHit[] = [];
  for (const c of courses) {
    if (f.sub && c.subject !== f.sub) continue;
    if (!matchesWords(`${c.code} ${c.title} ${c.professors.join(' ')}`, f.q)) continue;
    const sections = on ? c.sections.filter((r) => sectionMatches(r, f)) : c.sections;
    if (on && !sections.length) continue;
    hits.push({ course: c, sections });
  }
  const q = flat(f.q);
  if (q) {
    const rank = (h: CourseHit) => (flat(h.course.code).startsWith(q) ? 0 : 1);
    return hits.map((h, i) => [h, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
  }
  return hits;
}

/** Subjects among the courses, sorted. */
export const subjectsOf = (courses: readonly CourseEntry[]): string[] => [...new Set(courses.map((c) => c.subject))].sort();

// ---- Terms of one course

export interface TermChoice {
  term: string;
  /** This term's sections (live data) rather than past bid results. */
  now: boolean;
}

/**
 * The terms to offer for a course: this term first when it has sections, then the terms with bid rows, newest first.
 * `withData` may be in any order and may include this term, which is then listed once.
 */
export function termChoices(currentTerm: string, hasNow: boolean, withData: readonly string[]): TermChoice[] {
  const past = [...new Set(withData)].filter((t) => !(hasNow && t === currentTerm)).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return [...(hasNow ? [{ term: currentTerm, now: true }] : []), ...past.map((term) => ({ term, now: false }))];
}

/** "2025-26 Term 2" as "2025-26 T2" for a chip; other labels as they are. */
export const shortTerm = (t: string): string => t.replace(/ Term /, ' T');

// ---- URL state (the query string of /explore/)

export function encodeBrowse(st: BrowseState): string {
  const p = new URLSearchParams();
  if (st.q.trim()) p.set('q', st.q.trim());
  if (st.sub) p.set('sub', st.sub);
  if (st.days) p.set('day', bitsToIds(st.days, DAY_IDS));
  if (st.times) p.set('time', bitsToIds(st.times, TIMES));
  if (st.seats) p.set('seats', '1');
  if (st.nofinal) p.set('nofinal', '1');
  if (st.course) {
    p.set('course', st.course);
    if (st.term) p.set('term', st.term);
    if (st.sec) p.set('sec', st.sec);
  }
  return p.toString().replace(/%2C/g, ',');
}

export function decodeBrowse(search: string): BrowseState {
  const p = new URLSearchParams(search);
  const course = (p.get('course') ?? '').trim().toUpperCase();
  return {
    // Old Browse-all-sections links named a course text (bq) or a professor (bi); both are plain search text now.
    q: p.get('q') ?? p.get('bq') ?? p.get('bi') ?? '',
    sub: p.get('sub') ?? '',
    days: idsToBits(p.get('day'), DAY_IDS),
    times: idsToBits(p.get('time'), TIMES),
    seats: p.get('seats') === '1',
    nofinal: p.get('nofinal') === '1',
    course,
    term: course ? (p.get('term') ?? '') : '',
    sec: course ? (p.get('sec') ?? '') : '',
  };
}

/** The Build a chart tab opens for v=build, a chart spec (kv) or the old Compare link (c); everything else, including the old v=browse, is Browse. */
export function exploreMode(search: string): 'browse' | 'build' {
  const p = new URLSearchParams(search);
  return p.get('v') === 'build' || p.has('kv') || (p.get('v') === null && p.has('c')) ? 'build' : 'browse';
}

/**
 * The old /classes/ query as a Browse query. q, sub, day, time and seats carry over; exam=none becomes nofinal=1.
 * exam=has and sort have no Browse equivalent and are dropped.
 */
export function classesQueryToBrowse(search: string): string {
  const p = new URLSearchParams(search);
  return encodeBrowse({
    ...browseDefaults(),
    q: p.get('q') ?? '',
    sub: p.get('sub') ?? '',
    days: idsToBits(p.get('day'), DAY_IDS),
    times: idsToBits(p.get('time'), TIMES),
    seats: p.get('seats') === '1',
    nofinal: p.get('exam') === 'none',
  });
}
