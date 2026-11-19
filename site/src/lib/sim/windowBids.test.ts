import { describe, expect, it } from 'vitest';
import type { BidWindowData } from '../data/bidLevels';
import type { SimResult } from './index';
import { STYLE_TARGET, styleIndexOf, bandOf, belowAim, bidClaims, conditionalMedianCents, levelForWindow, measuredCell, measuredRate, reachedForWindow, type ClaimInput, type MeasuredCell } from './windowBids';

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

describe('belowAim effCourses is compared unrounded (H10)', () => {
  const cell = (effCourses: number) => ({ rate: 0.5, upper: 0.6, nCourses: 30, effCourses });
  it('course sizes 11, 22 and 28 courses of 4 give 19.96676, which fails the 20 threshold; it used to ship as 20.0', () => {
    const sizes = [11, 22, ...Array(28).fill(4)] as number[];
    const total = sizes.reduce((a, b) => a + b, 0);
    const eff = (total * total) / sizes.reduce((a, b) => a + b * b, 0);
    expect(eff).toBeCloseTo(19.96676, 5);
    expect(belowAim('balanced', cell(eff))).toBe(false);
    expect(belowAim('balanced', cell(Math.round(eff * 10) / 10))).toBe(true); // the rounded value would have passed
    expect(belowAim('balanced', cell(20))).toBe(true);
  });
});

describe('styleIndexOf', () => {
  it('maps the calibrated and the uncalibrated keys to the same positions, anything else to -1', () => {
    expect(['cheap', 'balanced', 'safe'].map(styleIndexOf)).toEqual([0, 1, 2]);
    expect(['t80', 't90', 't95'].map(styleIndexOf)).toEqual([0, 1, 2]);
    expect([0.9, 'x', '', 'Balanced', 'constructor', null, undefined].map(styleIndexOf)).toEqual(Array(7).fill(-1));
  });
});

describe('belowAim', () => {
  // a cell that passes the course-count guard; each test changes one thing
  const ok = (upper: number | null | undefined, extra: Record<string, unknown> = {}) => ({ rate: 0.5, upper, nCourses: 30, effCourses: 20, ...extra });
  it('judges the upper bound against the style target minus 3 points', () => {
    expect(STYLE_TARGET).toEqual({ cheap: 0.7, balanced: 0.85, safe: 0.9 });
    expect(belowAim('cheap', ok(0.66))).toBe(true);
    expect(belowAim('cheap', ok(0.67))).toBe(false); // exactly 3 points under is not below
    expect(belowAim('cheap', ok(0.68))).toBe(false);
    expect(belowAim('balanced', ok(0.81))).toBe(true);
    expect(belowAim('balanced', ok(0.82))).toBe(false);
    expect(belowAim('safe', ok(0.86))).toBe(true);
    expect(belowAim('safe', ok(0.87))).toBe(false);
  });
  it('never says so without an upper bound', () => {
    expect(belowAim('safe', ok(null))).toBe(false);
    expect(belowAim('safe', ok(undefined))).toBe(false);
    expect(belowAim('safe', null)).toBe(false);
    expect(belowAim('safe', undefined)).toBe(false);
  });
  it('fails closed when the course count is missing or under 30', () => {
    expect(belowAim('safe', { rate: 0.5, upper: 0.8, effCourses: 25 })).toBe(false);
    expect(belowAim('safe', ok(0.8, { nCourses: 29 }))).toBe(false);
    expect(belowAim('safe', ok(0.8, { nCourses: 30 }))).toBe(true);
    expect(belowAim('safe', ok(0.8, { nCourses: undefined }))).toBe(false);
    expect(belowAim('safe', ok(0.8, { nCourses: NaN }))).toBe(false);
  });
  it('fails closed when the effective course count is missing or under 20', () => {
    expect(belowAim('safe', { rate: 0.5, upper: 0.8, nCourses: 40 })).toBe(false);
    expect(belowAim('safe', ok(0.8, { effCourses: 19.9 }))).toBe(false);
    expect(belowAim('safe', ok(0.8, { effCourses: 20 }))).toBe(true);
  });
  it('needs a non-degenerate interval: an upper bound equal to the rate is not below', () => {
    expect(belowAim('cheap', { rate: 0.6, upper: 0.6, nCourses: 40, effCourses: 25 })).toBe(false);
    expect(belowAim('cheap', { rate: 0.6, upper: 0.65, nCourses: 40, effCourses: 25 })).toBe(true);
  });
  it('is false for a missing cell', () => {
    expect(belowAim('cheap', null)).toBe(false);
    expect(belowAim('cheap', undefined)).toBe(false);
  });
});

