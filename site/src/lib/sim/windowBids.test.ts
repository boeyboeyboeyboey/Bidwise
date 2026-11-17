import { describe, expect, it } from 'vitest';
import type { BidWindowData } from '../data/bidLevels';
import type { SimResult } from './index';
import { STYLE_TARGET, bandOf, conditionalMedianCents, levelForWindow, measuredRate, underDelivers } from './windowBids';

const sim = (xs: number[], ys: number[], pFill: number): SimResult => ({
  runs: 1000, pFill, percentilesCents: { p50: 0, p80: 0, p90: 0, p95: 0, p99: 0 },
  histogram: { startCents: xs[0], binWidthCents: 100, counts: [] }, curve: { bidCents: xs, pIn: ys },
});
const cell = (n: number) => ({ cheap: 0.5 + n / 100, balanced: 0.6 + n / 100, safe: 0.7 + n / 100, nFilled: 50 });
const DATA: BidWindowData = {
  levels: { W1: { cheap: { level: 0.5, lossFilled: 0.3 }, balanced: { level: 0.7, lossFilled: 0.15 }, safe: { level: 0.9, lossFilled: 0.1 } } },
  edges: [15, 25, 40, 60],
  measured: { W1: { '0': cell(0), '1': cell(1), '2': cell(2), '3': cell(3), '4': cell(4) } },
};

describe('levelForWindow fallback chain', () => {
  it('window level, else null (pooled)', () => {
    expect(levelForWindow(DATA, 'W1', 'balanced')).toBe(0.7);
    expect(levelForWindow(DATA, 'W2', 'balanced')).toBeNull();
    expect(levelForWindow(DATA, 'W1', 'bold')).toBeNull();
    expect(levelForWindow(DATA, null, 'balanced')).toBeNull();
    expect(levelForWindow(DATA, 'W1', null)).toBeNull();
    expect(levelForWindow(null, 'W1', 'balanced')).toBeNull();
    expect(levelForWindow({ ...DATA, levels: null }, 'W1', 'balanced')).toBeNull();
  });
});

describe('bandOf', () => {
  it('uses the edges as lower bounds of the next band', () => {
    const e = [15, 25, 40, 60];
    expect([0, 1499, 1500, 2499, 2500, 3999, 4000, 5999, 6000, 99999].map((c) => bandOf(e, c))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('conditionalMedianCents', () => {
  it('finds where P(win) reaches 1 - pFill / 2', () => {
    expect(conditionalMedianCents(sim([1000, 2000, 3000], [0.5, 0.75, 1], 0.5))).toBe(2000);
    expect(conditionalMedianCents(sim([1000, 3000], [0.5, 1], 0.5))).toBe(2000); // interpolated
  });
  it('is null when it almost never fills or the curve stops short', () => {
    expect(conditionalMedianCents(sim([1000, 2000], [0.99, 1], 0.019))).toBeNull();
    expect(conditionalMedianCents(sim([1000, 2000], [0.2, 0.6], 0.5))).toBeNull();
  });
});

describe('measuredRate', () => {
  const s20 = sim([1000, 2000, 3000], [0.5, 0.75, 1], 0.5); // conditional median e$20: band 1
  it('reads the cell of the section\'s band, per style', () => {
    expect(measuredRate(DATA, 'W1', s20, 'cheap')).toBeCloseTo(0.51);
    expect(measuredRate(DATA, 'W1', s20, 'safe')).toBeCloseTo(0.71);
  });
  it('is null for missing data, window, band table, style or edges', () => {
    expect(measuredRate(null, 'W1', s20, 'cheap')).toBeNull();
    expect(measuredRate(DATA, 'W2', s20, 'cheap')).toBeNull();
    expect(measuredRate(DATA, 'W1', s20, 'bold')).toBeNull();
    expect(measuredRate({ ...DATA, edges: null }, 'W1', s20, 'cheap')).toBeNull();
    expect(measuredRate({ ...DATA, measured: null }, 'W1', s20, 'cheap')).toBeNull();
    expect(measuredRate({ ...DATA, measured: { W1: { '0': cell(0) } } }, 'W1', s20, 'cheap')).toBeNull();
  });
});

describe('underDelivers', () => {
  it('flags a rate more than 6 points under the style target', () => {
    expect(STYLE_TARGET).toEqual({ cheap: 0.7, balanced: 0.85, safe: 0.9 });
    expect(underDelivers('cheap', 0.63)).toBe(true);
    expect(underDelivers('cheap', 0.65)).toBe(false);
    expect(underDelivers('balanced', 0.78)).toBe(true);
    expect(underDelivers('balanced', 0.8)).toBe(false);
    expect(underDelivers('safe', 0.9)).toBe(false);
    expect(underDelivers('safe', 0.8)).toBe(true);
  });
});
