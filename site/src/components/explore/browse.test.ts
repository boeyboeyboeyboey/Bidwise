import { describe, expect, it } from 'vitest';
import {
  browseDefaults, decodeBrowse, decodeShard, encodeBrowse, filterRows, fmtBid, fmtSeats, fmtSeatsLeft, fullWindow, PAGE_SIZE, groupRows, nameMatches, pageOf, sortGroups, sortRows, termsToLoad,
  type BrowseManifest, type BrowseRow, type BrowseShard, type CourseInfo,
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
const courses = new Map<string, CourseInfo>([
  ['ACCT101', { title: 'Financial Accounting', school: 'SOA' }],
  ['COR1100', { title: 'Writing and Reasoning', school: 'CORE' }],
  ['LAW201', { title: 'Contract Law', school: 'YPHSL' }],
]);
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
const codes = (rs: BrowseRow[]) => rs.map((r) => `${r.code}/${r.window}/${r.section}`);

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

describe('filterRows', () => {
  const f = { school: '', window: '', instructor: '', q: '', filled: false };
  it('is a no-op with blank filters', () => expect(filterRows(rows, f, courses)).toHaveLength(4));
  it('filters by school, window, filled', () => {
    expect(filterRows(rows, { ...f, school: 'SOA' }, courses)).toHaveLength(2);
    expect(filterRows(rows, { ...f, window: 'Round 1 Window 1' }, courses)).toHaveLength(2);
    expect(filterRows(rows, { ...f, filled: true }, courses).every((r) => r.filled)).toBe(true);
  });
  it('matches instructor as a case-insensitive substring, including shared sections', () => {
    expect(filterRows(rows, { ...f, instructor: 'ann lee' }, courses)).toHaveLength(3);
    expect(filterRows(rows, { ...f, instructor: 'bob' }, courses)).toHaveLength(1);
  });
  it('matches instructor words in any order, ignoring commas', () => {
    expect(nameMatches('LEE, YUN', 'lee yun')).toBe(true);
    expect(nameMatches('LEE, YUN', 'yun, lee')).toBe(true);
    expect(nameMatches('BOB TAN, ANN LEE', 'ann bob')).toBe(true);
    expect(nameMatches('LEE, YUN', 'lee kim')).toBe(false);
    expect(filterRows(rows, { ...f, instructor: 'lee ann' }, courses)).toHaveLength(3);
  });
  it('matches instructor tokens at word starts only', () => {
    expect(nameMatches('STAN LOW', 'tan')).toBe(false);
    expect(nameMatches('BOB TAN', 'tan')).toBe(true);
    expect(nameMatches('BOB TAN', 'ta')).toBe(true);
    expect(nameMatches('MC-DONALD, P.', 'donald p')).toBe(true);
    expect(filterRows(rows, { ...f, instructor: 'nn' }, courses)).toEqual([]);
  });
  it('searches course code (punctuation-insensitive) and title', () => {
    expect(filterRows(rows, { ...f, q: 'cor 1100' }, courses).map((r) => r.code)).toEqual(['COR1100']);
    expect(filterRows(rows, { ...f, q: 'contract' }, courses).map((r) => r.code)).toEqual(['LAW201']);
  });
  it('combines filters with AND', () => {
    const out = filterRows(rows, { school: 'SOA', window: 'Round 1 Window 1', instructor: 'ann', q: 'acct', filled: true }, courses);
    expect(codes(out)).toEqual(['ACCT101/Round 1 Window 1/G1']);
    expect(filterRows(rows, { ...f, school: 'SOA', filled: true, window: 'Round 1B Window 1' }, courses)).toEqual([]);
  });
});

describe('sortRows', () => {
  it('sorts sections naturally (G2 before G10)', () => {
    const acct = rows.filter((r) => r.code === 'ACCT101');
    expect(sortRows(acct, 'section', 'asc').map((r) => r.section)).toEqual(['G1', 'G10']);
    expect(sortRows(acct, 'section', 'desc').map((r) => r.section)).toEqual(['G10', 'G1']);
  });
  it('puts null bids last in both directions', () => {
    for (const dir of ['asc', 'desc'] as const) {
      const out = sortRows(rows, 'median', dir);
      expect(out.at(-1)?.medianCents).toBeNull();
      expect(out.filter((r) => r.medianCents !== null).map((r) => r.medianCents)).toEqual(dir === 'asc' ? [0, 300, 1250] : [1250, 300, 0]);
    }
  });
  it('puts missing instructors last', () => {
    expect(sortRows(rows, 'instructor', 'asc').at(-1)?.instructor).toBeNull();
    expect(sortRows(rows, 'instructor', 'desc').at(-1)?.instructor).toBeNull();
  });
  it('is stable: equal keys keep input order, in both directions', () => {
    expect(codes(sortRows(rows, 'filled', 'asc'))).toEqual(codes([rows[2], rows[3], rows[0], rows[1]]));
    expect(codes(sortRows(rows, 'filled', 'desc'))).toEqual(codes([rows[0], rows[1], rows[2], rows[3]]));
    expect(sortRows(rows, 'course', 'desc').slice(-2).map((r) => r.code)).toEqual(['ACCT101', 'ACCT101']);
    expect(codes(sortRows(rows, 'course', 'asc')).slice(0, 2)).toEqual(codes([rows[0], rows[1]]));
  });
  it('orders windows chronologically, not alphabetically', () => {
    expect(sortRows(rows, 'window', 'asc').map((r) => r.window)).toEqual([
      'Round 1 Window 1', 'Round 1 Window 1', 'Round 1A Window 2', 'Round 1B Window 1',
    ]);
  });
  it('sorts by seats left, and does not change its input', () => {
    const before = codes(rows);
    expect(sortRows(rows, 'seats', 'desc')[0].after).toBe(12);
    expect(codes(rows)).toEqual(before);
  });
});

describe('pageOf', () => {
  const xs = Array.from({ length: PAGE_SIZE * 2 + 4 }, (_, i) => i);
  it('slices and clamps', () => {
    expect(pageOf(xs, 0).rows).toHaveLength(PAGE_SIZE);
    expect(pageOf(xs, 2)).toMatchObject({ page: 2, pages: 3 });
    expect(pageOf(xs, 2).rows).toHaveLength(4);
    expect(pageOf(xs, 9).page).toBe(2);
    expect(pageOf([], 3)).toEqual({ rows: [], page: 0, pages: 1 });
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
  it('sorts groups by their shown row', () => {
    const g = groupRows([row('Round 1 Window 1', 900, 'G1'), row('Round 1 Window 1', 100, 'G2')]);
    expect(sortGroups(g, 'median', 'asc').map((x) => x.head.section)).toEqual(['G2', 'G1']);
  });
});

describe('termsToLoad', () => {
  it('defaults to the latest term, loads all newest first, or the one asked for', () => {
    expect(termsToLoad(man, '')).toEqual(['2026-27 Term 2']);
    expect(termsToLoad(man, 'all')).toEqual(['2026-27 Term 2', '2025-26 Term 2']);
    expect(termsToLoad(man, '2025-26 Term 2')).toEqual(['2025-26 Term 2']);
    expect(termsToLoad(man, '1999-00 Term 1')).toEqual([]);
  });
});

describe('url state', () => {
  it('round-trips browse state', () => {
    const st = { ...browseDefaults(), school: 'SOA', term: 'all', instructor: 'ann lee', filled: true, sort: 'median' as const, dir: 'desc' as const, page: 3 };
    expect(decodeBrowse(encodeBrowse(st))).toEqual(st);
    expect(decodeBrowse('')).toEqual(browseDefaults());
    expect(decodeBrowse('bo=nonsense&bp=-4').sort).toBe('course');
    expect(decodeBrowse('bo=nonsense&bp=-4').page).toBe(0);
  });
  it('names its mode in the address: v=browse', () => {
    expect(encodeBrowse(browseDefaults())).toBe('v=browse');
  });
});

describe('fullWindow', () => {
  it('spells out Rnd and Win and leaves full labels alone', () => {
    expect(fullWindow('Incoming Exchange Rnd 1C Win 1')).toBe('Incoming Exchange Round 1C Window 1');
    expect(fullWindow('Round 2A Window 3')).toBe('Round 2A Window 3');
  });
});

describe('fmtSeatsLeft', () => {
  it('uses seat or seats and names the start count', () => {
    expect([fmtSeatsLeft(2, 30), fmtSeatsLeft(1, 30), fmtSeatsLeft(0, 30), fmtSeatsLeft(5, null), fmtSeatsLeft(null, 30)])
      .toEqual(['2 seats left of 30 at start', '1 seat left of 30 at start', '0 seats left of 30 at start', '5 seats left', '–']);
  });
});
