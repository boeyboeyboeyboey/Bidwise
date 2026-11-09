import { describe, expect, it } from 'vitest';
import { buildRows, R, seatText, subjectOf, type ClassRow } from './logic';

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
  it('uses live seats, flags approx, and sets the day mask and sorted start times', () => {
    const law = rows.find((r) => r[R.code] === 'COR-LAW2243')!;
    expect([law[R.left], law[R.total], law[R.approx], law[R.days], law[R.times]]).toEqual([7, 30, 1, 0b10010, ['09:00', '18:30']]);
    expect(law[R.slot]).toBe('Tue 18:30–21:45 · Fri 09:00–10:00');
  });
  it('writes the exam as day name, day and short month, or empty when none is listed', () => {
    expect(rows.map((r) => r[R.exam])).toEqual(['', 'Mon 3 May, 09:00', 'Thu 29 Apr, 13:00', '']);
  });
  it('gives TBA sections no days or start times and no slot', () => {
    const acct = rows[0];
    expect([acct[R.days], acct[R.times], acct[R.slot]]).toEqual([0, [], '']);
  });
});

describe('subjectOf', () => {
  it('takes the letters and any hyphenated prefix before the number', () => {
    expect(subjectOf('COR-LAW2243')).toBe('COR-LAW');
    expect(subjectOf('ECON111')).toBe('ECON');
  });
});

describe('seatText', () => {
  it('marks estimates and zeros', () => {
    expect(seatText(['A', '', 'G1', '', '', 5, 9, 0, 0, [], ''])).toBe('5 left');
    expect(seatText(['A', '', 'G1', '', '', 5, 9, 1, 0, [], ''])).toBe('~5 left');
    expect(seatText(['A', '', 'G1', '', '', 0, 9, 0, 0, [], ''])).toBe('Full');
    expect(seatText(['A', '', 'G1', '', '', 0, 9, 1, 0, [], ''])).toBe('Likely full');
  });
});
