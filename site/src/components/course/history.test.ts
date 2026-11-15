import { describe, expect, it } from 'vitest';
import { bandWidth, bandX, labelIndices, useBands, byWindow, dayText, defaultHistoryWindow, historySeed, shortWindow, termWithResults, timeText, windowTimeline } from './history';
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

describe('defaultHistoryWindow', () => {
  const R1 = 'Round 1 Window 1', R1B = 'Round 1B Window 2', R2 = 'Round 2 Window 1', R2A = 'Round 2A Window 1';
  const one = (window: string) => row({ window, medianCents: 100, minCents: 50 });
  const won = (window: string) => [one(window), one(window), one(window)];
  const lost = (window: string) => row({ window, medianCents: null, minCents: null });

  it('opens on the current window when it has three results with bids', () => {
    expect(defaultHistoryWindow([...won(R1), ...won(R2)], R2)).toBe(R2);
  });
  it('falls back to the previous window when the current one has no bids', () => {
    expect(defaultHistoryWindow([...won(R1), ...won(R1B), lost(R2)], R2)).toBe(R1B);
  });
  it('falls back when the current window has only one or two results with bids', () => {
    expect(defaultHistoryWindow([...won(R1B), one(R2), one(R2), lost(R2)], R2)).toBe(R1B);
  });
  it('skips earlier windows without enough bids and uses the latest one that has them', () => {
    expect(defaultHistoryWindow([...won(R1), lost(R1B), one(R1B), lost(R2)], R2)).toBe(R1);
  });
  it('uses all windows when no window has three results with bids, or there are no rows', () => {
    expect(defaultHistoryWindow([lost(R1), one(R1), one(R2), one(R2)], R2)).toBe('');
    expect(defaultHistoryWindow([], R2)).toBe('');
  });
  it('never picks a window after the current one', () => {
    expect(defaultHistoryWindow(won(R2A), R2)).toBe('');
    expect(defaultHistoryWindow([...won(R1), ...won(R2A)], R2)).toBe(R1);
  });
  it('counts a lowest bid without a median as bids', () => {
    const min = () => row({ window: R1, medianCents: null, minCents: 40 });
    expect(defaultHistoryWindow([min(), min(), min()], R2)).toBe(R1);
  });
});

describe('bandX / bandWidth', () => {
  it('splits the plot into equal bands', () => {
    expect(bandWidth(100, 400, 3)).toBe(100);
  });
  it('centres a lone window in its band', () => {
    expect(bandX(0, 3, 0, 1, 100, 400)).toBeCloseTo(150);
    expect(bandX(2, 3, 0, 1, 100, 400)).toBeCloseTo(350);
  });
  it('spreads slots inside the padded band, in slot order, symmetric about the band centre', () => {
    // band 0 is 100..200, 15% padding leaves 115..185, four slots of 17.5 wide
    const xs = [0, 1, 2, 3].map((s) => bandX(0, 3, s, 4, 100, 400));
    expect(xs[0]).toBeCloseTo(123.75);
    expect(xs[3]).toBeCloseTo(176.25);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect((xs[0] + xs[3]) / 2).toBeCloseTo(150);
  });
  it('gives the same slot the same offset in every term, even when other slots are empty', () => {
    const off = (t: number) => bandX(t, 3, 2, 4, 100, 400) - (100 + t * 100);
    expect(off(1)).toBeCloseTo(off(0));
    expect(off(2)).toBeCloseTo(off(0));
  });
});

describe('windowTimeline', () => {
  const T1 = '2025-26 Term 1', T2 = '2025-26 Term 2';
  it('uses one slot list for every term and leaves missing windows empty', () => {
    const rows = [
      row({ term: T2, window: 'Round 2 Window 1' }),
      row({ term: T1, window: 'Round 1 Window 1' }),
      row({ term: T1, window: 'Round 2 Window 1' }),
      row({ term: T2, window: 'Round 1 Window 1' }),
      row({ term: T2, window: 'Round 3 Window 1' }),
    ];
    const t = windowTimeline(rows);
    expect(t.terms).toEqual([T1, T2]);
    expect(t.slots).toEqual(['Round 1 Window 1', 'Round 2 Window 1', 'Round 3 Window 1']);
    expect(t.cells.map((c) => [c.termIdx, c.slotIdx])).toEqual([[0, 0], [0, 1], [1, 0], [1, 1], [1, 2]]);
  });
  it('averages sections within a (term, window)', () => {
    const t = windowTimeline([row({ medianCents: 100 }), row({ section: 'G2', medianCents: 300 })]);
    expect(t.cells).toHaveLength(1);
    expect(t.cells[0].median).toBe(200);
  });
});

describe('useBands', () => {
  it('is off for one window', () => expect(useBands(1000, 4, 1)).toBe(false));
  it('is on when each slot is wide enough', () => {
    // band 250, 70% usable = 175, 5 slots of 35 px
    expect(useBands(1000, 4, 5)).toBe(true);
  });
  it('is off when slots would be narrower than a dot pair', () => {
    expect(useBands(1000, 4, 17)).toBe(true); // 10.3 px
    expect(useBands(1000, 12, 17)).toBe(false);
    expect(useBands(250, 4, 17)).toBe(false);
  });
  it('switches exactly at 8 px per slot', () => {
    expect(useBands(800, 2, 35)).toBe(true); // 400*0.7/35 = 8
    expect(useBands(800, 2, 36)).toBe(false);
  });
});

describe('labelIndices', () => {
  it('shows every label when they fit', () => expect(labelIndices(4, 100)).toEqual([0, 1, 2, 3]));
  it('shows every k-th label counted back from the last, so the last is always shown', () => {
    expect(labelIndices(5, 40)).toEqual([0, 2, 4]); // 60 / 40 -> k = 2
    expect(labelIndices(6, 40)).toEqual([1, 3, 5]);
    expect(labelIndices(12, 20)).toEqual([2, 5, 8, 11]); // k = 3
  });
  it('keeps a lone term', () => expect(labelIndices(1, 0)).toEqual([0]));
});

describe('historySeed', () => {
  const R1 = 'Round 1 Window 1';
  const R1B = 'Round 1B Window 1';
  const rs = (window: string, instructor: string, n = 3) => Array.from({ length: n }, (_, i) => row({ window, instructor, section: `G${i}` }));
  it('opens on the same instructor and the window the panel would pick, keeping only that window\'s rows', () => {
    const h = [...rs(R1, 'LIM'), ...rs(R1, 'TAN'), ...rs(R1B, 'TAN'), ...rs(R1B, 'LIM', 1)];
    const s = historySeed(h, 'lim', R1B)!;
    expect(s.scope).toBe('instructor');
    expect(s.win).toBe(R1); // LIM has only one result in R1B, so R1B does not qualify
    expect(s.rows).toHaveLength(6);
    expect(s.windows).toEqual([R1, R1B]);
    expect(s.hasMine).toBe(true);
  });
  it('falls back to the whole course when the instructor has no rows', () => {
    const s = historySeed(rs(R1B, 'TAN'), 'LIM', R1B)!;
    expect(s.scope).toBe('course');
    expect(s.hasMine).toBe(false);
    expect(s.win).toBe(R1B);
  });
  it('drops fields the panel does not read, and gives up when the rows are too big to embed', () => {
    expect(Object.keys(historySeed(rs(R1, 'LIM'), 'LIM', R1)!.rows[0])).not.toContain('classNumber');
    expect(historySeed(rs(R1, 'LIM', 3000), 'LIM', R1)).toBeNull();
  });
});
