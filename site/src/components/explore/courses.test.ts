import { describe, expect, it } from 'vitest';
import { buildRows, R } from '../classes/logic';
import {
  activeFilterCount, browseDefaults, classesQueryToBrowse, dayOptions, decodeBrowse, instructorLine, encodeBrowse, maskToTimes, timeOptions, timesToMask, exploreMode, filterCourses, groupCourses, shortTerm, subjectsOf, termChoices,
  type BrowseState, type CourseEntry,
} from './courses';

const sec = (section: string, over: Record<string, unknown> = {}) => ({
  section, instructor: 'ANN LEE', seatsLeft: 3, seatsTotal: 40,
  meetings: [{ day: 'MON', start: '09:00', end: '12:15' }], ...over,
});
const now = [
  { code: 'ECON111', title: 'Microeconomics', sectionsNow: [sec('G10'), sec('G2', { meetings: [{ day: 'THU', start: '12:00', end: '15:15' }], seatsLeft: 0, instructor: 'CY WONG', exam: { date: '2027-04-29', start: '13:00', end: '15:00' } })] },
  { code: 'COR-LAW2243', title: 'Business Law', sectionsNow: [sec('G1', { exam: { date: '2027-05-03', start: '09:00', end: null }, instructor: 'BOB TAN', meetings: [{ day: 'TUE', start: '18:30', end: '21:45' }, { day: 'FRI', start: '09:00', end: '10:00' }], live: { available: 7, total: 30, source: 'approx', capturedAt: '', window: '' } })] },
  { code: 'ACCT101', title: 'Accounting', sectionsNow: [sec('G1', { meetings: [{ day: 'TBA', start: null, end: null }] })] },
];
const index = [
  { code: 'ZZZ900', title: 'Old Seminar' },
  { code: 'ECON111', title: 'Microeconomics' },
  { code: 'ACCT101', title: 'Accounting' },
  { code: 'COR-LAW2243', title: 'Business Law' },
  { code: 'IS214', title: '' },
];
const courses = groupCourses(buildRows(now), index);
const codes = (c: CourseEntry[] | { course: CourseEntry }[]) => c.map((x) => ('course' in x ? x.course : x).code);
const f = (o: Partial<BrowseState>) => filterCourses(courses, { ...browseDefaults(), ...o });

describe('groupCourses', () => {
  it('makes one course per code, ordered by code, with past-only courses included', () => {
    expect(codes(courses)).toEqual(['ACCT101', 'COR-LAW2243', 'ECON111', 'IS214', 'ZZZ900']);
  });
  it('collects this term\'s sections in order and each professor once', () => {
    const e = courses.find((c) => c.code === 'ECON111')!;
    expect(e.sections.map((r) => r[R.section])).toEqual(['G2', 'G10']);
    expect(e.professors).toEqual(['CY WONG', 'ANN LEE']);
    expect(e.subject).toBe('ECON');
  });
  it('gives past-only courses no sections, and a missing title stays empty', () => {
    expect(courses.find((c) => c.code === 'ZZZ900')).toMatchObject({ sections: [], professors: [], title: 'Old Seminar' });
    expect(courses.find((c) => c.code === 'IS214')!.title).toBe('');
  });
  it('keeps a course that only the section rows know, titled from the row', () => {
    const c = groupCourses(buildRows(now), []);
    expect(c.find((x) => x.code === 'ECON111')!.title).toBe('Microeconomics');
  });
});

