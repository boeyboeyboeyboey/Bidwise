import { describe, expect, it } from 'vitest';
import { simulate, type SimInput } from './index';
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
