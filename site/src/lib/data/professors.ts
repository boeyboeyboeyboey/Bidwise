// Professor profiles, built from the course files at build time. Pure helpers first (testable), then the server loader.
import { dataMeta, getCourseIndex } from './index';
import { getCourse } from './server';
import { instructorKey, titleName } from './format';
import { sortTerms } from '../../components/course/history';
import { windowRank } from '../../components/explore/browse';
import type { HistoryRow, Meeting, Section, LiveSeats } from './types';

/** A section this term taught by the professor. */
export interface ProfSection {
  section: string;
  classNumber: string;
  meetings: Meeting[];
  live?: LiveSeats;
}

export interface ProfCourse {
  code: string;
  title: string;
  /** Terms with a row for this professor, newest first. The current term is included when the professor teaches it. */
  terms: string[];
  /** This term's sections taught by the professor. */
  nowSections: ProfSection[];
  /** Newest term with a median bid, earliest window in that term. Null when there is none. */
  latest: { term: string; window: string; medianCents: number | null; minCents: number | null } | null;
  /** Raw instructor string most often seen on this professor's rows, for /course/<code>/history/?i=. */
  historyQuery: string;
  /** True when every row of this professor in the course (history and this term's sections) has the same raw instructor string, so /history/?i=historyQuery shows all of them. */
  historyComplete: boolean;
}

export interface Professor {
  key: string;
  /** titleName of the most common raw spelling. */
  name: string;
  slug: string;
  teachingNow: boolean;
  lastTerm: string;
  /** Teaching-now courses first, then by newest term. */
  courses: ProfCourse[];
  /** Past terms with at least one row, newest first, without the current term. Sections sorted by course code, then section. */
  pastTerms: ProfPastTerm[];
}

/** First priced regular window of one section in one past term (Incoming rounds only when nothing else is priced). */
export interface ProfSectionBid { window: string; medianCents: number | null; minCents: number | null }

/** One section of a course in a past term. Title and historyQuery live on the matching ProfCourse (look up by code). */
export interface ProfPastSection {
  code: string;
  section: string;
  /** Raw history-row meeting fields ("MON; THU", "08:15; 08:15"), for formatSlot. */
  days: string;
  start: string;
  end: string;
  bid: ProfSectionBid | null;
}

export interface ProfPastTerm { term: string; sections: ProfPastSection[] }

/** One course as the builder reads it: the course JSON's fields, with only the ones used here. */
export interface ProfCourseInput {
  code: string;
  title: string;
  sectionsNow: Pick<Section, 'section' | 'classNumber' | 'meetings' | 'live' | 'instructor'>[];
  history: (Pick<HistoryRow, 'term' | 'window' | 'instructor' | 'medianCents' | 'minCents'> & Partial<Pick<HistoryRow, 'section' | 'days' | 'start' | 'end'>>)[];
}

/** Compact row for client-side search: [name, slug, courseCount, teachingNow 1|0]. */
export type ProfSearchEntry = [string, string, number, 0 | 1];

export { mergeCommaParts, profKey, profSlug, splitInstructors } from './profNames';
import { profKey, profSlug, splitInstructors } from './profNames';

/** One slug per key. Keys are visited in sorted order; a clash gets "-2", "-3", ... */
export function assignSlugs(keys: Iterable<string>): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const key of [...new Set(keys)].sort()) {
    const base = profSlug(key) || 'prof';
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    out.set(key, slug);
  }
  return out;
}

const bump = (m: Map<string, number>, s: string) => m.set(s, (m.get(s) ?? 0) + 1);

/** Most common key; ties go to the alphabetically first. */
function mostCommon(m: Map<string, number>): string {
  let best = '';
  let bestN = -1;
  for (const [s, n] of m) if (n > bestN || (n === bestN && s < best)) { best = s; bestN = n; }
  return best;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

const isIncoming = (window: string): boolean => /^incoming\b/i.test(window.trim());
const byWindow = (a: string, b: string): number => windowRank(a) - windowRank(b) || a.localeCompare(b);

/** Earliest regular window with a median, else the earliest Incoming one; null when no row has a median. Rows of one window are combined. */
export function sectionBid(rows: readonly Pick<ProfCourseInput['history'][number], 'window' | 'medianCents' | 'minCents'>[]): ProfSectionBid | null {
  const priced = rows.filter((r) => r.medianCents !== null);
  const regular = priced.filter((r) => !isIncoming(r.window));
  const pool = regular.length ? regular : priced;
  if (!pool.length) return null;
  const window = pool.map((r) => r.window).sort(byWindow)[0];
  const same = pool.filter((r) => r.window === window);
  const mins = same.map((r) => r.minCents).filter((x): x is number => x !== null);
  return { window, medianCents: median(same.map((r) => r.medianCents as number)), minCents: mins.length ? Math.min(...mins) : null };
}

const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true });

/** Groups one professor's history rows into past terms (newest first), one entry per course, section and term. */
export function buildPastTerms(rows: readonly { code: string; row: ProfCourseInput['history'][number] }[], currentTerm?: string): ProfPastTerm[] {
  const byTerm = new Map<string, Map<string, { code: string; rows: ProfCourseInput['history'] }>>();
  for (const { code, row } of rows) {
    if (row.term === currentTerm) continue;
    let secs = byTerm.get(row.term);
    if (!secs) byTerm.set(row.term, (secs = new Map()));
    const key = `${code}\u0000${row.section ?? ''}`;
    let g = secs.get(key);
    if (!g) secs.set(key, (g = { code, rows: [] }));
    g.rows.push(row);
  }
  return sortTerms([...byTerm.keys()]).reverse().map((term) => ({
    term,
    sections: [...byTerm.get(term)!.values()]
      .map((g): ProfPastSection => {
        const first = g.rows[0];
        return { code: g.code, section: first.section ?? '', days: first.days ?? '', start: first.start ?? '', end: first.end ?? '', bid: sectionBid(g.rows) };
      })
      .sort((a, b) => a.code.localeCompare(b.code) || natural(a.section, b.section)),
  }));
}