describe('measuredCell', () => {
  const s20 = sim([1000, 2000, 3000], [0.5, 0.75, 1], 0.5); // conditional median e$20: band 1
  it('carries the count, source and the style\'s own upper bound', () => {
    const d: BidWindowData = { ...DATA, measured: { W1: { ...DATA.measured!.W1, '1': { ...cell(1), source: 'group', upper: { cheap: 0.6, balanced: 0.7, safe: null } } } } };
    expect(measuredCell(d, 'W1', s20, 'balanced')).toEqual({ rate: 0.61, nFilled: 50, source: 'group', upper: 0.7 });
    expect(measuredCell(d, 'W1', s20, 'safe')?.upper).toBeNull();
  });
  it('carries the course counts when the build has them', () => {
    const d: BidWindowData = { ...DATA, measured: { W1: { ...DATA.measured!.W1, '1': { ...cell(1), upper: { cheap: 0.6, balanced: 0.7, safe: null }, nCourses: 40, effCourses: 25.5 } } } };
    expect(measuredCell(d, 'W1', s20, 'balanced')).toEqual({ rate: 0.61, nFilled: 50, upper: 0.7, nCourses: 40, effCourses: 25.5 });
  });
  it('old data (no source, no upper) still gives the rate and count', () => {
    expect(measuredCell(DATA, 'W1', s20, 'cheap')).toEqual({ rate: 0.51, nFilled: 50, upper: null });
  });
  it('is null on the same conditions as measuredRate', () => {
    expect(measuredCell(null, 'W1', s20, 'cheap')).toBeNull();
    expect(measuredCell(DATA, 'W2', s20, 'cheap')).toBeNull();
    expect(measuredCell(DATA, 'W1', sim([1000, 2000], [0.99, 1], 0.019), 'cheap')).toBeNull();
  });
});

describe('reachedForWindow', () => {
  const d: BidWindowData = { ...DATA, levels: { W1: { cheap: { level: 0.5, lossFilled: 0.3, reached: false }, balanced: { level: 0.7, lossFilled: 0.15, reached: true }, safe: { level: 0.9, lossFilled: 0.1 } } } };
  it('is the flag, or null when unknown', () => {
    expect(reachedForWindow(d, 'W1', 'cheap')).toBe(false);
    expect(reachedForWindow(d, 'W1', 'balanced')).toBe(true);
    expect(reachedForWindow(d, 'W1', 'safe')).toBeNull();
    expect(reachedForWindow(d, 'W2', 'cheap')).toBeNull();
    expect(reachedForWindow(null, 'W1', 'cheap')).toBeNull();
  });
});

