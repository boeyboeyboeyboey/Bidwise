import { describe, expect, it } from 'vitest';
import type { BrowseRow } from '../browse';
import { FIELDS, fieldById, parseSlot, shortWindow } from './fields';
import { NONE, applyFilters, runQuery, valueChoices, type QuerySpec } from './query';

let seq = 0;
const row = (o: Partial<BrowseRow> = {}): BrowseRow => ({
  code: 'ACCT101', term: '2025-26 Term 1', window: 'Round 1 Window 1', section: 'G1', instructor: 'ANN LEE', slot: 'Mon 08:15–11:30',
  medianCents: 1000, minCents: 500, vacancy: 40, before: 40, after: 10, filled: false, ...o, ...(o.section ? {} : { section: `G${++seq}` }),
});
const q = (o: Partial<QuerySpec> = {}): QuerySpec => ({ x: 'window', y: 'median', agg: 'median', filters: [], ...o });
const ys = (r: ReturnType<typeof runQuery>) => r.points.map((p) => [p.x, p.y]);

describe('fields', () => {
  it('derives seats taken and % filled; bids are in e$', () => {
    const r = row({ before: 40, after: 10 });
    expect(fieldById('taken')!.get(r)).toBe(30);
    expect(fieldById('fillPct')!.get(r)).toBe(75);
    expect(fieldById('taken')!.get(row({ after: null }))).toBeNull();
    expect(fieldById('fillPct')!.get(row({ before: 0, after: 0 }))).toBeNull();
    expect(fieldById('median')!.get(row({ medianCents: 1250 }))).toBe(12.5);
  });

  it('parses day pattern, earliest start and time of day from slot text', () => {
    expect(parseSlot('Mon, Thu 12:00–15:15')).toEqual({ days: 'Mon, Thu', start: 720 });
    expect(parseSlot('Thu 08:15–09:45 · Mon 08:15–09:00')).toEqual({ days: 'Mon, Thu', start: 495 });
    expect(parseSlot('')).toEqual({ days: null, start: null });
    expect(fieldById('start')!.get(row({ slot: 'Tue 16:00–19:15' }))).toBe('16:00');
    expect(fieldById('start')!.get(row({ slot: '' }))).toBeNull();
  });

  it('shortens windows and joins term with window', () => {
    expect(shortWindow('Round 2 Window 3')).toBe('R2 W3');
    expect(shortWindow('Incoming Freshmen Rnd 1 Win 2')).toBe('Fresh R1 W2');
    const tw = fieldById('termWindow')!;
    expect(tw.get(row())).toBe('2025-26 Term 1 · Round 1 Window 1');
    expect(tw.fmt(tw.get(row())!)).toBe('2025-26 Term 1 · R1 W1');
    expect(tw.get(row({ window: '' }))).toBeNull();
  });

  it('orders categories naturally: terms, windows in BOSS order, term × window, sections numerically, days by week', () => {
    const sorted = (id: string, vals: string[]) => [...vals].sort((a, b) => fieldById(id)!.compare(a, b));
    expect(sorted('term', ['2025-26 Term 2', '2024-25 Term 3B', '2024-25 Term 3A', '2024-25 Term 1'])).toEqual(['2024-25 Term 1', '2024-25 Term 3A', '2024-25 Term 3B', '2025-26 Term 2']);
    expect(sorted('window', ['Round 2 Window 1', 'Round 1A Window 1', 'Round 1 Window 2', 'Round 1 Window 1'])).toEqual(['Round 1 Window 1', 'Round 1 Window 2', 'Round 1A Window 1', 'Round 2 Window 1']);
    expect(sorted('termWindow', ['B · Round 1 Window 1', 'A · Round 2 Window 1', 'A · Round 1 Window 2'])).toEqual(['A · Round 1 Window 2', 'A · Round 2 Window 1', 'B · Round 1 Window 1']);
    expect(sorted('section', ['G10', 'G2', 'G1'])).toEqual(['G1', 'G2', 'G10']);
    expect(sorted('day', ['Thu', 'Mon, Thu', 'Mon', 'Fri'])).toEqual(['Mon', 'Mon, Thu', 'Thu', 'Fri']);
    expect(sorted('start', ['19:00', '08:15', '12:00'])).toEqual(['08:15', '12:00', '19:00']);
  });

  it('has unique ids', () => {
    expect(new Set(FIELDS.map((f) => f.id)).size).toBe(FIELDS.length);
  });
});

