import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BidWindowData } from '../data/bidLevels';
import type { BidLevel, BidLevels } from '../data/types';
import type { SimResult } from './index';

const lv = (level: number, lossFilled: number): BidLevel => ({ level, lossFilled, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
const LEVELS: BidLevels = { cheap: lv(0.9, 0.304), balanced: lv(0.975, 0.157), safe: lv(0.99, 0.106) };

/** Fresh copies of the modules with the bid-level loader mocked: calibrated or not. */
async function load(calibrated: boolean, windowData: BidWindowData | null = null) {
  vi.resetModules();
  vi.doMock('../data/bidLevels', () => ({ bidLevels: () => (calibrated ? LEVELS : null), bidWindowData: () => (calibrated ? windowData : null) }));
  const presets = await import('./presets');
  const sim = await import('./index');
  return { ...presets, recommendBid: sim.recommendBid, pInAt: sim.pInAt };
}

afterEach(() => vi.doUnmock('../data/bidLevels'));

const fakeSim = (xs: number[], ys: number[], pFill = 1, start = xs[0]): SimResult => ({
  runs: 1000, pFill, percentilesCents: { p50: 0, p80: 0, p90: 0, p95: 0, p99: 0 },
  histogram: { startCents: start, binWidthCents: 100, counts: [] }, curve: { bidCents: xs, pIn: ys },
});
const fake = (xs: number[], ys: number[], pFill = 1, start = xs[0]): SimResult => ({
  runs: 1000, pFill, percentilesCents: { p50: 0, p80: 0, p90: 0, p95: 0, p99: 0 },
  histogram: { startCents: start, binWidthCents: 100, counts: [] }, curve: { bidCents: xs, pIn: ys },
});

describe('presets', () => {
  it('not calibrated: today\'s 80 / 90 / 95%', async () => {
    const m = await load(false);
    expect(m.bidCalibrated()).toBe(false);
    expect(m.bidPresets().map((p) => [p.key, p.label, p.level])).toEqual([['t80', '80%', 0.8], ['t90', '90%', 0.9], ['t95', '95%', 0.95]]);
    expect([...m.TARGETS]).toEqual([0.8, 0.9, 0.95]);
    expect(m.DEFAULT_TARGET).toBe(0.9);
  });
  it('calibrated: Cheap / Balanced / Safe from the data, default Balanced', async () => {
    const m = await load(true);
    expect(m.bidCalibrated()).toBe(true);
    expect(m.bidPresets().map((p) => [p.key, p.label, p.level, p.lossFilled])).toEqual([
      ['cheap', 'Cheap', 0.9, 0.304], ['balanced', 'Balanced', 0.975, 0.157], ['safe', 'Safe', 0.99, 0.106],
    ]);
    expect([...m.TARGETS]).toEqual([0.9, 0.975, 0.99]);
    expect(m.DEFAULT_TARGET).toBe(0.975);
  });
  it('presetFor finds a preset by level, else null', async () => {
    const m = await load(true);
    expect(m.presetFor(0.975)?.key).toBe('balanced');
    expect(m.presetFor(0.95)).toBeNull();
  });
  it('normaliseTarget keeps a current level, otherwise the default', async () => {
    const off = await load(false);
    expect(off.normaliseTarget(0.95)).toBe(0.95);
    expect(off.normaliseTarget(0.85)).toBe(0.9);
    const on = await load(true);
    expect(on.normaliseTarget(0.975)).toBe(0.975);
    expect(on.normaliseTarget(0.8)).toBe(0.975);
    expect(on.normaliseTarget(0.9)).toBe(0.9);
    expect(on.normaliseTarget('x')).toBe(0.975);
    expect(on.normaliseTarget(undefined)).toBe(0.975);
  });
});

describe('stored target', () => {
  it('calibrated: stores the preset key; a number is legacy and reads as the fallback', async () => {
    const m = await load(true);
    expect(m.targetToStored(0.9)).toBe('cheap');
    expect(m.targetToStored(0.99)).toBe('safe');
    expect(m.targetFromStored('balanced')).toBe(0.975);
    expect(m.targetFromStored(0.9)).toBe(0.975);
    expect(m.targetFromStored(0.9, 0.9)).toBe(0.9);
    expect(m.targetFromStored('t90')).toBe(0.975);
  });
  it('not calibrated: stores the number, as before', async () => {
    const m = await load(false);
    expect(m.targetToStored(0.95)).toBe(0.95);
    expect(m.targetFromStored(0.95)).toBe(0.95);
    expect(m.targetFromStored(0.5)).toBe(0.9);
    expect(m.targetFromStored('safe')).toBe(0.9);
  });
});

describe('suggestBid', () => {
  it('not calibrated: identical to recommendBid', async () => {
    const m = await load(false);
    const r = fake([1000, 2300, 2314, 5000], [0.1, 0.5, 0.95, 1]);
    for (const t of [0.5, 0.8, 0.9, 0.95, 0.99]) expect(m.suggestBid(r, t)).toBe(m.recommendBid(r, t));
  });
  it('calibrated: rounds up to the next whole e$ plus one cent', async () => {
    const m = await load(true);
    // recommend gives 2315 (odd cent above 2314): next whole e$ is 2400
    expect(m.suggestBid(fake([1000, 2300, 2314, 5000], [0.1, 0.5, 0.95, 1]), 0.95)).toBe(2401);
    // already 2401: unchanged
    expect(m.suggestBid(fake([1000, 2400, 2401, 5000], [0.1, 0.5, 0.95, 1]), 0.95)).toBe(2401);
    // 2400 is even, so recommend makes it 2401: unchanged
    expect(m.suggestBid(fake([1000, 2399, 2400, 5000], [0.1, 0.5, 0.95, 1]), 0.95)).toBe(2401);
    // 2300 -> recommend 2301 -> stays
    expect(m.suggestBid(fake([1000, 2299, 2300, 5000], [0.1, 0.5, 0.95, 1]), 0.95)).toBe(2301);
    // 2302 -> recommend 2303 -> 2401
    expect(m.suggestBid(fake([1000, 2301, 2302, 5000], [0.1, 0.5, 0.95, 1]), 0.95)).toBe(2401);
  });
  it('calibrated: the minimum bid stays untouched, also when it is not a whole e$', async () => {
    const m = await load(true);
    expect(m.suggestBid(fake([1000, 2000], [0.97, 1], 1, 1000), 0.9)).toBe(1001);
    expect(m.suggestBid(fake([1250, 2000], [0.97, 1], 1, 1250), 0.9)).toBe(1251);
  });
  it('calibrated: never below the plain recommendation, within one e$ above it, and still reaches the target', async () => {
    const m = await load(true);
    const r = fake([1000, 1800, 2600, 3500, 6000], [0.05, 0.3, 0.7, 0.93, 1]);
    for (const t of [0.6, 0.8, 0.9, 0.975, 0.99]) {
      const rec = m.recommendBid(r, t);
      const s = m.suggestBid(r, t);
      expect(s).toBeGreaterThanOrEqual(rec);
      expect(s - rec).toBeLessThan(100);
      expect(s % 100).toBe(1);
      expect(m.pInAt(r, s)).toBeGreaterThanOrEqual(t);
    }
  });
});

describe('chanceIfFills', () => {
  // 80% fill: below the lowest filled cutoff (1500) the bid only "wins" in the 20% of runs where nothing fills
  const r = fake([1000, 1500, 2000, 3000, 4000], [0.2, 0.2, 0.5, 0.9, 1], 0.8);
  it('is null when the section almost never fills', async () => {
    const m = await load(false);
    expect(m.chanceIfFills(fake([1000, 2000], [0.99, 1], 0.019), 1500)).toBeNull();
    expect(m.chanceIfFills(fake([1000, 2000], [0.99, 1], 0.02), 1500)).not.toBeNull();
  });
  it('is 0 below the lowest filled cutoff, 1 at a very high bid, and never falls as the bid rises', async () => {
    const m = await load(false);
    expect(m.chanceIfFills(r, 1000)).toBe(0);
    expect(m.chanceIfFills(r, 1499)).toBe(0);
    expect(m.chanceIfFills(r, 9999)).toBe(1);
    let prev = -1;
    for (let b = 1000; b <= 4500; b += 50) {
      const c = m.chanceIfFills(r, b)!;
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
  });
  it('divides out the no-fill share', async () => {
    const m = await load(false);
    expect(m.chanceIfFills(r, 2000)).toBeCloseTo((0.5 - 0.2) / 0.8, 10);
  });
});

describe('lowConfidence', () => {
  it('lists the reasons', async () => {
    const m = await load(false);
    expect(m.lowConfidence(1, 'Round 1 Window 1')).toEqual(['oneSeat']);
    expect(m.lowConfidence(2, 'Round 1 Window 1')).toEqual([]);
    expect(m.lowConfidence(5, 'Round 2 Window 3')).toEqual(['lateWindow']);
    expect(m.lowConfidence(5, 'Round 2 Window 2')).toEqual([]);
    expect(m.lowConfidence(5, 'Round 2A Window 1')).toEqual(['lateWindow']);
    expect(m.lowConfidence(1, 'Round 2A Window 3')).toEqual(['oneSeat', 'lateWindow']);
  });
  it('adds farWindow last when the window is after the build window', async () => {
    const m = await load(false);
    expect(m.lowConfidence(5, 'Round 2 Window 2', true)).toEqual(['farWindow']);
    expect(m.lowConfidence(5, 'Round 2 Window 2')).toEqual([]);
    expect(m.lowConfidence(1, 'Round 2 Window 3', true)).toEqual(['oneSeat', 'lateWindow', 'farWindow']);
  });
});

describe('isFarWindow', () => {
  const W = ['Round 1 Window 1', 'Round 2 Window 1', 'Round 2 Window 2', 'Round 2 Window 3'];
  it('is true only for windows after the build window', async () => {
    const m = await load(false);
    expect(m.isFarWindow('Round 2 Window 2', 'Round 2 Window 1', W)).toBe(true);
    expect(m.isFarWindow('Round 2 Window 3', 'Round 2 Window 1', W)).toBe(true);
    expect(m.isFarWindow('Round 2 Window 1', 'Round 2 Window 1', W)).toBe(false);
    expect(m.isFarWindow('Round 1 Window 1', 'Round 2 Window 1', W)).toBe(false);
  });
  it('is false when either label is not in the list', async () => {
    const m = await load(false);
    expect(m.isFarWindow('Round 9 Window 1', 'Round 2 Window 1', W)).toBe(false);
    expect(m.isFarWindow('Round 2 Window 2', 'Round 9 Window 1', W)).toBe(false);
    expect(m.isFarWindow('Round 2 Window 2', 'Round 2 Window 1', [])).toBe(false);
  });
});

describe('planner and report follow the presets', () => {
  it('calibrated: the plan clamp caps each row at suggestBid, not the plain recommendation', async () => {
    const m = await load(true);
    const plan = await import('../../components/planner/plan');
    const curve = fake([1000, 2300, 2314, 5000], [0.1, 0.5, 0.95, 1]);
    const item = { key: 'a', courseCode: 'A', role: 'required' as const, curve };
    const full = m.suggestBid(curve, 0.95);
    expect(full).toBe(2401);
    expect(plan.bidsAtTarget([item], 0.95, 99999).bids.a).toBe(full);
    const fit = { bids: { a: 9000 }, p: { a: 1 }, pAll: 1, spentCents: 0, bidTotalCents: 0, leftCents: 0 };
    expect(plan.clampToRecommended([item], fit, 0.95, 99999).bids.a).toBe(full);
    expect(plan.snapTarget(0.8)).toBe(0.975);
    expect(plan.snapTarget('balanced')).toBe(0.975);
    expect(plan.snapTarget(0.975)).toBe(0.975); // a stored number is an old save
    expect(plan.DEFAULT_TARGET).toBe(0.975);
  });
  it('not calibrated: snapTarget still picks the closest of 80 / 90 / 95%', async () => {
    await load(false);
    const plan = await import('../../components/planner/plan');
    expect(plan.snapTarget(0.85)).toBe(0.8);
    expect(plan.snapTarget(0.93)).toBe(0.95);
    expect(plan.DEFAULT_TARGET).toBe(0.9);
  });
  const headers = async (calibrated: boolean) => {
    await load(calibrated);
    const csv = await import('../report/csv');
    const text = csv.buildReportCsv([], { title: 'T', generatedAt: 'now', plan: false });
    return text.split('\r\n').find((l) => l.startsWith('Course,'))!;
  };
  it('CSV headers keep today\'s text when not calibrated', async () => {
    expect(await headers(false)).toContain('Bid for 80% chance (e$),Bid for 90% chance (e$),Bid for 95% chance (e$)');
  });
  it('CSV headers follow the preset labels when calibrated', async () => {
    expect(await headers(true)).toContain('Cheap bid (e$),Balanced bid (e$),Safe bid (e$)');
  });
  it('CSV bid cells are read by preset level', async () => {
    await load(true);
    const csv = await import('../report/csv');
    const sec = { id: 'g', section: 'G1', classNumber: '1', instructor: 'X', meetings: [], seatsTotal: 5, seatsLeft: 5 } as never;
    const row = { ...csv.sectionFacts('C', 'T', sec), window: 'w', bids: { 0.9: 1001, 0.975: 2401, 0.99: 3501 }, note: '' };
    expect(csv.buildReportCsv([row], { title: 'T', generatedAt: 'now', plan: false })).toContain('10.01,24.01,35.01');
    expect(Object.keys(csv.NO_BIDS)).toEqual(['0.9', '0.975', '0.99']);
  });
});

describe('styleName / hasCheaperStyle', () => {
  it('calibrated: the style name, and a cheaper style exists for all but Cheap', async () => {
    const m = await load(true);
    expect([0.9, 0.975, 0.99].map(m.styleName)).toEqual(['Cheap', 'Balanced', 'Safe']);
    expect(m.styleName(0.8)).toBeNull();
    expect([0.9, 0.975, 0.99].map(m.hasCheaperStyle)).toEqual([false, true, true]);
  });
  it('not calibrated: no style names, so every screen keeps its percentages', async () => {
    const m = await load(false);
    expect(m.styleName(0.9)).toBeNull();
    expect(m.hasCheaperStyle(0.95)).toBe(false);
  });
});

describe('suggestBid with a window', () => {
  const r = fake([1000, 1800, 2600, 3500, 6000], [0.05, 0.3, 0.7, 0.93, 1]);
  const WD: BidWindowData = {
    levels: { 'Round 1 Window 1': { cheap: { level: 0.6, lossFilled: 0.3 }, balanced: { level: 0.8, lossFilled: 0.15 }, safe: { level: 0.95, lossFilled: 0.1 } } },
    measured: null, edges: null,
  };
  it('without per-window data it gives today\'s answer, with or without a window', async () => {
    const m = await load(true);
    for (const t of [0.9, 0.975, 0.99]) {
      expect(m.suggestBid(r, t, 'Round 1 Window 1')).toBe(m.suggestBid(r, t));
      expect(m.suggestBid(r, t, null)).toBe(m.suggestBid(r, t));
    }
    const off = await load(false);
    for (const t of [0.8, 0.9, 0.95]) expect(off.suggestBid(r, t, 'Round 1 Window 1')).toBe(off.recommendBid(r, t));
  });
  it('with per-window data a known window reads the style at that window\'s level', async () => {
    const m = await load(true, WD);
    // the pooled target 0.975 is the Balanced preset; this window's Balanced level is 0.8
    const s = m.suggestBid(r, 0.975, 'Round 1 Window 1');
    expect(s).toBe(m.suggestBid(r, 0.8));
    expect(s).toBeLessThan(m.suggestBid(r, 0.975));
    expect(m.suggestBid(r, 0.9, 'Round 1 Window 1')).toBe(m.suggestBid(r, 0.6));
  });
  it('an unknown window, no window, or a target that is not a preset keeps the pooled level', async () => {
    const m = await load(true, WD);
    expect(m.suggestBid(r, 0.975, 'Round 2 Window 1')).toBe(m.suggestBid(r, 0.975));
    expect(m.suggestBid(r, 0.975)).toBe(m.suggestBid(r, 0.975, undefined));
    expect(m.suggestBid(r, 0.7, 'Round 1 Window 1')).toBe(m.suggestBid(r, 0.7));
  });
  it('not calibrated ignores the window data', async () => {
    const off = await load(false, WD);
    expect(off.suggestBid(r, 0.95, 'Round 1 Window 1')).toBe(off.recommendBid(r, 0.95));
  });
});

describe('measuredIfFills', () => {
  const cell = (c: number, b: number, s: number) => ({ cheap: c, balanced: b, safe: s, nFilled: 90 });
  const WD: BidWindowData = {
    levels: null,
    edges: [15, 25, 40, 60],
    measured: { 'Round 1 Window 1': { '0': cell(0.7, 0.85, 0.9), '1': cell(0.65, 0.8, 0.88), '2': cell(0.6, 0.8, 0.9), '3': cell(0.55, 0.75, 0.85), '4': cell(0.5, 0.7, 0.8) } },
  };
  // fill share 0.5: the conditional median is where P(win) = 0.75, here exactly 2000 cents
  const at = (median: number) => ({ ...fakeSim([1000, median, median + 1000], [0.5, 0.75, 1], 0.5) });
  it('is null when not calibrated, without data, or for a window it has no cell for', async () => {
    const off = await load(false, WD);
    expect(off.measuredIfFills('Round 1 Window 1', at(2000), 'cheap')).toBeNull();
    const none = await load(true);
    expect(none.measuredIfFills('Round 1 Window 1', at(2000), 'cheap')).toBeNull();
    const m = await load(true, WD);
    expect(m.measuredIfFills('Round 2 Window 1', at(2000), 'cheap')).toBeNull();
    expect(m.measuredIfFills(undefined, at(2000), 'cheap')).toBeNull();
    expect(m.measuredIfFills('Round 1 Window 1', at(2000), null)).toBeNull();
  });
  it('picks the band of the conditional median and the style\'s rate', async () => {
    const m = await load(true, WD);
    const w = 'Round 1 Window 1';
    expect(m.measuredIfFills(w, at(1000), 'cheap')).toBe(0.7); // e$10: band 0
    expect(m.measuredIfFills(w, at(2000), 'balanced')).toBe(0.8); // e$20: band 1
    expect(m.measuredIfFills(w, at(3000), 'safe')).toBe(0.9); // e$30: band 2
    expect(m.measuredIfFills(w, at(5000), 'cheap')).toBe(0.55); // e$50: band 3
    expect(m.measuredIfFills(w, at(9000), 'safe')).toBe(0.8); // e$90: band 4
  });
  it('is null when the section almost never fills', async () => {
    const m = await load(true, WD);
    expect(m.measuredIfFills('Round 1 Window 1', fakeSim([1000, 2000], [0.99, 1], 0.019), 'cheap')).toBeNull();
  });
});