describe('bidClaims', () => {
  // with an upper bound the cell also carries the course counts, as the build ships them
  const cellOf = (rate: number, upper: number | null = null, source?: MeasuredCell['source']): MeasuredCell => ({
    rate, nFilled: 80, upper, ...(upper === null ? {} : { nCourses: 40, effCourses: 25 }), ...(source ? { source } : {}),
  });
  const base: ClaimInput = { group: 1, calibrated: true, rec: 3501, minBid: 1000, style: 'balanced', tied: ['balanced'], cells: { balanced: cellOf(0.8, 0.83, 'cell') }, reached: { balanced: true } };
  it('group of 2 or more: nothing but the hidden flag', () => {
    const c = bidClaims({ ...base, group: 2, tied: ['balanced', 'safe'], reached: { balanced: false } });
    expect(c).toEqual({ groupHidden: true, floor: false, past: [], unreached: [], sameAs: [] });
  });
  it('floor: at the minimum or one cent above, no past rate, but an unreached aim is still reported', () => {
    for (const rec of [1000, 1001]) {
      const c = bidClaims({ ...base, rec, reached: { balanced: false } });
      expect(c.floor).toBe(true);
      expect(c.past).toEqual([]);
      expect(c.unreached).toEqual(['balanced']);
    }
    expect(bidClaims({ ...base, rec: 1002 }).floor).toBe(false);
  });
  it('floor applies without the calibration too', () => {
    expect(bidClaims({ ...base, calibrated: false, style: null, rec: 1001 }).floor).toBe(true);
    expect(bidClaims({ ...base, calibrated: false, style: null, rec: 5000 })).toEqual({ groupHidden: false, floor: false, past: [], unreached: [], sameAs: [] });
  });
  it('above the floor with an upper bound: below aim only when the bound is under target - 3 points', () => {
    expect(bidClaims({ ...base, cells: { balanced: cellOf(0.75, 0.81) } }).past[0].belowAim).toBe(true);
    expect(bidClaims({ ...base, cells: { balanced: cellOf(0.75, 0.82) } }).past[0].belowAim).toBe(false);
  });
  it('an upper bound under target from too few courses is not below aim', () => {
    const thin: MeasuredCell = { ...cellOf(0.75, 0.81), nCourses: 29 };
    expect(bidClaims({ ...base, cells: { balanced: thin } }).past[0].belowAim).toBe(false);
    expect(bidClaims({ ...base, cells: { balanced: { ...cellOf(0.75, 0.81), effCourses: 19.9 } } }).past[0].belowAim).toBe(false);
  });
  it('above the floor without an upper bound: rate and count, no judgement, whatever the rate', () => {
    const c = bidClaims({ ...base, cells: { balanced: cellOf(0.3) } });
    expect(c.past).toEqual([{ styles: ['balanced'], rate: 0.3, nFilled: 80, belowAim: false }]);
  });
  it('carries the source through, and leaves it out when the build has none', () => {
    expect(bidClaims(base).past[0].source).toBe('cell');
    expect('source' in bidClaims({ ...base, cells: { balanced: cellOf(0.8) } }).past[0]).toBe(false);
  });
  it('no measured cell: no past line', () => {
    expect(bidClaims({ ...base, cells: { balanced: null } }).past).toEqual([]);
    expect(bidClaims({ ...base, cells: {} }).past).toEqual([]);
  });
  it('tied styles with the same rate and count share one line, so no "same as" is needed', () => {
    const t = ['balanced', 'safe'] as const;
    const c = bidClaims({ ...base, tied: [...t], cells: { balanced: cellOf(0.79, 0.95, 'cell'), safe: cellOf(0.79, 0.95, 'cell') } });
    expect(c.past).toEqual([{ styles: ['balanced', 'safe'], rate: 0.79, nFilled: 80, source: 'cell', belowAim: false }]);
    expect(c.sameAs).toEqual([]);
    expect(bidClaims({ ...base, style: 'safe', tied: [...t], cells: { balanced: cellOf(0.79), safe: cellOf(0.79) } }).sameAs).toEqual([]);
  });
  it('tied styles are judged each with their own target; a split judgement keeps separate lines and "same as"', () => {
    // upper 0.86 is under Safe's 0.9 - 0.03 but not under Balanced's 0.85 - 0.03
    const c = bidClaims({ ...base, tied: ['balanced', 'safe'], cells: { balanced: cellOf(0.8, 0.86), safe: cellOf(0.8, 0.86) } });
    expect(c.past.map((p) => [p.styles, p.belowAim])).toEqual([[['balanced'], false], [['safe'], true]]);
    expect(c.sameAs).toEqual(['safe']);
  });
  it('tied styles with different rates keep separate lines and "same as"', () => {
    const c = bidClaims({ ...base, tied: ['balanced', 'safe'], cells: { balanced: cellOf(0.8), safe: cellOf(0.82) } });
    expect(c.past.map((p) => p.styles)).toEqual([['balanced'], ['safe']]);
    expect(c.sameAs).toEqual(['safe']);
  });
  it('tied but only the other style has a rate: still names it as the same bid', () => {
    const c = bidClaims({ ...base, tied: ['balanced', 'safe'], cells: { balanced: null, safe: cellOf(0.8) } });
    expect(c.past.map((p) => p.styles)).toEqual([['safe']]);
    expect(c.sameAs).toEqual(['safe']);
  });
  it('Round 2A: Balanced = Safe is named from either side', () => {
    const t = ['balanced', 'safe'] as const;
    const cells = { balanced: cellOf(0.8), safe: cellOf(0.8) };
    expect(bidClaims({ ...base, style: 'balanced', tied: [...t], cells }).past[0].styles).toEqual(['balanced', 'safe']);
    expect(bidClaims({ ...base, style: 'safe', tied: [...t], cells }).past[0].styles).toEqual(['balanced', 'safe']);
    expect(bidClaims({ ...base, style: 'cheap', tied: ['cheap'] }).sameAs).toEqual([]);
  });
  it('three tied styles above the floor: the other two are named in "same as"', () => {
    expect(bidClaims({ ...base, style: 'balanced', tied: ['cheap', 'balanced', 'safe'] }).sameAs).toEqual(['cheap', 'safe']);
  });
  it('reached false names every tied style whose flag is false; true or unknown does not', () => {
    const t = ['balanced', 'safe'] as const;
    expect(bidClaims({ ...base, reached: { balanced: false } }).unreached).toEqual(['balanced']);
    expect(bidClaims({ ...base, tied: [...t], reached: { balanced: false, safe: false } }).unreached).toEqual(['balanced', 'safe']);
    expect(bidClaims({ ...base, tied: [...t], reached: { balanced: true, safe: false } }).unreached).toEqual(['safe']);
    expect(bidClaims({ ...base, reached: { balanced: true } }).unreached).toEqual([]);
    expect(bidClaims({ ...base, reached: { balanced: null } }).unreached).toEqual([]);
    expect(bidClaims({ ...base, reached: {} }).unreached).toEqual([]);
  });
});
