import { describe, expect, it } from 'vitest';
import { CHART_TYPES, MAX_LINES, decodeSpec, defaultSpec, encodeSpec, normalizeSpec, type BuilderSpec } from './spec';

const full = (): BuilderSpec => ({
  chart: 'bar', x: 'termWindow', y: 'fillPct', more: true,
  lines: [{ course: 'IS214', day: 'Mon' }, { course: 'IS214', day: 'Thu', start: '08:15', section: 'G1', instructor: 'LEE, YUN: A%B' }, { course: 'IS216' }],
});

describe('spec URL', () => {
  it('round-trips the default and a fully set spec', () => {
    expect(decodeSpec(encodeSpec(defaultSpec()))).toEqual(defaultSpec());
    expect(decodeSpec(encodeSpec(full()))).toEqual(full());
  });
  it('round-trips every chart type', () => {
    for (const chart of CHART_TYPES) {
      const s = normalizeSpec({ ...full(), chart });
      expect(decodeSpec(encodeSpec(s))).toEqual(s);
    }
  });
  it('writes only what differs from the defaults, with a version', () => {
    expect(encodeSpec(defaultSpec())).toBe('v=build&kv=2');
    const p = new URLSearchParams(encodeSpec(full()));
    expect(p.get('kt')).toBe('bar');
    expect(p.getAll('kl')).toHaveLength(3);
    expect(p.getAll('kl')[0]).toBe('IS214:Mon:::');
  });
  it('falls back to the defaults for older links and ignores bad values one by one', () => {
    expect(decodeSpec('v=build&kv=1&kx=course&kt=heatmap')).toEqual(defaultSpec());
    expect(decodeSpec('v=build')).toEqual(defaultSpec());
    const s = decodeSpec('v=build&kv=2&kt=box&kx=nope&ky=median&kl=IS214::::&kl=bad');
    expect(s.chart).toBe('line');
    expect(s.x).toBe('term');
    expect(s.lines).toEqual([{ course: 'IS214' }]);
  });
  it('drops the old time-of-day values: an x of band and a Morning narrowing', () => {
    const s = decodeSpec('v=build&kv=2&kx=band&kl=IS214::Morning::&kl=IS216::08%253A15::');
    expect(s.x).toBe('term');
    expect(s.lines).toEqual([{ course: 'IS214' }, { course: 'IS216', start: '08:15' }]);
  });
});

describe('normalizeSpec', () => {
  it('gives a Scatter a number on X and keeps one from a number', () => {
    expect(normalizeSpec({ chart: 'scatter', x: 'term' }).x).toBe('vacancy');
    expect(normalizeSpec({ chart: 'scatter', x: 'median' }).x).toBe('median');
    expect(normalizeSpec({ chart: 'line', x: 'term' }).x).toBe('term');
  });
  it('keeps one to eight lines, upper-cases courses and drops empty narrowing', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ course: `c${i}`, day: ' ' }));
    const s = normalizeSpec({ lines: many });
    expect(s.lines).toHaveLength(MAX_LINES);
    expect(s.lines[0]).toEqual({ course: 'C0' });
    expect(normalizeSpec({ lines: [] }).lines).toEqual([{ course: '' }]);
  });
  it('is idempotent', () => {
    const s = normalizeSpec({ ...full(), chart: 'scatter', x: 'start' });
    expect(normalizeSpec(s)).toEqual(s);
  });
});