describe('aggregation', () => {
  const rows = [
    row({ term: 'A', medianCents: 100 }), row({ term: 'A', medianCents: 300 }), row({ term: 'A', medianCents: 900 }),
    row({ term: 'B', medianCents: 200 }), row({ term: 'B', medianCents: 400 }), row({ term: 'B', medianCents: null }),
  ];
  it('median and mean over non-null values, keeping n and ny apart', () => {
    expect(ys(runQuery(rows, q({ x: 'term' })))).toEqual([['A', 3], ['B', 3]]);
    expect(ys(runQuery(rows, q({ x: 'term', agg: 'mean' })))).toEqual([['A', (1 + 3 + 9) / 3], ['B', 3]]);
    const b = runQuery(rows, q({ x: 'term' })).points[1];
    expect([b.n, b.ny]).toEqual([3, 2]);
  });
  it('averages the two middle values for an even count', () => {
    expect(ys(runQuery([row({ medianCents: 100 }), row({ medianCents: 300 })], q()))[0][1]).toBe(2);
  });
  it('drops a group with no value and counts it', () => {
    const r = runQuery([row({ term: 'A', medianCents: null }), row({ term: 'B' })], q({ x: 'term' }));
    expect(ys(r)).toEqual([['B', 10]]);
    expect(r.totals.emptyGroups).toBe(1);
  });
  it('yields nothing for an unknown field or a category y', () => {
    expect(runQuery(rows, q({ x: 'nope' })).points).toEqual([]);
    expect(runQuery(rows, q({ y: 'term' })).points).toEqual([]);
  });
});

describe('filters and numeric x', () => {
  const rows = [row({ section: 'G1', slot: '' }), row({ section: 'G2' }), row({ section: 'G3', code: 'LAW101' })];
  it('in matches values, and (none) matches a missing one', () => {
    expect(applyFilters(rows, [{ field: 'section', in: ['G2', 'G3'] }])).toHaveLength(2);
    expect(applyFilters(rows, [{ field: 'day', in: [NONE] }]).map((r) => r.section)).toEqual(['G1']);
  });
  it('combines with AND; empty in and unknown fields do not restrict', () => {
    expect(applyFilters(rows, [{ field: 'course', in: ['ACCT101'] }, { field: 'day', in: ['Mon'] }]).map((r) => r.section)).toEqual(['G2']);
    expect(applyFilters(rows, [{ field: 'course', in: [] }, { field: 'nope', in: ['x'] }])).toHaveLength(3);
  });
  it('plots a numeric x at its exact value, ascending, and drops a missing x', () => {
    const r = runQuery([row({ vacancy: 50 }), row({ vacancy: 20 }), row({ vacancy: 20, medianCents: 3000 }), row({ vacancy: null })], q({ x: 'vacancy' }));
    expect(ys(r)).toEqual([[20, 20], [50, 10]]);
    expect(r.totals.droppedNullX).toBe(1);
  });
  it('orders categories with (none) last', () => {
    const r = runQuery([row({ slot: '' }), row({ slot: 'Thu 08:15–11:30' }), row({ slot: 'Mon 08:15–11:30' })], q({ x: 'day' }));
    expect(r.xDomain).toEqual(['Mon', 'Thu', 'No time set']);
  });
});

describe('raw mode', () => {
  it('returns one point per row and leaves out missing x or y', () => {
    const rows = [row({ vacancy: 10, medianCents: 100 }), row({ vacancy: 10, medianCents: 200 }), row({ vacancy: null }), row({ vacancy: 30, medianCents: null })];
    const r = runQuery(rows, q({ x: 'vacancy', raw: true }));
    expect(r.points.map((p) => [p.x, p.y])).toEqual([[10, 1], [10, 2]]);
    expect(r.points[0].row).toBe(rows[0]);
    expect([r.totals.droppedNullX, r.totals.droppedNullY]).toEqual([1, 1]);
  });
  it('samples above maxPoints', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ vacancy: i }));
    const r = runQuery(rows, q({ x: 'vacancy', raw: true, maxPoints: 4 }));
    expect(r.totals.sampled).toBe(true);
    expect(r.points.length).toBeLessThanOrEqual(4);
  });
});

describe('valueChoices', () => {
  it('lists distinct values with counts in natural order, missing last', () => {
    const rows = [row({ section: 'G10' }), row({ section: 'G2' }), row({ section: 'G2' }), row({ slot: '', section: 'G3' })];
    expect(valueChoices(rows, 'section').map((c) => [c.value, c.n])).toEqual([['G2', 2], ['G3', 1], ['G10', 1]]);
    expect(valueChoices(rows, 'day').map((c) => c.label)).toEqual(['Mon', 'No time set']);
    expect(valueChoices(rows, 'day')[1].value).toBe(NONE);
  });
});
