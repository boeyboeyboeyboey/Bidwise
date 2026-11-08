import { describe, expect, it } from 'vitest';
import type { BrowseRow } from '../browse';
import { FIELDS, fieldById, parseSlot, roundOf, shortWindow, subjectOf } from './fields';
import { NONE, OTHER, allowedAggs, applyFilters, coerceAgg, runQuery, valueChoices, type QuerySpec } from './query';

let seq = 0;
const row = (o: Partial<BrowseRow> = {}): BrowseRow => ({
  code: 'ACCT101', term: '2025-26 Term 1', window: 'Round 1 Window 1', section: 'G1', instructor: 'ANN LEE', slot: 'Mon 08:15–11:30',
  medianCents: 1000, minCents: 500, vacancy: 40, before: 40, after: 10, filled: false, ...o, ...(o.section ? {} : { section: `G${++seq}` }),
});
const q = (o: Partial<QuerySpec> = {}): QuerySpec => ({ x: 'window', y: { field: 'median', agg: 'median' }, filters: [], ...o });
const ys = (r: ReturnType<typeof runQuery>) => r.points.map((p) => [p.x, p.y]);

describe('fields', () => {
  it('derives seats taken, fill percentage and subject', () => {
    const r = row({ code: 'COR-ACM2624', before: 40, after: 10 });
    expect(fieldById('taken')!.get(r)).toBe(30);
    expect(fieldById('fillPct')!.get(r)).toBe(75);
    expect(fieldById('subject')!.get(r)).toBe('COR-ACM');
    expect(subjectOf('ACCT101')).toBe('ACCT');
    expect(fieldById('taken')!.get(row({ after: null }))).toBeNull();
    expect(fieldById('fillPct')!.get(row({ before: 0, after: 0 }))).toBeNull();
    expect(fieldById('median')!.get(row({ medianCents: 1250 }))).toBe(12.5);
  });

  it('parses day pattern, earliest start and band from slot text', () => {
    expect(parseSlot('Mon, Thu 12:00–15:15')).toEqual({ days: 'Mon, Thu', start: 720 });
    expect(parseSlot('Thu 08:15–09:45 · Mon 08:15–09:00')).toEqual({ days: 'Mon, Thu', start: 495 });
    expect(parseSlot('')).toEqual({ days: null, start: null });
    expect(fieldById('band')!.get(row({ slot: 'Tue 16:00–19:15' }))).toBe('Evening');
    expect(fieldById('band')!.get(row({ slot: '' }))).toBeNull();
    expect(fieldById('start')!.fmt(495)).toBe('08:15');
  });

  it('maps windows to rounds and short labels', () => {
    expect(roundOf('Round 1A Window 2')).toBe('R1A');
    expect(roundOf('Incoming Exchange Rnd 1C Win 1')).toBe('Exch R1C');
    expect(roundOf('nonsense')).toBeNull();
    expect(shortWindow('Round 2 Window 3')).toBe('R2 W3');
    expect(shortWindow('Incoming Freshmen Rnd 1 Win 2')).toBe('Fresh R1 W2');
  });

  it('orders categories naturally: terms, windows in BOSS order, rounds, sections numerically, days by week', () => {
    const sorted = (id: string, vals: string[]) => [...vals].sort((a, b) => fieldById(id)!.compare(a, b));
    expect(sorted('term', ['2025-26 Term 2', '2024-25 Term 3B', '2024-25 Term 3A', '2024-25 Term 1'])).toEqual(['2024-25 Term 1', '2024-25 Term 3A', '2024-25 Term 3B', '2025-26 Term 2']);
    expect(sorted('window', ['Round 2 Window 1', 'Round 1A Window 1', 'Round 1 Window 2', 'Round 1 Window 1'])).toEqual(['Round 1 Window 1', 'Round 1 Window 2', 'Round 1A Window 1', 'Round 2 Window 1']);
    expect(sorted('round', ['R2A', 'R1B', 'R2', 'R1', 'R1A'])).toEqual(['R1', 'R1A', 'R1B', 'R2', 'R2A']);
    expect(sorted('section', ['G10', 'G2', 'G1'])).toEqual(['G1', 'G2', 'G10']);
    expect(sorted('day', ['Thu', 'Mon, Thu', 'Mon', 'Fri'])).toEqual(['Mon', 'Mon, Thu', 'Thu', 'Fri']);
    expect(sorted('band', ['Evening', 'Morning', 'Afternoon'])).toEqual(['Morning', 'Afternoon', 'Evening']);
  });

  it('has unique ids and the expected kinds', () => {
    expect(new Set(FIELDS.map((f) => f.id)).size).toBe(FIELDS.length);
    expect(fieldById('filled')!.kind).toBe('bool');
    expect(fieldById('median')!.unit).toBe('e$');
  });
});

