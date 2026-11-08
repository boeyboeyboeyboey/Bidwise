import { describe, expect, it } from 'vitest';
import type { BrowseRow } from '../browse';
import { chipFilters, filterSummary, removeFilter, searchChoices, setFilterRange, setFilterValues, toggleFilterValue } from './filters';
import { PRESETS, applyPreset } from './presets';
import { MAX_SAVED, SAVED_KEY, deleteChart, loadSaved, saveChart } from './saved';
import { csvCell, resultCsv, resultTable } from './table';
import { runQuery, valueChoices } from './query';
import { yLabel } from './plan';
import { decodeSpec, defaultSpec, encodeSpec, longTerm, normalizeSpec, shortTerm, type BuilderSpec } from './spec';

const row = (o: Partial<BrowseRow>): BrowseRow => ({
  code: 'ACCT101', term: '2025-26 Term 1', window: 'Round 1 Window 1', section: 'G1', instructor: 'ANN LEE', slot: 'Mon 08:15–11:30',
  medianCents: 1000, minCents: 500, vacancy: 40, before: 40, after: 10, filled: false, ...o,
});

describe('filter chips', () => {
  it('maps chips to spec filters, leaving the term filter alone', () => {
    let s: BuilderSpec = normalizeSpec({ filters: [{ field: 'term', in: ['a', 'b'] }] });
    s = toggleFilterValue(s, 'course', 'ACCT101');
    s = toggleFilterValue(s, 'course', 'LAW101');
    s = setFilterRange(s, 'median', '20', '80');
    expect(chipFilters(s)).toEqual([{ field: 'course', in: ['ACCT101', 'LAW101'] }, { field: 'median', min: 20, max: 80 }]);
    expect(s.filters.find((f) => f.field === 'term')?.in).toEqual(['a', 'b']);
    expect(filterSummary(chipFilters(s)[0])).toBe('Course: 2');
    expect(filterSummary(chipFilters(s)[1])).toBe('Median bid 20–80');
    s = toggleFilterValue(s, 'course', 'LAW101');
    expect(filterSummary(chipFilters(s)[0])).toBe('Course: ACCT101');
    s = removeFilter(removeFilter(s, 'course'), 'median');
    expect(chipFilters(s)).toEqual([]);
  });
  it('treats empty values and open ranges as no filter, and one-sided ranges as such', () => {
    const s = defaultSpec();
    expect(setFilterValues(s, 'course', []).filters).toEqual([]);
    expect(setFilterRange(s, 'median', '', 'abc').filters).toEqual([]);
    expect(filterSummary(setFilterRange(s, 'median', '5', '').filters[0])).toBe('Median bid ≥ 5');
    expect(filterSummary(setFilterValues(s, 'filled', ['true']).filters[0])).toBe('Filled: Yes');
  });
  it('filters the chart and searches choices by code', () => {
    const rows = [row({ section: 'G1' }), row({ section: 'G2', code: 'LAW101' }), row({ section: 'G3', code: 'LAW201' })];
    const s = setFilterValues(defaultSpec(), 'course', ['LAW101']);
    expect(runQuery(rows, s).totals.rowsPlotted).toBe(1);
    const ch = [{ value: 'ACCT101', label: 'ACCT101' }, { value: 'LAW101', label: 'LAW101' }, { value: 'LAW201', label: 'LAW201' }];
    expect(searchChoices(ch, 'law', ['LAW201']).shown.map((c) => c.value)).toEqual(['LAW201', 'LAW101']);
    expect(searchChoices(ch, 'x', []).total).toBe(0);
    expect(searchChoices(ch, '', [], 2).shown).toHaveLength(2);
  });
});

describe('presets', () => {
  it('are valid specs that normalizing leaves unchanged', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of PRESETS) expect(normalizeSpec(p.spec)).toEqual(p.spec);
    expect(PRESETS.filter((p) => p.needsCourse).map((p) => p.id)).toEqual(['instructor']);
  });
  it('keep the current filters', () => {
    const cur = setFilterValues(defaultSpec(), 'course', ['ACCT101']);
    expect(applyPreset(cur, PRESETS[0]).filters).toEqual(cur.filters);
    expect(applyPreset(cur, PRESETS[0]).x).toBe('band');
  });
});

describe('saved charts', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  it('saves newest first, replaces a name, deletes, and reads back normalized specs', () => {
    const st = mem();
    saveChart('a', defaultSpec(), st);
    saveChart('b', { ...defaultSpec(), chart: 'line' }, st);
    saveChart('a', { ...defaultSpec(), x: 'band' }, st);
    expect(loadSaved(st).map((c) => c.name)).toEqual(['a', 'b']);
    expect(loadSaved(st)[0].spec.x).toBe('band');
    expect(deleteChart('a', st).map((c) => c.name)).toEqual(['b']);
    st.m.set(SAVED_KEY, JSON.stringify([{ name: 'x', spec: { chart: 'pie', x: 'bogus' } }, { nope: 1 }]));
    expect(loadSaved(st)).toEqual([{ name: 'x', spec: defaultSpec() }]);
    st.m.set(SAVED_KEY, '{not json');
    expect(loadSaved(st)).toEqual([]);
  });
  it('caps at 20 and rejects empty names', () => {
    const st = mem();
    for (let i = 0; i < MAX_SAVED; i++) expect(saveChart(`c${i}`, defaultSpec(), st).ok).toBe(true);
    const r = saveChart('one more', defaultSpec(), st);
    expect(r.ok === false && r.reason).toBe('full');
    expect(loadSaved(st)).toHaveLength(MAX_SAVED);
    expect(saveChart('c3', defaultSpec(), st).ok).toBe(true);
    expect(saveChart('  ', defaultSpec(), st)).toMatchObject({ ok: false, reason: 'name' });
  });
  it('survives storage that throws or is missing', () => {
    expect(loadSaved(bad)).toEqual([]);
    expect(saveChart('a', defaultSpec(), bad)).toMatchObject({ ok: false, reason: 'storage' });
    expect(deleteChart('a', bad)).toEqual([]);
    expect(saveChart('a', defaultSpec(), null)).toMatchObject({ ok: false, reason: 'storage' });
  });
});

