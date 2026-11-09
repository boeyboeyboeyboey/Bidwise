import { describe, expect, it } from 'vitest';
import { activeFilterCount, buildRows, filterRows, filtersFromQuery, filtersToQuery, NO_FILTERS, R, seatText, subjectOf, subjectsOf, type ClassRow } from './logic';

const sec = (section: string, over: Record<string, unknown> = {}) => ({
  section, instructor: 'ANN LEE', seatsLeft: 3, seatsTotal: 40,
  meetings: [{ day: 'MON', start: '09:00', end: '12:15' }], ...over,
});
const courses = [
  { code: 'ECON111', title: 'Microeconomics', sectionsNow: [sec('G10'), sec('G2', { meetings: [{ day: 'THU', start: '12:00', end: '15:15' }], seatsLeft: 0, exam: { date: '2027-04-29', start: '13:00', end: '15:00' } })] },
  { code: 'COR-LAW2243', title: 'Business Law', sectionsNow: [sec('G1', { exam: { date: '2027-05-03', start: '09:00', end: null }, instructor: 'BOB TAN', meetings: [{ day: 'TUE', start: '18:30', end: '21:45' }, { day: 'FRI', start: '09:00', end: '10:00' }], live: { available: 7, total: 30, source: 'approx', capturedAt: '', window: '' } })] },
  { code: 'ACCT101', title: 'Accounting', sectionsNow: [sec('G1', { meetings: [{ day: 'TBA', start: null, end: null }] })] },
];
const rows = buildRows(courses);
const codes = (rs: ClassRow[]) => rs.map((r) => `${r[R.code]} ${r[R.section]}`);

describe('buildRows', () => {
  it('orders by code, then section naturally', () => {
    expect(codes(rows)).toEqual(['ACCT101 G1', 'COR-LAW2243 G1', 'ECON111 G2', 'ECON111 G10']);
  });
  it('uses live seats, flags approx, and sets day/time masks', () => {
    const law = rows.find((r) => r[R.code] === 'COR-LAW2243')!;
    expect([law[R.left], law[R.total], law[R.approx], law[R.days], law[R.times]]).toEqual([7, 30, 1, 0b10010, 0b101]);
    expect(law[R.slot]).toBe('Tue 18:30–21:45 · Fri 09:00–10:00');
  });
  it('writes the exam as day name, day and short month, or empty when none is listed', () => {
    expect(rows.map((r) => r[R.exam])).toEqual(['', 'Mon 3 May, 09:00', 'Thu 29 Apr, 13:00', '']);
  });
  it('gives TBA sections empty masks and no slot', () => {
    const acct = rows[0];
    expect([acct[R.days], acct[R.times], acct[R.slot]]).toEqual([0, 0, '']);
  });
});

describe('filterRows', () => {
  const f = (o: Partial<typeof NO_FILTERS>) => codes(filterRows(rows, { ...NO_FILTERS, ...o }));
  it('searches code, title and professor, with or without separators', () => {
    expect(f({ q: 'econ 111' })).toEqual(['ECON111 G2', 'ECON111 G10']);
    expect(f({ q: 'econ111' })).toHaveLength(2);
    expect(f({ q: 'bob' })).toEqual(['COR-LAW2243 G1']);
    expect(f({ q: 'business law' })).toEqual(['COR-LAW2243 G1']);
    expect(f({ q: 'zzz' })).toEqual([]);
  });
  it('filters by subject prefix', () => {
    expect(subjectOf('COR-LAW2243')).toBe('COR-LAW');
    expect(f({ subject: 'COR-LAW' })).toEqual(['COR-LAW2243 G1']);
    expect(subjectsOf(rows)).toEqual(['ACCT', 'COR-LAW', 'ECON']);
  });
  it('filters by day (any selected) and time of day', () => {
    expect(f({ days: 0b00010 })).toEqual(['COR-LAW2243 G1']);
    expect(f({ days: 0b10000 | 0b01000 })).toEqual(['COR-LAW2243 G1', 'ECON111 G2']);
    expect(f({ times: 4 })).toEqual(['COR-LAW2243 G1']);
    expect(f({ times: 1 })).toEqual(['COR-LAW2243 G1', 'ECON111 G10']);
  });
  it('has seats left drops full sections', () => {
    expect(f({ hasSeats: true })).not.toContain('ECON111 G2');
  });
  it('final exam filter: any, has exam, no exam listed', () => {
    expect(f({ exam: 'any' })).toHaveLength(4);
    expect(f({ exam: 'has' })).toEqual(['COR-LAW2243 G1', 'ECON111 G2']);
    expect(f({ exam: 'none' })).toEqual(['ACCT101 G1', 'ECON111 G10']);
    expect(f({ exam: 'has', hasSeats: true })).toEqual(['COR-LAW2243 G1']);
  });
  it('sorts by seats left, ties in code order', () => {
    expect(f({ sort: 'seats' })).toEqual(['COR-LAW2243 G1', 'ACCT101 G1', 'ECON111 G10', 'ECON111 G2']);
  });
});

describe('URL state', () => {
  it('round-trips and omits defaults', () => {
    const s = { q: 'law', subject: 'COR-LAW', days: 0b00101, times: 0b101, hasSeats: true, exam: 'none' as const, sort: 'seats' as const };
    expect(filtersFromQuery(filtersToQuery(s))).toEqual(s);
    expect(filtersToQuery(NO_FILTERS)).toBe('');
  });
  it('writes the exam filter as exam=has or exam=none', () => {
    expect(filtersToQuery({ ...NO_FILTERS, exam: 'has' })).toBe('exam=has');
    expect(filtersFromQuery('?exam=none').exam).toBe('none');
    expect(activeFilterCount({ ...NO_FILTERS, exam: 'has' })).toBe(1);
  });
  it('ignores junk', () => {
    expect(filtersFromQuery('?day=xyz&time=q&sort=bad&seats=0&exam=maybe')).toEqual(NO_FILTERS);
  });
});

describe('seatText', () => {
  it('marks estimates and zeros', () => {
    expect(seatText(['A', '', 'G1', '', '', 5, 9, 0, 0, 0, ''])).toBe('5 left');
    expect(seatText(['A', '', 'G1', '', '', 5, 9, 1, 0, 0, ''])).toBe('~5 left');
    expect(seatText(['A', '', 'G1', '', '', 0, 9, 0, 0, 0, ''])).toBe('Full');
    expect(seatText(['A', '', 'G1', '', '', 0, 9, 1, 0, 0, ''])).toBe('Likely full');
  });
});