describe('aggregation', () => {
  const rows = [
    row({ term: 'A', medianCents: 100 }), row({ term: 'A', medianCents: 300 }), row({ term: 'A', medianCents: 900 }),
    row({ term: 'B', medianCents: 200 }), row({ term: 'B', medianCents: 400 }), row({ term: 'B', medianCents: null }),
  ];
  const by = (agg: QuerySpec['y']['agg']) => ys(runQuery(rows, q({ x: 'term', y: { field: 'median', agg } })));
  it('median, mean, min, max, sum, count over non-null values', () => {
    expect(by('median')).toEqual([['A', 3], ['B', 3]]);
    expect(by('mean')).toEqual([['A', (1 + 3 + 9) / 3], ['B', 3]]);
    expect(by('min')).toEqual([['A', 1], ['B', 2]]);
    expect(by('max')).toEqual([['A', 9], ['B', 4]]);
    expect(by('sum')).toEqual([['A', 13], ['B', 6]]);
    expect(by('count')).toEqual([['A', 3], ['B', 2]]);
  });
  it('averages the two middle values for an even count', () => {
    expect(ys(runQuery([row({ medianCents: 100 }), row({ medianCents: 300 })], q()))[0][1]).toBe(2);
  });
  it('keeps n as all rows and ny as rows with a value', () => {
    const p = runQuery(rows, q({ x: 'term' })).points.find((x) => x.x === 'B')!;
    expect([p.n, p.ny]).toEqual([3, 2]);
  });
  it('count of rows ignores nulls; a group with only nulls is dropped and counted', () => {
    expect(ys(runQuery(rows, q({ x: 'term', y: { field: 'count', agg: 'count' } })))).toEqual([['A', 3], ['B', 3]]);
    const r = runQuery([row({ term: 'A', medianCents: null }), row({ term: 'B', medianCents: 100 })], q({ x: 'term' }));
    expect(ys(r)).toEqual([['B', 1]]);
    expect(r.totals.emptyGroups).toBe(1);
  });
  it('pctTrue on a bool, and agg coercion', () => {
    const r = runQuery([row({ filled: true }), row({ filled: false }), row({ filled: false }), row({ filled: true })], q({ x: 'term', y: { field: 'filled', agg: 'pctTrue' } }));
    expect(ys(r)).toEqual([['2025-26 Term 1', 50]]);
    expect(coerceAgg('median', 'pctTrue')).toBe('median');
    expect(coerceAgg('course', 'median')).toBe('count');
    expect(allowedAggs('filled')).toContain('pctTrue');
    expect(allowedAggs('median')).not.toContain('pctTrue');
    // a category y is counted by its non-null values
    expect(ys(runQuery([row({ instructor: 'A' }), row({ instructor: null })], q({ x: 'term', y: { field: 'instructor', agg: 'count' } })))[0][1]).toBe(1);
  });
});

describe('filters', () => {
  const rows = [row({ term: 'A', instructor: 'X', before: 10 }), row({ term: 'B', instructor: null, before: 20 }), row({ term: 'B', instructor: 'Y', before: null })];
  it('in matches raw values and NONE matches missing', () => {
    expect(applyFilters(rows, [{ field: 'term', in: ['B'] }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: 'instructor', in: [NONE] }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'filled', in: ['false'] }])).toHaveLength(3);
  });
  it('min and max are inclusive and drop missing numbers', () => {
    expect(applyFilters(rows, [{ field: 'before', min: 10 }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: 'before', min: 11, max: 20 }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'before', max: 5 }])).toHaveLength(0);
  });
  it('combines with AND; empty in and unknown fields do not restrict', () => {
    expect(applyFilters(rows, [{ field: 'term', in: ['B'] }, { field: 'instructor', in: ['Y'] }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'term', in: [] }, { field: 'nope', in: ['z'] }])).toHaveLength(3);
  });
  it('are applied before aggregation and reported in totals', () => {
    const r = runQuery(rows, q({ x: 'term', filters: [{ field: 'term', in: ['B'] }] }));
    expect(r.totals.rowsIn).toBe(3);
    expect(r.totals.rowsFiltered).toBe(2);
    expect(r.domains.x).toEqual(['B']);
  });
});

describe('binning and numeric x', () => {
  const rows = [row({ before: 3 }), row({ before: 9 }), row({ before: 10 }), row({ before: 24 }), row({ before: null })];
  const count = { field: 'count', agg: 'count' as const };
  it('bins by width, with bin ends, ascending, and drops missing x', () => {
    const r = runQuery(rows, q({ x: 'before', y: count, bin: 10 }));
    expect(r.points.map((p) => [p.x, p.x1, p.y])).toEqual([[0, 10, 2], [10, 20, 1], [20, 30, 1]]);
    expect(r.totals.droppedNullX).toBe(1);
    expect(r.domains.x).toEqual([0, 10, 20]);
  });
  it('without a bin plots exact values; bin is ignored for categories', () => {
    expect(runQuery(rows, q({ x: 'before', y: count })).points.map((p) => p.x)).toEqual([3, 9, 10, 24]);
    expect(runQuery(rows, q({ x: 'term', y: count, bin: 10 })).points[0].x1).toBeUndefined();
  });
  it('handles fractional bins without float noise', () => {
    const r = runQuery([row({ medianCents: 120 }), row({ medianCents: 140 }), row({ medianCents: 170 })], q({ x: 'median', y: count, bin: 0.5 }));
    expect(r.points.map((p) => [p.x, p.y])).toEqual([[1, 2], [1.5, 1]]);
  });
});