describe('filterCourses', () => {
  it('searches code, title and professor, with or without separators', () => {
    expect(codes(f({ q: 'econ 111' }))).toEqual(['ECON111']);
    expect(codes(f({ q: 'econ111' }))).toEqual(['ECON111']);
    expect(codes(f({ q: 'bob' }))).toEqual(['COR-LAW2243']);
    expect(codes(f({ q: 'business law' }))).toEqual(['COR-LAW2243']);
    expect(codes(f({ q: 'old seminar' }))).toEqual(['ZZZ900']);
    expect(f({ q: 'zzz999' })).toEqual([]);
  });
  it('puts courses whose code starts with the text first', () => {
    const extra = groupCourses([], [{ code: 'IS2140', title: '' }, { code: 'COR-IS214', title: 'x' }, { code: 'IS214', title: 'Y' }]);
    expect(codes(filterCourses(extra, { ...browseDefaults(), q: 'IS214' }))).toEqual(['IS214', 'IS2140', 'COR-IS214']);
  });
  it('filters by subject', () => {
    expect(codes(f({ sub: 'COR-LAW' }))).toEqual(['COR-LAW2243']);
    expect(subjectsOf(courses)).toEqual(['ACCT', 'COR-LAW', 'ECON', 'IS', 'ZZZ']);
  });
  it('day and time filters keep courses with a matching section this term and drop past-only courses', () => {
    expect(codes(f({ days: 0b00010 }))).toEqual(['COR-LAW2243']);
    expect(codes(f({ days: 0b01000 }))).toEqual(['ECON111']);
    expect(codes(f({ times: ['18:30'] }))).toEqual(['COR-LAW2243']);
    expect(codes(f({ times: ['09:00'] }))).toEqual(['COR-LAW2243', 'ECON111']);
    expect(codes(f({ times: ['12:00', '18:30'] }))).toEqual(['COR-LAW2243', 'ECON111']);
    expect(codes(f({ times: ['07:00'] }))).toEqual([]);
  });
  it('lists only the sections that pass the filters', () => {
    const [h] = f({ days: 0b01000 });
    expect(h.sections.map((r) => r[R.section])).toEqual(['G2']);
    expect(f({}).find((x) => x.course.code === 'ECON111')!.sections).toHaveLength(2);
  });
  it('has seats left drops courses whose sections are all full', () => {
    expect(codes(f({ seats: true }))).toEqual(['ACCT101', 'COR-LAW2243', 'ECON111']);
    expect(codes(f({ seats: true, days: 0b01000 }))).toEqual([]);
  });
  it('no final exam listed keeps sections with no exam, so a course with one exam-free section stays', () => {
    const hits = f({ nofinal: true });
    expect(codes(hits)).toEqual(['ACCT101', 'ECON111']);
    expect(hits[1].sections.map((r) => r[R.section])).toEqual(['G10']);
    expect(codes(f({ nofinal: true, seats: true, days: 0b01000 }))).toEqual([]);
  });
  it('combines text, subject and section filters with AND', () => {
    expect(codes(f({ q: 'ann', sub: 'ECON', nofinal: true }))).toEqual(['ECON111']);
    expect(codes(f({ q: 'bob', nofinal: true }))).toEqual([]);
  });
});