interface CourseAcc {
  code: string;
  title: string;
  terms: Set<string>;
  now: ProfSection[];
  rows: ProfCourseInput['history'];
  /** Raw whole-field spellings seen on this professor's rows here. */
  queries: Map<string, number>;
}

interface ProfAcc {
  spellings: Map<string, number>;
  courses: Map<string, CourseAcc>;
}

/** Pure: builds every professor from the course rows. Pass the current term so teaching-now terms count. */
export function buildProfessors(courses: readonly ProfCourseInput[], currentTerm?: string): Professor[] {
  const byKey = new Map<string, ProfAcc>();

  const accFor = (name: string, code: string, title: string): CourseAcc => {
    const key = profKey(name);
    let p = byKey.get(key);
    if (!p) byKey.set(key, (p = { spellings: new Map(), courses: new Map() }));
    bump(p.spellings, name);
    let c = p.courses.get(code);
    if (!c) p.courses.set(code, (c = { code, title, terms: new Set(), now: [], rows: [], queries: new Map() }));
    return c;
  };

  for (const course of courses) {
    for (const sec of course.sectionsNow) {
      for (const name of splitInstructors(sec.instructor)) {
        const c = accFor(name, course.code, course.title);
        c.now.push({ section: sec.section, classNumber: sec.classNumber, meetings: sec.meetings, live: sec.live });
        if (currentTerm) c.terms.add(currentTerm);
        bump(c.queries, sec.instructor);
      }
    }
    for (const row of course.history) {
      if (!row.instructor) continue;
      for (const name of splitInstructors(row.instructor)) {
        const c = accFor(name, course.code, course.title);
        c.terms.add(row.term);
        c.rows.push(row);
        bump(c.queries, row.instructor);
      }
    }
  }

  const built = [...byKey].map(([key, p]) => {
    const courseList: ProfCourse[] = [...p.courses.values()].map((c) => {
      const terms = sortTerms(c.terms).reverse();
      const priced = c.rows.filter((r) => r.medianCents !== null);
      // Incoming Exchange/Freshmen rounds are for special groups; use them only when no regular round has a price.
      const regular = priced.filter((r) => !/^incoming\b/i.test(r.window.trim()));
      const withMedian = regular.length ? regular : priced;
      let latest: ProfCourse['latest'] = null;
      if (withMedian.length) {
        const term = sortTerms(withMedian.map((r) => r.term)).pop()!;
        const inTerm = withMedian.filter((r) => r.term === term);
        const window = [...inTerm].map((r) => r.window).sort((a, b) => windowRank(a) - windowRank(b) || a.localeCompare(b))[0];
        const rows = inTerm.filter((r) => r.window === window);
        const mins = rows.map((r) => r.minCents).filter((x): x is number => x !== null);
        latest = {
          term,
          window,
          medianCents: median(rows.map((r) => r.medianCents as number)),
          minCents: mins.length ? Math.min(...mins) : null,
        };
      }
      return {
        code: c.code,
        title: c.title,
        terms,
        nowSections: c.now,
        latest,
        historyQuery: mostCommon(c.queries),
        historyComplete: new Set([...c.queries.keys()].map(instructorKey)).size <= 1,
      };
    });
    courseList.sort((a, b) => Number(b.nowSections.length > 0) - Number(a.nowSections.length > 0)
      || (b.terms[0] ?? '').localeCompare(a.terms[0] ?? '') || a.code.localeCompare(b.code));
    const teachingNow = courseList.some((c) => c.nowSections.length > 0);
    const lastTerm = courseList.map((c) => c.terms[0] ?? '').sort().pop() ?? '';
    const pastTerms = buildPastTerms([...p.courses.values()].flatMap((c) => c.rows.map((row) => ({ code: c.code, row }))), currentTerm);
    return { key, name: titleName(mostCommon(p.spellings)), teachingNow, lastTerm, courses: courseList, pastTerms };
  });

  const slugs = assignSlugs(built.map((p) => p.key));
  return built
    .map((p): Professor => ({ ...p, slug: slugs.get(p.key)! }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

let cache: Professor[] | null = null;

/** Server-only. Reads every course file once per build and memoises the result. */
export function getProfessors(): Professor[] {
  if (!cache) {
    const courses: ProfCourseInput[] = [];
    for (const c of getCourseIndex()) {
      const d = getCourse(c.code);
      if (!d) continue;
      courses.push({
        code: d.code,
        title: d.title,
        sectionsNow: d.sectionsNow.map((s) => ({
          section: s.section, classNumber: s.classNumber, meetings: s.meetings, live: s.live, instructor: s.instructor,
        })),
        history: d.history.map((r) => ({
          term: r.term, window: r.window, instructor: r.instructor, medianCents: r.medianCents, minCents: r.minCents,
          section: r.section, days: r.days, start: r.start, end: r.end,
        })),
      });
    }
    cache = buildProfessors(courses, dataMeta.currentTerm);
  }
  return cache;
}

export function getProfessorBySlug(slug: string): Professor | undefined {
  return getProfessors().find((p) => p.slug === slug);
}

/** Compact list for client search: [name, slug, courseCount, teachingNow ? 1 : 0]. */
export function profSearchEntries(): ProfSearchEntry[] {
  return getProfessors().map((p): ProfSearchEntry => [p.name, p.slug, p.courses.length, p.teachingNow ? 1 : 0]);
}
