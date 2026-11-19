// H5: the selected bid style is tracked by key. The differential test proves the new key path shows exactly the bids the old
// level path showed whenever the levels are distinct (today's data); the tie test proves it differs, correctly, when they are not.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BidWindowData } from '../data/bidLevels';
import type { BidLevel, BidLevels } from '../data/types';
import type { PanelViewInput } from '../../components/course/panelView';
import type { SimResult } from './index';

const lv = (level: number, lossFilled = 0.2): BidLevel => ({ level, lossFilled, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
const DISTINCT: BidLevels = { cheap: lv(0.9, 0.304), balanced: lv(0.975, 0.157), safe: lv(0.99, 0.106) };
const W = 'Round 1 Window 1';

async function load(levels: BidLevels | null, windowData: BidWindowData | null = null) {
  vi.resetModules();
  vi.doMock('../data/bidLevels', () => ({ bidLevels: () => levels, bidWindowData: () => (levels ? windowData : null) }));
  const presets = await import('./presets');
  const sim = await import('./index');
  const wb = await import('./windowBids');
  const view = await import('../../components/course/panelView');
  return { ...presets, recommendBid: sim.recommendBid, pInAt: sim.pInAt, levelForWindow: wb.levelForWindow, claimsAt: wb.claimsAt, conditionalMedianCents: wb.conditionalMedianCents, panelView: view.panelView };
}
afterEach(() => vi.doUnmock('../data/bidLevels'));

const fake = (xs: number[], ys: number[], pFill = 1, start = xs[0]): SimResult => ({
  runs: 1000, pFill, percentilesCents: { p50: 0, p80: 0, p90: 0, p95: 0, p99: 0 },
  histogram: { startCents: start, binWidthCents: 100, counts: [] }, curve: { bidCents: xs, pIn: ys },
});

/** Small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** A random P(win) curve: ascending bids from a random minimum, non-decreasing chances ending at 1, a random fill chance. */
function randomCurve(r: () => number): SimResult {
  const n = 3 + Math.floor(r() * 30);
  const start = 100 + Math.floor(r() * 4000);
  const xs: number[] = [];
  const ys: number[] = [];
  let x = start;
  let y = r() * 0.4;
  for (let i = 0; i < n; i++) {
    xs.push(x);
    ys.push(i === n - 1 ? 1 : Math.min(1, y));
    x += 1 + Math.floor(r() * 900);
    y += r() * 0.2;
  }
  return fake(xs, ys, r() < 0.15 ? r() * 0.03 : 0.05 + r() * 0.95, start);
}
const randomWindowData = (r: () => number): BidWindowData => {
  const l = () => ({ level: 0.5 + r() * 0.49, lossFilled: r() });
  return { levels: { [W]: { cheap: l(), balanced: l(), safe: l() } }, measured: null, edges: null };
};

describe('differential: key path vs the old level path, with distinct levels', () => {
  // The suggestBid and panel pick as they were before H5: a level resolved to its style with presetFor, the chosen bid read from recs by TARGETS.indexOf(level).
  it('every displayed bid is identical for random curves, calibrated (with and without window levels) and not calibrated', async () => {
    const r = rng(20261119);
    let cases = 0;
    let diffs = 0;
    for (const mode of ['calibrated', 'calibrated+window', 'plain'] as const) {
      const wd = mode === 'calibrated+window' ? randomWindowData(r) : null;
      const m = await load(mode === 'plain' ? null : DISTINCT, wd);
      const presets = m.bidPresets();
      const oldSuggest = (res: SimResult, target: number, window?: string | null) => {
        const bid = m.recommendBid(res, m.levelForWindow(wd, window, mode === 'plain' ? null : m.presetFor(target)?.key) ?? target);
        if (mode === 'plain') return bid;
        const min = res.histogram.startCents;
        if (bid <= (min % 2 === 0 ? min + 1 : min)) return bid;
        return Math.ceil((bid - 1) / 100) * 100 + 1;
      };
      const meta = {} as PanelViewInput['meta'];
      for (let k = 0; k < 700; k++) {
        const res = randomCurve(r);
        const window = mode === 'calibrated+window' ? (r() < 0.8 ? W : 'Round 9 Window 9') : r() < 0.5 ? W : null;
        const oldRecs = m.TARGETS.map((t) => oldSuggest(res, t, window));
        const newRecs = presets.map((p) => m.suggestBid(res, p.key, window));
        const minBid = res.histogram.startCents;
        presets.forEach((p, i) => {
          const oldShown = oldRecs[m.TARGETS.indexOf(p.level)];
          const view = m.panelView({
            meta, window: window ?? W, group: 1, minBidCents: minBid, recs: newRecs as [number, number, number], styleKey: p.key,
            pNow: m.pInAt(res, newRecs[i]), pFill: res.pFill, conditionalMedianCents: m.conditionalMedianCents(res), reasons: [], hardWindow: false,
          });
          const oldClaims = m.claimsAt({
            group: 1, calibrated: mode !== 'plain', windowData: wd, window: window ?? W, minBid: minBid, recs: oldRecs, rec: oldShown,
            styleIndex: m.TARGETS.indexOf(p.level), medianCents: m.conditionalMedianCents(res),
          });
          const same = [
            m.suggestBid(res, p.key, window) === oldSuggest(res, p.level, window), // the key path
            m.suggestBid(res, p.level, window) === oldSuggest(res, p.level, window), // the level path is untouched (planner, report)
            view.bidCents === oldShown, // the bid the panel shows
            JSON.stringify([view.floor, view.past, view.unreached, view.sameAs]) === JSON.stringify([oldClaims.floor, oldClaims.past, oldClaims.unreached, oldClaims.sameAs]),
          ];
          cases += 1;
          if (same.includes(false)) diffs += 1;
        });
      }
    }
    expect(cases).toBe(6300);
    expect(diffs).toBe(0);
  });
});

describe('Cheap and Balanced share a pooled level but have different window levels', () => {
  const TIED: BidLevels = { cheap: lv(0.9), balanced: lv(0.9), safe: lv(0.99) };
  const WD: BidWindowData = {
    levels: { [W]: { cheap: { level: 0.6, lossFilled: 0.3 }, balanced: { level: 0.95, lossFilled: 0.15 }, safe: { level: 0.99, lossFilled: 0.1 } } },
    measured: null, edges: null,
  };
  const curve = fake([1000, 1800, 2600, 3500, 6000], [0.05, 0.3, 0.7, 0.93, 1], 1, 1000);
  it('Balanced shows Balanced\'s window bid, Cheap shows Cheap\'s', async () => {
    const m = await load(TIED, WD);
    const cheap = m.suggestBid(curve, 'cheap', W);
    const balanced = m.suggestBid(curve, 'balanced', W);
    expect(balanced).toBeGreaterThan(cheap);
    expect(balanced).toBe(Math.ceil((m.recommendBid(curve, 0.95) - 1) / 100) * 100 + 1);
    expect(cheap).toBe(Math.ceil((m.recommendBid(curve, 0.6) - 1) / 100) * 100 + 1);
    // the old resolution by pooled level could not tell them apart: the first match, Cheap, answered for both
    expect(m.suggestBid(curve, 0.9, W)).toBe(cheap);
    expect(m.styleKeyOf('balanced')).toBe('balanced');

    const recs = m.bidPresets().map((p) => m.suggestBid(curve, p.key, W)) as [number, number, number];
    const view = (styleKey: string) => m.panelView({
      meta: {} as PanelViewInput['meta'], window: W, group: 1, minBidCents: 1000, recs, styleKey, pNow: m.pInAt(curve, recs[0]), pFill: 1,
      conditionalMedianCents: null, reasons: [], hardWindow: false,
    });
    expect(view('balanced').bidCents).toBe(balanced);
    expect(view('cheap').bidCents).toBe(cheap);
    expect(view('safe').bidCents).toBe(recs[2]);
    expect(view('balanced').sameAs).not.toContain('cheap'); // they are different bids, so no "same bid as Cheap"
  });
  it('an unknown style key is refused, not read as another style', async () => {
    const m = await load(TIED, WD);
    const input = { meta: {} as PanelViewInput['meta'], window: W, group: 1, minBidCents: 1000, recs: [1, 2, 3] as [number, number, number], pNow: 0.5, pFill: 0.5, conditionalMedianCents: null, reasons: [], hardWindow: false };
    for (const styleKey of ['', 'Balanced', 't85', '0.9']) expect(() => m.panelView({ ...input, styleKey })).toThrow(/unknown style key/);
  });
});

describe('style keys', () => {
  it('calibrated: keys, default Balanced, legacy numbers read as the default (targetFromStored\'s rule)', async () => {
    const m = await load(DISTINCT);
    expect(m.DEFAULT_STYLE).toBe('balanced');
    expect(['cheap', 'balanced', 'safe'].map((k) => m.presetByKey(k)?.level)).toEqual([0.9, 0.975, 0.99]);
    expect(m.presetByKey('t90')).toBeNull();
    expect(['cheap', 'safe', 0.8, 0.9, 0.95, 0.975, 't90', 'x', null].map(m.styleKeyOf)).toEqual(['cheap', 'safe', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced', 'balanced']);
  });
  it('not calibrated: t80 / t90 / t95, a legacy number goes to the nearest of 80 / 90 / 95% (snapTarget\'s rule)', async () => {
    const m = await load(null);
    expect(m.DEFAULT_STYLE).toBe('t90');
    expect([0.8, 0.85, 0.9, 0.93, 0.95, 1, 0, 't95', 'cheap', 'x'].map(m.styleKeyOf)).toEqual(['t80', 't80', 't90', 't95', 't95', 't95', 't80', 't95', 't90', 't90']);
  });
  it('suggestBid by key gives the same bid as the level of the same style', async () => {
    for (const levels of [DISTINCT, null]) {
      const m = await load(levels);
      const curve = fake([1000, 1800, 2600, 3500, 6000], [0.05, 0.3, 0.7, 0.93, 1]);
      for (const p of m.bidPresets()) expect(m.suggestBid(curve, p.key)).toBe(m.suggestBid(curve, p.level));
      expect(m.suggestBid(curve, 'nonsense')).toBe(m.suggestBid(curve, m.DEFAULT_STYLE)); // an unknown key reads as the default style
    }
  });
});
