// Browse: courses with this term's sections, filters, term list per course and URL state. Pure and DOM-free, so it is unit tested (courses.test.ts).
// Course status ("Biddable", "Completed/Enrolled") describes the scanning student and is never part of any of this.
import { DAYS, DAY_IDS, R, bitsToIds, idsToBits, subjectOf, type ClassRow } from '../classes/logic';

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
  /** Chosen meeting start times ("08:15", sorted); empty for any time. */
  times: string[];
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

export const browseDefaults = (): BrowseState => ({ q: '', sub: '', days: 0, times: [], seats: false, nofinal: false, course: '', term: '', sec: '' });

/** Day, time, seats and exam filters describe sections of this term, so they hide courses with no section this term. */
export const sectionFilterOn = (f: Pick<BrowseState, 'days' | 'times' | 'seats' | 'nofinal'>): boolean => !!(f.days || f.times.length || f.seats || f.nofinal);

/** Number of filters set, for the Filters button (search text not counted). */
export const activeFilterCount = (f: Pick<BrowseState, 'sub' | 'days' | 'times' | 'seats' | 'nofinal'>): number =>
  (f.sub ? 1 : 0) + (f.days ? 1 : 0) + (f.times.length ? 1 : 0) + (f.seats ? 1 : 0) + (f.nofinal ? 1 : 0);

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
    && (!f.times.length || r[R.times].some((t) => f.times.includes(t)))
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

/** Instructors under a course title: the first `max`, then "+N more". */
export function instructorLine(professors: readonly string[], max = 4): string {
  const rest = professors.length - max;
  return rest > 0 ? `${professors.slice(0, max).join(' · ')} · +${rest} more` : professors.join(' · ');
}

/** Day choices for the Day filter: the weekdays (Mon first) that some section meets on, so Saturday shows only when the data has it. Days already chosen in `selected` stay listed so a link's filter can always be cleared. */
export function dayOptions(courses: readonly CourseEntry[], selected = 0): { bit: number; label: string }[] {
  let seen = selected;
  for (const c of courses) for (const r of c.sections) seen |= r[R.days];
  return DAYS.map((label, i) => ({ bit: 1 << i, label })).filter((o) => seen & o.bit);
}

/** Start-time choices for the Start time filter: the distinct meeting start times this term's sections have, sorted. Times already chosen in `selected` stay listed so a link's filter can always be cleared. */
export function timeOptions(courses: readonly CourseEntry[], selected: readonly string[] = []): string[] {
  const seen = new Set(selected);
  for (const c of courses) for (const r of c.sections) for (const t of r[R.times]) seen.add(t);
  return [...seen].sort();
}

/** Bit mask (bit i = options[i]) for the chosen times, and back; the MultiSelect works on masks. */
export const timesToMask = (options: readonly string[], times: readonly string[]): number =>
  options.reduce((m, t, i) => (times.includes(t) ? m | (1 << i) : m), 0);
export const maskToTimes = (options: readonly string[], mask: number): string[] => options.filter((_, i) => mask & (1 << i));

/** "time=0815,1200" as ["08:15", "12:00"]; anything that is not a four-digit time (old morning/afternoon/evening values) is ignored. */
export function decodeTimes(s: string | null): string[] {
  const out = new Set<string>();
  for (const p of (s ?? '').split(',')) {
    const m = /^([01]\d|2[0-3])([0-5]\d)$/.exec(p.trim());
    if (m) out.add(`${m[1]}:${m[2]}`);
  }
  return [...out].sort();
}
const encodeTimes = (times: readonly string[]): string => times.map((t) => t.replace(':', '')).join(',');

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
  if (st.times.length) p.set('time', encodeTimes([...st.times].sort()));
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
    times: decodeTimes(p.get('time')),
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
    times: decodeTimes(p.get('time')),
    seats: p.get('seats') === '1',
    nofinal: p.get('exam') === 'none',
  });
}