describe('instructorLine', () => {
  it('lists up to four instructors, then counts the rest', () => {
    expect(instructorLine([])).toBe('');
    expect(instructorLine(['A', 'B', 'C', 'D'])).toBe('A · B · C · D');
    expect(instructorLine(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A · B · C · D · +2 more');
  });
});

describe('timeOptions', () => {
  it('lists the distinct start times of this term\'s sections, sorted, with none for TBA', () => {
    expect(timeOptions(courses)).toEqual(['09:00', '12:00', '18:30']);
  });
  it('keeps a chosen time that no section has, so a link\'s filter can be cleared', () => {
    expect(timeOptions(courses, ['07:00', '12:00'])).toEqual(['07:00', '09:00', '12:00', '18:30']);
  });
  it('converts between times and the menu\'s bit mask', () => {
    const opts = timeOptions(courses);
    expect(timesToMask(opts, ['09:00', '18:30', '07:00'])).toBe(0b101);
    expect(maskToTimes(opts, 0b110)).toEqual(['12:00', '18:30']);
  });
});

describe('dayOptions', () => {
  it('lists only the days with sections, Mon first, ignoring TBA', () => {
    expect(dayOptions(courses).map((o) => o.label)).toEqual(['Mon', 'Tue', 'Thu', 'Fri']);
    expect(dayOptions(courses).map((o) => o.bit)).toEqual([1, 2, 8, 16]);
  });
  it('adds Saturday only when a section has it, and keeps already chosen days', () => {
    const sat = groupCourses(buildRows([{ code: 'X1', title: 'X', sectionsNow: [sec('G1', { meetings: [{ day: 'SAT', start: '09:00', end: '12:00' }] })] }]), []);
    expect(dayOptions(sat).map((o) => o.label)).toEqual(['Sat']);
    expect(dayOptions(courses, 1 << 2).map((o) => o.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
});

describe('termChoices', () => {
  it('puts this term first when it has sections, then past terms newest first', () => {
    expect(termChoices('2026-27 Term 2', true, ['2023-24 Term 1', '2025-26 Term 2', '2024-25 Term 3A', '2024-25 Term 3B']).map((c) => c.term))
      .toEqual(['2026-27 Term 2', '2025-26 Term 2', '2024-25 Term 3B', '2024-25 Term 3A', '2023-24 Term 1']);
  });
  it('marks only this term as now, and lists it once when the data also has it', () => {
    const c = termChoices('2026-27 Term 2', true, ['2026-27 Term 2', '2025-26 Term 2']);
    expect(c).toEqual([{ term: '2026-27 Term 2', now: true }, { term: '2025-26 Term 2', now: false }]);
  });
  it('starts at the newest past term for a course not offered this term, and may be empty', () => {
    expect(termChoices('2026-27 Term 2', false, ['2024-25 Term 1', '2025-26 Term 2'])[0]).toEqual({ term: '2025-26 Term 2', now: false });
    expect(termChoices('2026-27 Term 2', false, ['2026-27 Term 2']).map((c) => c.now)).toEqual([false]);
    expect(termChoices('2026-27 Term 2', false, [])).toEqual([]);
  });
  it('shortens a chip label', () => {
    expect([shortTerm('2025-26 Term 2'), shortTerm('2024-25 Term 3A')]).toEqual(['2025-26 T2', '2024-25 T3A']);
  });
});

describe('URL state', () => {
  const full: BrowseState = { q: 'law', sub: 'COR-LAW', days: 0b00101, times: ['08:15', '19:00'], seats: true, nofinal: true, course: 'COR-LAW2243', term: '2025-26 Term 2', sec: 'G1' };
  it('round-trips every field and omits defaults', () => {
    expect(decodeBrowse(encodeBrowse(full))).toEqual(full);
    expect(encodeBrowse(browseDefaults())).toBe('');
    expect(decodeBrowse('')).toEqual(browseDefaults());
  });
  it('keeps the term and section only with a course', () => {
    expect(encodeBrowse({ ...full, course: '' })).not.toMatch(/term|sec/);
    expect(decodeBrowse('?term=2025-26+Term+2&sec=G1')).toMatchObject({ course: '', term: '', sec: '' });
  });
  it('reads a course code in any case and ignores junk', () => {
    expect(decodeBrowse('?course=is214').course).toBe('IS214');
    expect(decodeBrowse('?day=xyz&time=q,2460,8:15&seats=0&nofinal=maybe')).toEqual(browseDefaults());
  });
  it('writes start times as time=0815,1200 and ignores the old m/a/e values', () => {
    expect(encodeBrowse({ ...browseDefaults(), times: ['12:00', '08:15'] })).toBe('time=0815,1200');
    expect(decodeBrowse('?time=1200,0815,0815').times).toEqual(['08:15', '12:00']);
    expect(decodeBrowse('?time=m,a')).toEqual(browseDefaults());
    expect(decodeBrowse('?time=m,1200,e').times).toEqual(['12:00']);
  });
  it('reads old Browse all sections links: the course text or professor becomes the search', () => {
    expect(decodeBrowse('?v=browse&bq=IS214&bt=2025-26+Term+2').q).toBe('IS214');
    expect(decodeBrowse('?v=browse&bi=ANN+LEE').q).toBe('ANN LEE');
  });
  it('counts filters but not the search text', () => {
    expect(activeFilterCount(full)).toBe(5);
    expect(activeFilterCount(browseDefaults())).toBe(0);
  });
});

describe('exploreMode', () => {
  it('opens Browse by default and for old v=browse links', () => {
    expect(['', '?v=browse&bq=x', '?q=a', '?course=IS214'].map(exploreMode)).toEqual(['browse', 'browse', 'browse', 'browse']);
  });
  it('opens Build a chart for v=build, a chart spec, or an old Compare link', () => {
    expect(['?v=build', '?v=build&kv=2&kt=bar', '?kv=2', '?c=IS214,IS216'].map(exploreMode)).toEqual(['build', 'build', 'build', 'build']);
  });
});

describe('classes redirect', () => {
  it('carries search, subject, day, time and seats over', () => {
    const r = classesQueryToBrowse('?q=law&sub=COR-LAW&day=mon,wed&time=m,e,0815&seats=1');
    expect(decodeBrowse(r)).toEqual({ ...browseDefaults(), q: 'law', sub: 'COR-LAW', days: 0b101, times: ['08:15'], seats: true });
  });
  it('turns exam=none into the no-final filter and drops exam=has and sort', () => {
    expect(decodeBrowse(classesQueryToBrowse('?exam=none')).nofinal).toBe(true);
    expect(classesQueryToBrowse('?exam=has&sort=seats')).toBe('');
  });
  it('is empty for a bare /classes/ link', () => {
    expect(classesQueryToBrowse('')).toBe('');
  });
});
