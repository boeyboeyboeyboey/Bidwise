import { describe, expect, it } from 'vitest';
import type { BrowseRow } from '../browse';
import { LINE_COLORS, aggFor, lineFilters, lineLabel, lineLabels, runLines } from './lines';
import { defaultSpec, normalizeSpec, type BuilderSpec } from './spec';

let seq = 0;
const row = (o: Partial<BrowseRow> = {}): BrowseRow => ({
  code: 'IS214', term: '2025-26 Term 1', window: 'Round 1 Window 1', section: `G${++seq}`, instructor: 'ANN LEE', slot: 'Mon 08:15–11:30',
  medianCents: 1000, minCents: 500, vacancy: 40, before: 40, after: 10, filled: false, ...o,
});
const spec = (o: Partial<BuilderSpec>): BuilderSpec => normalizeSpec({ ...defaultSpec(), ...o });

describe('line to filters', () => {
  it('maps the course and each narrowing to an in-filter, in order', () => {
    expect(lineFilters({ course: 'IS214' })).toEqual([{ field: 'course', in: ['IS214'] }]);
    expect(lineFilters({ course: 'IS214', day: 'Mon', band: 'Morning', section: 'G1', instructor: 'ANN LEE' })).toEqual([
      { field: 'course', in: ['IS214'] }, { field: 'day', in: ['Mon'] }, { field: 'band', in: ['Morning'] },
      { field: 'section', in: ['G1'] }, { field: 'instructor', in: ['ANN LEE'] },
    ]);
  });
  it('aggregates bids by median and seats by mean', () => {
    expect(aggFor('median')).toBe('median');
    expect(aggFor('min')).toBe('median');
    expect(['before', 'after', 'taken', 'fillPct'].map(aggFor)).toEqual(['mean', 'mean', 'mean', 'mean']);
  });
});

describe('labels', () => {
  it('names a line by course then narrowing', () => {
    expect(lineLabel({ course: 'IS214' })).toBe('IS214');
    expect(lineLabel({ course: 'IS214', day: 'Mon' })).toBe('IS214 · Mon');
    expect(lineLabel({ course: 'IS214', instructor: 'ANN LEE', day: 'Thu', band: 'Evening' })).toBe('IS214 · Thu · Evening · ANN LEE');
    expect(lineLabel({ course: 'IS214', day: '(none)' })).toBe('IS214 · No time set');
    expect(lineLabel({ course: '' })).toBe('New line');
  });
  it('tells repeated labels apart', () => {
    expect(lineLabels([{ course: 'IS214' }, { course: 'IS216' }, { course: 'IS214' }])).toEqual(['IS214', 'IS216', 'IS214 (2)']);
  });
});

describe('merging lines', () => {
  const rows = [
    row({ term: 'T1', slot: 'Mon 08:15–11:30', medianCents: 1000 }), row({ term: 'T1', slot: 'Mon 08:15–11:30', medianCents: 3000 }),
    row({ term: 'T1', slot: 'Thu 08:15–11:30', medianCents: 5000 }), row({ term: 'T2', slot: 'Thu 08:15–11:30', medianCents: 7000 }),
    row({ term: 'T2', slot: 'Mon 08:15–11:30', medianCents: 2000 }), row({ term: 'T1', code: 'IS216', medianCents: 9000 }),
  ];
  const pts = (r: ReturnType<typeof runLines>) => r.points.map((p) => [p.series, p.x, p.y]);

  it('runs each line with its own filters and tags points with the line label', () => {
    const r = runLines(rows, spec({ x: 'term', lines: [{ course: 'IS214', day: 'Mon' }, { course: 'IS214', day: 'Thu' }] }));
    expect(pts(r)).toEqual([['IS214 · Mon', 'T1', 20], ['IS214 · Mon', 'T2', 20], ['IS214 · Thu', 'T1', 50], ['IS214 · Thu', 'T2', 70]]);
    expect(r.series).toEqual(['IS214 · Mon', 'IS214 · Thu']);
    expect(r.colors.get('IS214 · Thu')).toBe(LINE_COLORS[1]);
  });
  it('compares two courses and unions their x values in the field order', () => {
    const r = runLines(rows, spec({ x: 'term', lines: [{ course: 'IS214' }, { course: 'IS216' }] }));
    expect(r.series).toEqual(['IS214', 'IS216']);
    expect(r.xDomain).toEqual(['T1', 'T2']);
    expect(pts(r).filter((p) => p[0] === 'IS216')).toEqual([['IS216', 'T1', 90]]);
  });
  it('skips a line with no course, and a line with no rows adds no series', () => {
    const r = runLines(rows, spec({ x: 'term', lines: [{ course: '' }, { course: 'NOPE1' }, { course: 'IS216' }] }));
    expect(r.series).toEqual(['IS216']);
    expect(r.colors.get('IS216')).toBe(LINE_COLORS[2]);
    expect(r.totals.rowsIn).toBe(rows.length);
  });
  it('gives a Scatter one point per section, per line', () => {
    const r = runLines(rows, spec({ chart: 'scatter', x: 'vacancy', lines: [{ course: 'IS214', day: 'Thu' }] }));
    expect(r.points).toHaveLength(2);
    expect(r.points.every((p) => p.row && p.series === 'IS214 · Thu')).toBe(true);
  });
});