describe('CSV of the aggregated result', () => {
  const rows = [row({ section: 'G1', medianCents: 1000 }), row({ section: 'G2', medianCents: 2000 }), row({ section: 'G3', window: 'Round 2 Window 1', medianCents: 3000, instructor: 'A, "B"' })];
  it('has one line per plotted point with a header', () => {
    const s = normalizeSpec({ x: 'window', color: 'instructor' });
    const csv = resultCsv(s, runQuery(rows, s));
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Window,Instructor,Median bid (e$),n');
    expect(lines).toHaveLength(1 + runQuery(rows, s).points.length);
    expect(lines.join('\n')).toContain('"A, ""B"""');
    expect(csv).not.toContain('G1');
  });
  it('refuses CSV in raw mode, the table stays uncapped', () => {
    const s = normalizeSpec({ chart: 'scatter', x: 'before' });
    const r = runQuery(rows, s);
    expect(resultTable(s, r, 1).more).toBe(2);
    expect(resultCsv(s, r)).toBe('');
  });
  it('defuses formulas but keeps negative numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-5')).toBe('-5');
    expect(csvCell('+65 1234')).toBe("'+65 1234");
    expect(csvCell('@x')).toBe("'@x");
  });
});

describe('compact URL', () => {
  const terms = ['2022-23 Term 1', '2022-23 Term 2', '2023-24 Term 3A', '2025-26 Term 1'];
  it('shortens terms and does not double-encode', () => {
    expect(shortTerm('2025-26 Term 3A')).toBe('2526T3A');
    expect(longTerm('2526T3A')).toBe('2025-26 Term 3A');
    expect(longTerm('2025-26 Term 1')).toBe('2025-26 Term 1');
    const s = normalizeSpec({ filters: [{ field: 'term', in: terms }] });
    const q = encodeSpec(s);
    expect(q).not.toContain('%25');
    expect(q).not.toContain('Term');
    expect(q.length).toBeLessThan(80);
    expect(decodeSpec(q)).toEqual(s);
  });
  it('round-trips awkward values', () => {
    const s = normalizeSpec({ filters: [{ field: 'instructor', in: ['LEE, YUN', 'A:B|C%D', '(none)'] }, { field: 'median', min: 2, max: 9.5 }] });
    expect(decodeSpec(encodeSpec(s))).toEqual(s);
  });
  it('still decodes old links (kw, values escaped twice, full term names)', () => {
    const old = 'v=build&kv=1&kw=term%3A2025-26%2520Term%25201%2C2024-25%2520Term%25203A%3A%3A&kw=instructor%3ALEE%252C%2520YUN%252CX%3A%3A';
    const s = decodeSpec(old);
    expect(s.filters).toEqual([{ field: 'term', in: ['2025-26 Term 1', '2024-25 Term 3A'] }, { field: 'instructor', in: ['LEE, YUN,X'] }]);
  });
});

describe('chart builder review fixes', () => {
  it('the median-by-round preset charts rounds, not windows', () => {
    expect(PRESETS.find((p) => p.id === 'round')?.spec.x).toBe('round');
  });

  it('a raw chart gives no CSV, an aggregated one does', () => {
    const rows = [row({})];
    const raw = runQuery(rows, { x: 'vacancy', y: { field: 'median', agg: 'median' }, filters: [], raw: true });
    expect(resultCsv(normalizeSpec({ x: 'vacancy', y: { field: 'median', agg: 'median' }, chart: 'scatter' }), raw)).toBe('');
    const agg = runQuery(rows, { x: 'term', y: { field: 'median', agg: 'median' }, filters: [] });
    expect(resultCsv(normalizeSpec({ x: 'term', y: { field: 'median', agg: 'median' }, chart: 'bar' }), agg)).not.toBe('');
  });

  it('"No time set" labels a missing time, and filters still match it as (none)', () => {
    const rows = [row({ slot: '' }), row({ slot: 'Mon 08:15–11:30' })];
    expect(valueChoices(rows, 'band').find((c) => c.value === '(none)')?.label).toBe('No time set');
    const q = { x: 'band', y: { field: 'median', agg: 'median' as const }, filters: [] };
    expect(runQuery(rows, q).points.map((p) => p.x)).toContain('No time set');
    expect(runQuery(rows, { ...q, filters: [{ field: 'band', in: ['(none)'] }] }).totals.rowsFiltered).toBe(1);
  });

  it('CSV defuses a formula-like "+1+1" but leaves plain numbers', () => {
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-3.5')).toBe('-3.5');
    expect(csvCell('+12')).toBe('+12');
  });

  it('the y label drops an aggregate word the field label already has', () => {
    expect(yLabel(normalizeSpec({ x: 'term', y: { field: 'median', agg: 'median' } }))).toBe('Median bid (e$)');
    expect(yLabel(normalizeSpec({ x: 'term', y: { field: 'min', agg: 'min' } }))).toBe('Lowest bid, min (e$)');
  });
});