describe('colour, facet and ordering', () => {
  const rows = [
    row({ term: '2025-26 Term 2', window: 'Round 2 Window 1', medianCents: 200 }), row({ term: '2025-26 Term 1', window: 'Round 1 Window 1', medianCents: 100 }),
    row({ term: '2025-26 Term 1', window: 'Round 1A Window 1', medianCents: 300, instructor: null }),
  ];
  it('orders x, colour and facet naturally with (none) last', () => {
    const r = runQuery(rows, q({ x: 'window', color: 'instructor', facet: 'term' }));
    expect(r.domains.x).toEqual(['R1 W1', 'R1A W1', 'R2 W1']);
    expect(r.domains.facet).toEqual(['2025-26 Term 1', '2025-26 Term 2']);
    expect(r.domains.color).toEqual(['ANN LEE', NONE]);
    expect(r.points.every((p) => p.color && p.facet)).toBe(true);
  });
  it('sorts a category x by y', () => {
    expect(runQuery(rows, q({ x: 'window', sort: 'yDesc' })).domains.x).toEqual(['R1A W1', 'R2 W1', 'R1 W1']);
    expect(runQuery(rows, q({ x: 'window', sort: 'yAsc' })).points.map((p) => p.x)).toEqual(['R1 W1', 'R2 W1', 'R1A W1']);
  });
  it('groups a bool or number colour by value', () => {
    const r = runQuery([row({ filled: true }), row({ filled: false }), row({ filled: false })], q({ x: 'term', color: 'filled', y: { field: 'count', agg: 'count' } }));
    expect(r.points.map((p) => [p.color, p.y])).toEqual([['Not filled', 2], ['Filled', 1]]);
  });
});

describe('category cap', () => {
  const rows = [
    ...Array.from({ length: 5 }, () => row({ code: 'AAA100', medianCents: 100 })),
    ...Array.from({ length: 3 }, () => row({ code: 'BBB100', medianCents: 200 })),
    row({ code: 'CCC100', medianCents: 600 }), row({ code: 'DDD100', medianCents: 800 }),
  ];
  it('keeps the largest groups, merges the rest into Other (aggregated together, last)', () => {
    const r = runQuery(rows, q({ x: 'course', limit: 2 }));
    expect(ys(r)).toEqual([['AAA100', 1], ['BBB100', 2], [OTHER, 7]]);
    expect(r.points.at(-1)!.n).toBe(2);
    expect(r.totals.capped.x).toBe(2);
  });
  it('does not cap at or under the limit, and caps colour and facet separately', () => {
    expect(runQuery(rows, q({ x: 'course', limit: 4 })).totals.capped.x).toBeUndefined();
    const r = runQuery(rows, q({ x: 'term', color: 'course', colorLimit: 1 }));
    expect(r.domains.color).toEqual(['AAA100', OTHER]);
    expect(r.totals.capped.color).toBe(3);
  });
});

describe('raw mode', () => {
  const rows = [row({ before: 10, medianCents: 100 }), row({ before: 20, medianCents: null }), row({ before: null, medianCents: 300 }), row({ before: 30, medianCents: 500, term: 'Z' })];
  it('returns one point per row and leaves out missing x or y', () => {
    const r = runQuery(rows, q({ x: 'before', y: { field: 'median', agg: 'median' }, raw: true, color: 'term' }));
    expect(r.points.map((p) => [p.x, p.y, p.n])).toEqual([[10, 1, 1], [30, 5, 1]]);
    expect(r.points[0].row).toBe(rows[0]);
    expect(r.totals.droppedNullX).toBe(1);
    expect(r.totals.droppedNullY).toBe(1);
  });
  it('allows category x and samples above maxPoints', () => {
    const many = Array.from({ length: 100 }, (_, i) => row({ medianCents: i * 100 }));
    const r = runQuery(many, q({ x: 'term', raw: true, maxPoints: 10 }));
    expect(r.points).toHaveLength(10);
    expect(r.totals.sampled).toBe(true);
    expect(runQuery(many, q({ x: 'term', raw: true })).totals.sampled).toBe(false);
  });
  it('yields nothing for an unknown field or count', () => {
    expect(runQuery(rows, q({ x: 'nope' })).points).toEqual([]);
    expect(runQuery(rows, q({ raw: true, y: { field: 'count', agg: 'count' } })).points).toEqual([]);
  });
});

describe('valueChoices', () => {
  it('lists distinct values with counts in natural order, missing last', () => {
    const c = valueChoices([row({ section: 'G10' }), row({ section: 'G2' }), row({ section: 'G2' }), row({ instructor: null, section: 'G3' })], 'section');
    expect(c.map((x) => [x.value, x.n])).toEqual([['G2', 2], ['G3', 1], ['G10', 1]]);
    expect(valueChoices([row({ instructor: null }), row()], 'instructor').at(-1)).toMatchObject({ value: NONE, n: 1 });
    expect(valueChoices([row({ filled: true })], 'filled')).toEqual([{ value: 'true', label: 'Filled', n: 1 }]);
  });
});
