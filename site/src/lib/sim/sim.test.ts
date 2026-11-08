import { describe, expect, it } from 'vitest';
import { pInAt, recommendBid, simulate, type SimInput } from './index';

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
