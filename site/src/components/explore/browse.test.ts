import { describe, expect, it } from 'vitest';
import {
  courseTerms, decodeShard, fmtBid, fmtSeats, fullWindow, groupRows, pastSections, seatsTaken,
  type BrowseManifest, type BrowseRow, type BrowseShard,
} from './browse';

const man: BrowseManifest = {
  columns: ['course', 'window', 'section', 'instructor', 'medianCents', 'minCents', 'vacancy', 'before', 'after', 'filled'],
  codes: ['ACCT101', 'COR1100', 'LAW201'],
  windows: ['Round 1 Window 1', 'Round 1A Window 2', 'Round 1B Window 1'],
  sections: ['G1', 'G2', 'G10'],
  instructors: ['ANN LEE', 'BOB TAN, ANN LEE'],
  terms: [
    { term: '2025-26 Term 2', file: 'browse/2025-26-term-2.json', rows: 2 },
    { term: '2026-27 Term 2', file: 'browse/2026-27-term-2.json', rows: 4 },
  ],
};
const shard: BrowseShard = {
  term: '2026-27 Term 2',
  rows: [
    [0, 0, 0, 0, 1250, 1001, 40, 40, 0, 1],
    [0, 1, 2, 1, null, null, 40, 5, 0, 1],
    [1, 2, 1, -1, 0, 0, 30, 30, 12, 0],
    [2, 0, 0, 0, 300, 100, 0, 0, 0, 0],
  ],
};
const rows = decodeShard(man, shard);

describe('decodeShard', () => {
  it('resolves lookups, null values and the term', () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      code: 'ACCT101', term: '2026-27 Term 2', window: 'Round 1 Window 1', section: 'G1', instructor: 'ANN LEE', slot: '',
      medianCents: 1250, minCents: 1001, vacancy: 40, before: 40, after: 0, filled: true,
    });
    expect(rows[1].section).toBe('G10');
    expect(rows[1].medianCents).toBeNull();
    expect(rows[2].instructor).toBeNull();
    expect(rows[2].medianCents).toBe(0); // a real zero bid is not "no bid"
  });
  it('turns the slot column into day and time text, empty when absent', () => {
    const withSlots: BrowseManifest = {
      ...man,
      columns: [...man.columns, 'slot'],
      slots: [['MON; THU', '12:00; 12:00', '15:15; 15:15'], ['TUE', '08:15', null]],
    };
    const s: BrowseShard = { term: shard.term, rows: [[0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 0], [0, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1], [0, 2, 0, 0, 1, 1, 1, 1, 0, 1, -1]] };
    expect(decodeShard(withSlots, s).map((r) => r.slot)).toEqual(['Mon, Thu 12:00–15:15', 'Tue 08:15', '']);
    expect(rows.map((r) => r.slot)).toEqual(['', '', '', '']); // older data without the column
  });
  it('trusts the filled flag only when it is 1', () => {
    expect(rows.map((r) => r.filled)).toEqual([true, true, false, false]);
  });
  it('finds columns by name', () => {
    const swapped: BrowseManifest = { ...man, columns: ['filled', ...man.columns.filter((c) => c !== 'filled')] };
    const s: BrowseShard = { term: 't', rows: [[1, 1, 0, 0, 0, 500, 400, 10, 10, 3]] };
    const [r] = decodeShard(swapped, s);
    expect([r.filled, r.code, r.medianCents, r.after]).toEqual([true, 'COR1100', 500, 3]);
  });
});

describe('fmtBid', () => {
  it('shows cents as e$ with 2 decimals and a dash for null', () => {
    expect([fmtBid(1250), fmtBid(5), fmtBid(0), fmtBid(null)]).toEqual(['12.50', '0.05', '0.00', '–']);
  });
});

describe('fmtSeats', () => {
  it('shows a count, and a dash for unknown', () => {
    expect([fmtSeats(27), fmtSeats(0), fmtSeats(null)]).toEqual(['27', '0', '–']);
  });
});

