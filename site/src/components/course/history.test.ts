import { describe, expect, it } from 'vitest';
import { byWindow, dayText, shortWindow, termWithResults, timeText } from './history';
import type { HistoryRow } from '../../lib/data/types';

describe('timeText', () => {
  it('reads a two-day history row, which used to come out as "Mon;, Thu"', () => {
    expect(timeText('MON; THU', '08:15; 08:15', '09:45; 09:45')).toBe('Mon, Thu 08:15–09:45');
  });
  it('keeps different times per day apart', () => {
    expect(timeText('MON; THU', '08:15; 09:00', '09:00; 09:45')).toBe('Mon 08:15–09:00 · Thu 09:00–09:45');
  });
  it('falls back when there is no time', () => {
    expect(timeText('TBA', '', '')).toBe('Time not set');
    expect(timeText('', '', '')).toBe('Time not set');
  });
});

describe('dayText', () => {
  it('splits on semicolons as well as commas and spaces', () => {
    expect(dayText('MON; THU')).toBe('Mon, Thu');
    expect(dayText('MON,THU')).toBe('Mon, Thu');
    expect(dayText('TUE')).toBe('Tue');
  });
});

const row = (o: Partial<HistoryRow>): HistoryRow => ({
  term: '2026-27 Term 2', window: 'Round 1 Window 1', section: 'G1', classNumber: '1', instructor: 'LIM YI SHENG',
  days: 'MON', start: '08:15', end: '11:30', medianCents: 100, minCents: 50, vacancy: 40, before: 40, after: 0, enrolled: 40, ...o,
});

describe('byWindow', () => {
  it('takes the median of section medians and the lowest of the minimums per window', () => {
    const rows = [
      row({ section: 'G1', medianCents: 100, minCents: 50 }),
      row({ section: 'G2', medianCents: 300, minCents: 20 }),
      row({ section: 'G3', medianCents: 200, minCents: 80 }),
      row({ section: 'G4', medianCents: 400, minCents: 90 }),
    ];
    const [p] = byWindow(rows, '2026-27 Term 2');
    expect(p.median).toBe(250);
    expect(p.min).toBe(20);
  });
  it('orders windows naturally and leaves other terms out', () => {
    const rows = [
      row({ window: 'Round 2 Window 1' }),
      row({ window: 'Round 1A Window 2' }),
      row({ window: 'Round 1A Window 1' }),
      row({ window: 'Round 1 Window 1' }),
      row({ window: 'Round 1 Window 1', term: '2025-26 Term 2', medianCents: 9999 }),
      row({ window: 'Incoming Freshmen Rnd 1 Win 1' }),
    ];
    expect(byWindow(rows, '2026-27 Term 2').map((p) => p.window)).toEqual([
      'Round 1 Window 1', 'Round 1A Window 1', 'Round 1A Window 2', 'Round 2 Window 1', 'Incoming Freshmen Rnd 1 Win 1',
    ]);
  });
  it('keeps a window where nobody won, with null prices', () => {
    const [p] = byWindow([row({ medianCents: null, minCents: null }), row({ section: 'G2', medianCents: null, minCents: null })], '2026-27 Term 2');
    expect(p.median).toBeNull();
    expect(p.min).toBeNull();
    expect(p.rows).toHaveLength(2);
  });
  it('filters by instructor, ignoring case and commas', () => {
    const rows = [row({ instructor: 'LIM YI SHENG', medianCents: 100 }), row({ section: 'G2', instructor: 'Tan, Ah Kow', medianCents: 900 })];
    expect(byWindow(rows, '2026-27 Term 2', 'lim yi sheng')[0].median).toBe(100);
    expect(byWindow(rows, '2026-27 Term 2', 'TAN AH KOW')[0].median).toBe(900);
    expect(byWindow(rows, '2026-27 Term 2', 'NOBODY')).toEqual([]);
  });
});

describe('termWithResults', () => {
  const rows = [row({ term: '2025-26 Term 2' }), row({ term: '2026-27 Term 1' }), row({ term: '2026-27 Term 2', instructor: 'OTHER PERSON' })];
  it('uses the current term when it has rows', () => {
    expect(termWithResults(rows, '2026-27 Term 2')).toBe('2026-27 Term 2');
  });
  it('falls back to the newest earlier term', () => {
    expect(termWithResults(rows, '2026-27 Term 2', 'LIM YI SHENG')).toBe('2026-27 Term 1');
    expect(termWithResults(rows.slice(0, 1), '2026-27 Term 2')).toBe('2025-26 Term 2');
  });
  it('prefers a term with a winning bid over a newer one where nobody has won', () => {
    const r = [row({ term: '2025-26 Term 2' }), row({ term: '2026-27 Term 2', medianCents: null, minCents: null })];
    expect(termWithResults(r, '2026-27 Term 2')).toBe('2025-26 Term 2');
  });
  it('shows the newest term with any rows when no term has a bid', () => {
    const r = [row({ term: '2025-26 Term 2', medianCents: null, minCents: null }), row({ term: '2026-27 Term 1', medianCents: null, minCents: null })];
    expect(termWithResults(r, '2026-27 Term 2')).toBe('2026-27 Term 1');
  });
  it('ignores terms after the current one and returns null with nothing', () => {
    expect(termWithResults([row({ term: '2027-28 Term 1' })], '2026-27 Term 2')).toBeNull();
    expect(termWithResults([], '2026-27 Term 2')).toBeNull();
  });
});

describe('shortWindow', () => {
  it('shortens round windows and special intakes', () => {
    expect(shortWindow('Round 1 Window 1')).toBe('Rnd 1');
    expect(shortWindow('Round 1A Window 2')).toBe('1A W2');
    expect(shortWindow('Round 2 Window 1')).toBe('Rnd 2')
    expect(shortWindow('Round 2 Window 2')).toBe('Rnd 2 W2');
    expect(shortWindow('Incoming Exchange Rnd 1C Win 2')).toBe('IE 1C W2');
    expect(shortWindow('Something else')).toBe('Something else');
  });
});
