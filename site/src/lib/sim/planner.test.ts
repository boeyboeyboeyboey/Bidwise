import { describe, expect, it } from 'vitest';
import { pInAt, simulate, type SimInput, type SimResult } from './index';
import { optimise, tradeoff, type PlanItem } from './planner';

const mk = (key: string, price: number, role: PlanItem['role'], oneOfGroup?: string, min = 1000): PlanItem => {
  const input: SimInput = {
    seats: 10,
    group: 1,
    minBidCents: min,
    runs: 6000,
    seed: 3,
    params: { demandMean: 30, demandDispersion: 8, priceLevelCents: price, priceSigma: 0.4, anchorSigma: 0.15, anchorShare: 0.1, anchorCents: price },
  };
  return { key, courseCode: key, role, oneOfGroup, curve: simulate(input) };
};

describe('optimise', () => {
  const items = [mk('A', 2500, 'required'), mk('B', 1500, 'required'), mk('C', 2000, 'optional')];

  it('respects the budget and uses odd cents', () => {
    for (const budget of [3000, 12500, 20000]) {
      for (const s of [0, 0.5, 1]) {
        const r = optimise({ budgetCents: budget, items, certainty: s });
        expect(r.bidTotalCents).toBeLessThanOrEqual(budget);
        expect(r.spentCents).toBeLessThanOrEqual(r.bidTotalCents);
        expect(r.leftCents).toBe(budget - r.spentCents);
        expect(Object.values(r.bids).reduce((a, b) => a + b, 0)).toBe(r.bidTotalCents);
        for (const b of Object.values(r.bids)) if (b) expect(b % 2).toBe(1);
      }
    }
  });

  it('prioritises required over optional when budget is tight', () => {
    const tight = [mk('R', 2500, 'required'), mk('O', 2500, 'optional')];
    const r = optimise({ budgetCents: 4000, items: tight, certainty: 1 });
    expect(r.bids.R).toBeGreaterThan(r.bids.O);
    expect(r.p.R).toBeGreaterThan(r.p.O);
  });

  it('is monotone in certainty', () => {
    const t = tradeoff({ budgetCents: 12500, items }, 8);
    for (let i = 1; i < t.length; i++) {
      expect(t[i].pAll).toBeGreaterThanOrEqual(t[i - 1].pAll - 0.02);
      expect(t[i].spentCents).toBeGreaterThanOrEqual(t[i - 1].spentCents - 100);
    }
    expect(t[t.length - 1].pAll).toBeGreaterThan(t[0].pAll);
  });

  it('handles oneOf groups with skipping', () => {
    const g = [mk('X', 4000, 'oneOf', 'A'), mk('Y', 800, 'oneOf', 'A', 100)];
    const r = optimise({ budgetCents: 6000, items: g, certainty: 0.3 });
    expect(r.pAll).toBeGreaterThan(0.5);
    expect(r.bids.X === 0 || r.bids.Y === 0 || r.pAll > Math.max(r.p.X, r.p.Y)).toBe(true);
    expect(r.bidTotalCents).toBeLessThanOrEqual(6000);
    const lo = optimise({ budgetCents: 6000, items: g, certainty: 0 });
    expect(lo.spentCents).toBeLessThanOrEqual(r.spentCents + 100);
  });

  it('finishes quickly for 6 items', () => {
    const six = [
      mk('a', 2500, 'required'),
      mk('b', 1800, 'required'),
      mk('c', 3000, 'oneOf', 'A'),
      mk('d', 2000, 'oneOf', 'A'),
      mk('e', 1500, 'optional'),
      mk('f', 1200, 'optional'),
    ];
    const t0 = performance.now();
    optimise({ budgetCents: 12500, items: six, certainty: 0.6 });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

/** A smooth logistic-in-log-bid chance curve on a 50-cent grid, no simulation. */
const logistic = (min: number, med: number, sig: number, pmin: number, pmax: number): SimResult => {
  const bidCents: number[] = [];
  const pIn: number[] = [];
  for (let b = min; b <= 12500; b += 50) {
    bidCents.push(b);
    pIn.push(Math.min(pmax, Math.max(pmin, 1 / (1 + Math.exp(-(Math.log(b) - Math.log(med)) / sig)))));
  }
  return {
    runs: 1, pFill: 1, percentilesCents: { p50: 0, p80: 0, p90: 0, p95: 0, p99: 0 },
    histogram: { startCents: min, binWidthCents: 50, counts: [] }, curve: { bidCents, pIn },
  };
};

describe('optimise budget split', () => {
  // The best split of e$100 here needs e$ moved between courses; raising or lowering one bid at a time stalls at a pAll near 0.004.
  const curves = [logistic(1001, 4000, 0.45, 0.2, 0.96), logistic(1001, 5500, 0.5, 0.05, 0.97), logistic(1001, 3000, 0.4, 0.1, 0.95)];
  const items: PlanItem[] = curves.map((curve, i) => ({ key: 'ABC'[i], courseCode: 'ABC'[i], role: 'required', curve }));
  const budget = 10000;

  it('reaches the best split of the budget across courses (50-cent brute force)', () => {
    const grid = curves.map((c) => c.curve.bidCents.filter((b) => b <= budget).map((b) => [b, pInAt(c, b)] as const));
    let best = 0;
    for (const [a, pa] of grid[0]) {
      for (const [b, pb] of grid[1]) {
        if (a + b >= budget) break;
        for (const [c, pc] of grid[2]) {
          if (a + b + c > budget) break;
          best = Math.max(best, pa * pb * pc);
        }
      }
    }
    const r = optimise({ budgetCents: budget, items, certainty: 1 });
    expect(best).toBeGreaterThan(0.05);
    expect(r.pAll).toBeGreaterThanOrEqual(best - 0.005);
    expect(r.bidTotalCents).toBeLessThanOrEqual(budget);
  });
});

describe('optimise caps', () => {
  const curves = [logistic(1001, 4000, 0.45, 0.2, 0.96), logistic(1001, 5500, 0.5, 0.05, 0.97), logistic(1001, 3000, 0.4, 0.1, 0.95)];
  const items: PlanItem[] = curves.map((curve, i) => ({ key: 'ABC'[i], courseCode: 'ABC'[i], role: 'required', curve }));
  const budget = 10000;
  const caps = [3000, 3500, 2500];

  it('without caps the optimiser raises some bid above the cap; with caps no bid goes above it', () => {
    const free = optimise({ budgetCents: budget, items, certainty: 1 });
    expect(items.some((it, i) => free.bids[it.key] > caps[i])).toBe(true);
    const capped = optimise({ budgetCents: budget, items: items.map((it, i) => ({ ...it, capCents: caps[i] })), certainty: 1 });
    items.forEach((it, i) => {
      expect(capped.bids[it.key]).toBeLessThanOrEqual(caps[i]);
      if (capped.bids[it.key]) expect(capped.bids[it.key] % 2).toBe(1);
    });
    expect(capped.bidTotalCents).toBeLessThanOrEqual(budget);
    expect(capped.pAll).toBeGreaterThan(0);
  });

  it('a cap below the lowest allowed bid is raised to that bid', () => {
    const r = optimise({ budgetCents: budget, items: items.map((it) => ({ ...it, capCents: 10 })), certainty: 1 });
    items.forEach((it) => expect(r.bids[it.key]).toBe(it.curve.histogram.startCents % 2 ? it.curve.histogram.startCents : it.curve.histogram.startCents + 1));
  });
});