describe('groupRows', () => {
  const row = (window: string, medianCents: number | null, section = 'G1', term = '2026-27 Term 2', code = 'ACCT101'): BrowseRow => ({
    code, term, window, section, instructor: null, slot: '', medianCents, minCents: medianCents, vacancy: 40, before: 0, after: 0, filled: true,
  });
  it('makes one group per course, section and term', () => {
    const g = groupRows([row('Round 1 Window 1', 5), row('Round 1 Window 2', 6), row('Round 1 Window 1', 7, 'G2'), row('Round 1 Window 1', 8, 'G1', '2025-26 Term 2')]);
    expect(g.map((x) => x.key)).toEqual(['ACCT101|G1|2026-27 Term 2', 'ACCT101|G2|2026-27 Term 2', 'ACCT101|G1|2025-26 Term 2']);
  });
  it('shows the latest window with a winning bid, and lists the others latest first', () => {
    const [g] = groupRows([row('Round 1 Window 1', 500), row('Round 1B Window 1', null), row('Round 1A Window 2', 300), row('Round 1A Window 1', null)]);
    expect(g.head.window).toBe('Round 1A Window 2');
    expect(g.others.map((r) => r.window)).toEqual(['Round 1B Window 1', 'Round 1A Window 1', 'Round 1 Window 1']);
  });
  it('shows the latest window when no window had a winning bid', () => {
    const [g] = groupRows([row('Round 1 Window 1', null), row('Round 2 Window 1', null)]);
    expect(g.head.window).toBe('Round 2 Window 1');
    expect(g.others).toHaveLength(1);
  });
});

describe('fullWindow', () => {
  it('spells out Rnd and Win and leaves full labels alone', () => {
    expect(fullWindow('Incoming Exchange Rnd 1C Win 1')).toBe('Incoming Exchange Round 1C Window 1');
    expect(fullWindow('Round 2A Window 3')).toBe('Round 2A Window 3');
  });
});

describe('pastSections', () => {
  const row = (code: string, section: string, window: string, over: Partial<BrowseRow> = {}): BrowseRow => ({
    code, term: '2025-26 Term 2', window, section, instructor: 'ANN LEE', slot: 'Mon 09:00–12:15', medianCents: 500, minCents: 400, vacancy: 40, before: 30, after: 10, filled: false, ...over,
  });
  it('lists one entry per section, naturally ordered, with windows in the order BOSS runs them', () => {
    const list = pastSections([
      row('IS214', 'G10', 'Round 1 Window 1'),
      row('IS214', 'G2', 'Round 1B Window 1'),
      row('IS214', 'G2', 'Round 1 Window 1'),
      row('IS214', 'G2', 'Round 1A Window 2', { medianCents: null, minCents: null }),
      row('ACCT101', 'G1', 'Round 1 Window 1'),
    ], 'IS214');
    expect(list.map((s) => s.section)).toEqual(['G2', 'G10']);
    expect(list[0].windows.map((w) => w.window)).toEqual(['Round 1 Window 1', 'Round 1A Window 2', 'Round 1B Window 1']);
    expect(list[0].instructor).toBe('ANN LEE');
  });
  it('is empty for a course with no rows', () => {
    expect(pastSections([row('ACCT101', 'G1', 'Round 1 Window 1')], 'IS214')).toEqual([]);
  });
});

describe('seatsTaken', () => {
  it('is seats offered minus seats left, never below 0, and null when unknown', () => {
    expect([seatsTaken({ before: 30, after: 10 }), seatsTaken({ before: 5, after: 9 }), seatsTaken({ before: null, after: 1 }), seatsTaken({ before: 4, after: null })]).toEqual([20, 0, null, null]);
  });
});

describe('courseTerms', () => {
  it('lists the terms that have rows for each course, as positions in the manifest order', () => {
    const shards: BrowseShard[] = [
      { term: '2026-27 Term 2', rows: [[0, 0, 0, 0, null, null, 1, 1, 0, 1], [1, 0, 0, 0, null, null, 1, 1, 0, 1]] },
      { term: '2025-26 Term 2', rows: [[1, 0, 0, 0, null, null, 1, 1, 0, 1], [1, 1, 0, 0, null, null, 1, 1, 0, 1]] },
    ];
    const r = courseTerms(man, shards);
    expect(r.terms).toEqual(['2025-26 Term 2', '2026-27 Term 2']);
    expect(r.by).toEqual({ ACCT101: [1], COR1100: [0, 1] });
  });
});
