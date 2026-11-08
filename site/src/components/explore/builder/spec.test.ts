import { describe, expect, it } from 'vitest';
import { CHART_TYPES, chartNeedsRaw, decodeSpec, defaultSpec, encodeSpec, normalizeSpec, type BuilderSpec } from './spec';

const rt = (s: Partial<BuilderSpec>) => decodeSpec(encodeSpec(s));

describe('spec URL', () => {
  it('round-trips the default and a fully set spec', () => {
    expect(rt(defaultSpec())).toEqual(defaultSpec());
    const full: BuilderSpec = {
      x: 'before', y: { field: 'filled', agg: 'pctTrue' }, color: 'term', facet: 'round', bin: 5, chart: 'dot', raw: true, sort: 'yDesc',
      limit: 12, colorLimit: 5, facetLimit: 6, log: true, zero: false, swap: true,
      filters: [{ field: 'term', in: ['2025-26 Term 1', '2024-25 Term 3A'] }, { field: 'median', min: 1.5, max: 80 }, { field: 'instructor', in: ['LEE, YUN', 'A:B,C', '(none)'], min: undefined }],
    };
    const back = rt(full);
    expect(back).toEqual(normalizeSpec(full));
    expect(back.filters[2].in).toEqual(['LEE, YUN', 'A:B,C', '(none)']);
    expect(rt(back)).toEqual(back);
  });

  it('round-trips every chart type', () => {
    for (const chart of CHART_TYPES) {
      const s = normalizeSpec({ ...defaultSpec(), chart, color: 'subject' });
      expect(rt(s)).toEqual(s);
    }
  });

  it('writes only what differs from the defaults, with a version', () => {
    expect(encodeSpec(defaultSpec())).toBe('v=build&kv=1');
    const p = new URLSearchParams(encodeSpec({ ...defaultSpec(), chart: 'line' }));
    expect([...p.keys()].sort()).toEqual(['kt', 'kv', 'v']);
  });

  it('ignores unknown values one by one and unknown versions altogether', () => {
    const s = decodeSpec('kv=1&kx=bogus&ky=median&ka=sorcery&kt=pie&kc=nope&kb=-3&kw=bogus:a::&kw=term:2025-26%2520Term%25201::&kw=garbage&kn=0&zzz=1');
    expect(s.x).toBe(defaultSpec().x);
    expect(s.y).toEqual({ field: 'median', agg: 'median' });
    expect(s.chart).toBe('bar');
    expect(s.color).toBeUndefined();
    expect(s.bin).toBeUndefined();
    expect(s.limit).toBeUndefined();
    expect(s.filters).toEqual([{ field: 'term', in: ['2025-26 Term 1'] }]);
    expect(decodeSpec('kv=9&kx=term')).toEqual(defaultSpec());
    expect(decodeSpec('')).toEqual(defaultSpec());
  });
});

describe('normalizeSpec', () => {
  it('makes raw follow the chart and agg follow the field', () => {
    expect(chartNeedsRaw('scatter')).toBe(true);
    expect(normalizeSpec({ chart: 'scatter' }).raw).toBe(true);
    expect(normalizeSpec({ chart: 'bar', raw: true }).raw).toBeUndefined();
    expect(normalizeSpec({ chart: 'table', raw: true }).raw).toBe(true);
    expect(normalizeSpec({ y: { field: 'course', agg: 'median' } }).y).toEqual({ field: 'course', agg: 'count' });
    expect(normalizeSpec({ y: { field: 'median', agg: 'pctTrue' } }).y.agg).toBe('median');
  });
  it('keeps bin only for a numeric x and drops empty filters', () => {
    expect(normalizeSpec({ x: 'term', bin: 5 }).bin).toBeUndefined();
    expect(normalizeSpec({ x: 'before', bin: 5 }).bin).toBe(5);
    expect(normalizeSpec({ filters: [{ field: 'term', in: [] }, { field: 'median', min: NaN }] }).filters).toEqual([]);
  });
  it('is idempotent', () => {
    const s = normalizeSpec({ chart: 'box', x: 'bogus', color: 'term', limit: 30, filters: [{ field: 'term', in: ['a', 'a'] }] });
    expect(normalizeSpec(s)).toEqual(s);
    expect(s.filters[0].in).toEqual(['a']);
  });
});
