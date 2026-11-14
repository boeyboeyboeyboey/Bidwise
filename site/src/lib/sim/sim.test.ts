import { describe, expect, it } from 'vitest';
import { calibrateFilled, isCalibrated, mixtureQuantile, pInAt, recommendBid, simulate, tieWinChance, type SimInput } from './index';
import parity from '../../../../tests/fixtures/forecast_sim_parity.json';

const proc = (globalThis as unknown as { process: { cpuUsage: (p?: unknown) => { user: number; system: number } } }).process;

const base: SimInput = {
  seats: 10,
  group: 1,
  minBidCents: 100,
  runs: 8000,
  seed: 7,
  params: {
    demandMean: 40,
    demandDispersion: 8,
    priceLevelCents: 900,
    priceSigma: 0.5,
    anchorSigma: 0.2,
    anchorShare: 0.15,
    anchorCents: 500,
  },
};
const withP = (o: Partial<SimInput['params']>, i: Partial<SimInput> = {}): SimInput => ({
  ...base,
  ...i,
  params: { ...base.params, ...o },
});

describe('simulate', () => {
  it('a floor bid wins for certain when seats are left over (not half credit)', () => {
    const r = simulate({ seats: 60, group: 1, minBidCents: 1000, runs: 4000, seed: 3, params: { demandMean: 1, demandDispersion: 1e9, priceLevelCents: 2000, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0, anchorCents: 1000 } });
    expect(r.curve.bidCents[0]).toBe(1000);
    expect(r.curve.pIn[0]).toBeGreaterThan(0.99);
  });
  it('a tied bid wins by random draw among the tied: seats left over / (tied + group), all of a group together', () => {
    expect(tieWinChance(10, 1, 9, 1)).toBeCloseTo(0.5, 12); // one seat, one rival tied
    expect(tieWinChance(10, 1, 7, 4)).toBeCloseTo(0.6, 12); // 3 seats among 4 rivals + me
    expect(tieWinChance(3, 3, 0, 10)).toBeCloseTo(1 / 286, 12); // a group of 3 for 3 seats against 10 tied rivals
    expect(tieWinChance(5, 2, 4, 1)).toBe(0); // fewer seats left than the group needs
  });
  it('a floor bid against many floor bidders is far below half credit', () => {
    // every rival bids the floor (priceSigma 0, no anchor): a floor bid ties with all of them, a bid above beats all
    const r = simulate({ seats: 3, group: 3, minBidCents: 1000, runs: 4000, seed: 5, params: { demandMean: 10, demandDispersion: 1e9, priceLevelCents: 1000, priceSigma: 0, anchorSigma: 0, anchorShare: 0, anchorCents: 1000 } });
    expect(r.curve.bidCents[0]).toBe(1000);
    expect(r.curve.pIn[0]).toBeLessThan(0.05);
    expect(r.curve.pIn[r.curve.pIn.length - 1]).toBeGreaterThan(0.99);
  });
  it('is deterministic for a seed and differs across seeds', () => {
    expect(simulate(base)).toEqual(simulate(base));
    expect(simulate({ ...base, seed: 8 }).percentilesCents).not.toEqual(simulate(base).percentilesCents);
  });

  it('demand below the needed count never fills and cutoff is the min bid', () => {
    const r = simulate(withP({ demandMean: 0.0001 }));
    expect(r.pFill).toBeLessThan(0.01);
    expect(r.percentilesCents.p99).toBe(base.minBidCents);
    expect(r.histogram.counts[0]).toBe(r.runs);
  });

  it('huge demand fills almost surely', () => {
    expect(simulate(withP({ demandMean: 500 })).pFill).toBeGreaterThan(0.999);
  });

  it('p90 is non-decreasing as group size grows', () => {
    let prev = -1;
    for (const g of [1, 2, 3, 5]) {
      const p90 = simulate({ ...base, group: g }).percentilesCents.p90;
      expect(p90).toBeGreaterThanOrEqual(prev);
      prev = p90;
    }
  });

  it('curve is monotone, starts at minBid, histogram sums to runs', () => {
    const r = simulate(base);
    expect(r.curve.bidCents[0]).toBe(base.minBidCents);
    for (let i = 1; i < r.curve.pIn.length; i++) {
      expect(r.curve.pIn[i]).toBeGreaterThanOrEqual(r.curve.pIn[i - 1]);
      expect(r.curve.bidCents[i]).toBeGreaterThan(r.curve.bidCents[i - 1]);
    }
    expect(r.histogram.counts.reduce((a, b) => a + b, 0)).toBe(r.runs);
    expect(r.histogram.counts.length).toBe(40);
  });

  it('recommendBid ends in an odd cent and reaches the target', () => {
    const r = simulate(base);
    for (const t of [0.5, 0.8, 0.9, 0.95]) {
      const b = recommendBid(r, t);
      expect(b % 2).toBe(1);
      expect(b % 100).not.toBe(0);
      expect(pInAt(r, b)).toBeGreaterThanOrEqual(t);
    }
  });

  it('runs 30k runs x ~60 bidders under 2000ms CPU', () => {
    const input = withP({ demandMean: 60 }, { runs: 30000, seats: 20 });
    simulate({ ...input, runs: 2000 }); // warm-up
    let ms = Infinity; // best of 5, CPU time, to be robust against a loaded machine
    for (let i = 0; i < 5; i++) {
      const t0 = proc.cpuUsage();
      simulate(input);
      const d = proc.cpuUsage(t0);
      ms = Math.min(ms, (d.user + d.system) / 1000);
    }
    console.log(`sim timing: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(2000);
  }, 60000);
});

describe('distribution calibration (fillProb, spreadLo, spreadHi)', () => {
  const lowFloorFree = { demandMean: 30, demandDispersion: 1e9, priceLevelCents: 4000, priceSigma: 0.1, anchorSigma: 0.05, anchorShare: 0, anchorCents: 1000 };
  const mk = (o: Partial<SimInput['params']>, i: Partial<SimInput> = {}): SimInput => ({ seats: 5, group: 1, minBidCents: 1000, runs: 4000, seed: 9, ...i, params: { ...lowFloorFree, ...o } });
  const mixed = (o: Partial<SimInput['params']>) => withP({ demandMean: 12, demandDispersion: 3, priceLevelCents: 1500, anchorSigma: 0.3, anchorShare: 0.1, anchorCents: 1100, ...o }, { seats: 8, minBidCents: 1000, runs: 6000, seed: 11 });

  it('with defaults reproduces the stored fixture results exactly (the first four cases predate calibration)', () => {
    for (const c of parity as Array<{ name: string; seats: number; group: number; minBidCents: number; runs: number; seed: number; params: SimInput['params']; result: unknown }>) {
      const r = simulate({ seats: c.seats, group: c.group, minBidCents: c.minBidCents, params: c.params, runs: c.runs, seed: c.seed });
      expect(r, c.name).toEqual(c.result);
    }
  });

  it('explicit defaults and out-of-range values count as absent', () => {
    const want = simulate(mixed({}));
    for (const extra of [{ fillProb: null, spreadLo: 1, spreadHi: 1 }, { fillProb: 1.5 }, { fillProb: 0 }, { spreadLo: 0, spreadHi: -2 }]) {
      expect(isCalibrated(extra)).toBe(false);
      expect(simulate(mixed(extra))).toEqual(want);
    }
    expect(isCalibrated({ fillProb: 0.5 })).toBe(true);
    expect(isCalibrated({ spreadHi: 0.9 })).toBe(true);
  });

  it('the transform preserves order and the median, respects the floor, and follows the formula', () => {
    const cutoffs = Int32Array.from([1000, 1000, 1200, 1500, 1500, 1500, 1800, 2400, 3000, 1000]);
    const flags = Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
    const filled = [1000, 1200, 1500, 1500, 1500, 1800, 2400, 3000]; // median (floor(0.5 * 8)-th) = 1500
    for (const [lo, hi] of [[0.6, 0.6], [1.5, 0.5], [0.5, 2], [5, 1]]) {
      const cal = calibrateFilled(cutoffs, flags, 1000, { spreadLo: lo, spreadHi: hi })!;
      expect(cal.idx).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(cal.pFill).toBe(0.8);
      expect(cal.vals.filter((v, j) => filled[j] === 1500 && v === 1500).length).toBe(3);
      cal.vals.forEach((v, j) => {
        const c = filled[j];
        const s = c > 1500 ? hi : c < 1500 ? lo : 1;
        expect(v).toBe(s === 1 ? c : Math.max(1000, Math.round(1500 * Math.pow(c / 1500, s))));
        if (j > 0) expect(v).toBeGreaterThanOrEqual(cal.vals[j - 1]);
      });
    }
  });

  it('the plain path is kept when nothing is calibrated or no replay filled', () => {
    expect(calibrateFilled(Int32Array.from([1000, 1000]), Uint8Array.from([1, 1]), 1000, {})).toBeNull();
    expect(calibrateFilled(Int32Array.from([1000, 1000]), Uint8Array.from([0, 0]), 1000, { fillProb: 0.5, spreadHi: 2 })).toBeNull();
  });

  it('fill probability is fillProb, else the simulated share', () => {
    expect(simulate(mixed({ fillProb: 0.37 })).pFill).toBe(0.37);
    const plain = simulate(mixed({}));
    expect(simulate(mixed({ spreadHi: 0.7 })).pFill).toBe(plain.pFill);
  });

  it('a group ignores fillProb: the simulated share is used, and with both spreads at 1 the plain path runs', () => {
    const g = { group: 3 };
    const plain = simulate({ ...mixed({}), ...g });
    expect(simulate({ ...mixed({ fillProb: 0.37 }), ...g })).toEqual(plain);
    const cutoffs = Int32Array.from([1000, 1200, 1500, 1800, 2400]);
    const flags = Uint8Array.from([0, 1, 1, 1, 1]);
    expect(calibrateFilled(cutoffs, flags, 1000, { fillProb: 0.37 }, 3)).toBeNull();
    expect(calibrateFilled(cutoffs, flags, 1000, { fillProb: 0.37 }, 1)!.pFill).toBe(0.37);
    expect(calibrateFilled(cutoffs, flags, 1000, { fillProb: 0.37, spreadHi: 0.7 }, 3)!.pFill).toBe(0.8);
    const spreads = { spreadLo: 0.7, spreadHi: 1.3 };
    const withFp = simulate({ ...mixed({ fillProb: 0.37, ...spreads }), ...g });
    const noFp = simulate({ ...mixed(spreads), ...g });
    expect(withFp.pFill).toBe(plain.pFill);
    expect(withFp).toEqual(noFp);
  });

  it('quantile formula: floor while 1 - p >= level, else the filled quantile at (a - (1 - p)) / p', () => {
    expect(mixtureQuantile([10, 11, 12, 13], 0.5, 5, 0.5)).toBe(5);
    expect(mixtureQuantile([10, 11, 12, 13], 0.5, 5, 0.6)).toBe(10);
    expect(mixtureQuantile([10, 11, 12, 13], 0.5, 5, 0.9)).toBe(13);
    expect(mixtureQuantile([2000, 3000], 0.7, 1000, 0.3)).toBe(1000);
    const r = simulate(mk({}, { runs: 2000 }));
    const cal = simulate(mk({ fillProb: 0.6 }, { runs: 2000 }));
    expect(cal.percentilesCents.p50).toBeGreaterThanOrEqual(1000);
    expect(cal.percentilesCents.p80).toBeLessThanOrEqual(r.percentilesCents.p99); // same filled replays, only a smaller share of them
  });

  it('a narrower upper spread lowers upper quantiles and nothing goes below the floor', () => {
    const wide = simulate(mixed({ fillProb: 0.9 }));
    const narrow = simulate(mixed({ fillProb: 0.9, spreadHi: 0.5 }));
    for (const k of ['p90', 'p95', 'p99'] as const) expect(narrow.percentilesCents[k]).toBeLessThan(wide.percentilesCents[k]);
    expect(simulate(mixed({ spreadLo: 5 })).percentilesCents.p50).toBeGreaterThanOrEqual(1000);
    expect(narrow.curve.bidCents[0]).toBeGreaterThanOrEqual(1000);
  });

  it('fillProb equal to the simulated share gives the default quantiles, up to one order statistic', () => {
    const plain = simulate(mixed({}));
    const cal = simulate(mixed({ fillProb: plain.pFill }));
    expect(cal.pFill).toBe(plain.pFill);
    for (const k of ['p50', 'p80', 'p90', 'p95'] as const) expect(Math.abs(cal.percentilesCents[k] - plain.percentilesCents[k])).toBeLessThanOrEqual(8);
    for (const b of [1000, 1200, 1500, 2000]) expect(Math.abs(pInAt(cal, b) - pInAt(plain, b))).toBeLessThan(0.003);
  });

  it('no replay filled ignores the calibration', () => {
    const p = { demandMean: 0.0001, demandDispersion: 1, priceLevelCents: 3000, priceSigma: 0.4, anchorSigma: 0.1, anchorShare: 0, anchorCents: 1000 };
    const input = { seats: 5, group: 1, minBidCents: 1000, runs: 2000, seed: 3 };
    const plain = simulate({ ...input, params: p });
    expect(plain.pFill).toBe(0);
    expect(simulate({ ...input, params: { ...p, fillProb: 0.5, spreadLo: 2, spreadHi: 0.5 } })).toEqual(plain);
  });

  it('fillProb with every replay filled still puts 1 - p at the floor', () => {
    const p = { demandMean: 500, demandDispersion: 1e9, priceLevelCents: 3000, priceSigma: 0.3, anchorSigma: 0.1, anchorShare: 0, anchorCents: 1000 };
    const input = { seats: 5, group: 1, minBidCents: 1000, runs: 2000, seed: 3 };
    expect(simulate({ ...input, params: p }).pFill).toBe(1);
    const cal = simulate({ ...input, params: { ...p, fillProb: 0.7 } });
    expect(cal.pFill).toBe(0.7);
    expect(cal.curve.pIn[0]).toBeCloseTo(0.3, 9);
    expect(cal.percentilesCents.p50).toBeGreaterThan(1000);
    expect(cal.histogram.counts.reduce((a, b) => a + b, 0)).toBeCloseTo(2000, 6);
    expect(cal.histogram.counts[0]).toBeCloseTo(600, 6);
  });

  it('win chance is non-decreasing and equals 1 - p at the floor when no filled replay is there', () => {
    for (const extra of [{ fillProb: 0.55 }, { fillProb: 0.3, spreadLo: 1.4, spreadHi: 0.6 }, { spreadLo: 0.8, spreadHi: 1.2 }]) {
      const r = simulate(mk(extra));
      expect(r.curve.bidCents[0]).toBe(1000);
      expect(r.curve.pIn[0]).toBeCloseTo(1 - r.pFill, 12);
      for (let i = 1; i < r.curve.pIn.length; i++) expect(r.curve.pIn[i]).toBeGreaterThanOrEqual(r.curve.pIn[i - 1]);
      expect(r.curve.pIn[r.curve.pIn.length - 1]).toBeGreaterThan(0.99);
    }
  });

  it('recommendBid reads the calibrated curve', () => {
    const r = simulate(mixed({ fillProb: 0.5 }));
    expect(recommendBid(r, 0.4)).toBe(1001); // the floor already reaches 40%: odd cent above it
    expect(recommendBid(r, 0.9) % 2).toBe(1);
    expect(recommendBid(r, 0.9)).toBeLessThanOrEqual(recommendBid(simulate(mixed({})), 0.9));
  });
});
