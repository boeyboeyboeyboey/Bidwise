import { describe, expect, it, vi } from 'vitest';
import type { Section } from '../../lib/data/types';
import { pInAt, recommendBid, simulate } from '../../lib/sim';
import { DEFAULT_TARGET, FORECAST_RUNS, FORECAST_SEED, suggestBid, targetToStored, toSimParams } from '../../lib/sim/forecast';
import type { PlanItem } from '../../lib/sim/planner';
import { isLateWindow, rowLowConfidence } from '../../lib/sim/presets';
import { belowStyle, bidsAtTarget, clampToRecommended, decodePlan, snapTarget, toPlanSimInput } from './plan';

// Calibrated mode: Cheap 0.90 / Balanced 0.975 / Safe 0.99. Twins of the 80 / 90 / 95% tests in plan.test.ts.
vi.mock('../../lib/data/bidLevels', () => {
  const lv = (level: number) => ({ level, lossFilled: 0.1, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
  return { bidLevels: () => ({ cheap: lv(0.9), balanced: lv(0.975), safe: lv(0.99) }) };
});

const W = 'Round 1A Window 3';
const params = { demandMean: 20, demandDispersion: 5, priceLevelCents: 2000, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.2, anchorCents: 1000 };
const s: Section = {
  id: '1', section: 'G1', classNumber: '1', instructor: 'A B', meetings: [{ day: 'MON', start: '08:15', end: '11:30', venue: '' }],
  startDate: '', endDate: '', tba: false, hasClassDetails: true, seatsTotal: 40, seatsLeft: 12, latestWindow: '', enrolled: 28,
  minBidCents: 1000, forecast: { [W]: { ...params, pooledLevel: 'course', nObs: 9 } },
};

describe('chance you want, calibrated', () => {
  it('defaults to Safe; a stored preset key is kept, any stored number (an old save) becomes the default', () => {
    expect(DEFAULT_TARGET).toBe(0.99);
    expect(snapTarget('cheap')).toBe(0.9);
    expect(snapTarget('balanced')).toBe(0.975);
    expect(snapTarget('safe')).toBe(0.99);
    for (const old of [0.8, 0.9, 0.95, 0.975, 0.99]) expect(snapTarget(old)).toBe(0.99); // an old "90%" must not become Cheap
    expect(snapTarget('t90')).toBe(0.99);
    expect(snapTarget(undefined)).toBe(0.99);
  });
  it('a plan stores the key, and an old numeric s reads as the default key', () => {
    expect(decodePlan({ s: 'balanced' })?.s).toBe('balanced');
    expect(decodePlan({ s: 0.9 })?.s).toBe('safe');
    expect(decodePlan({ s: 'bogus' })?.s).toBe('safe');
    expect(decodePlan({})?.s).toBe('safe');
    expect(targetToStored(0.9)).toBe('cheap');
    expect(snapTarget(decodePlan({ s: targetToStored(0.975) })!.s)).toBe(0.975);
  });
});

describe('same numbers as the course page, calibrated', () => {
  const course = simulate({ seats: s.seatsLeft, group: 2, minBidCents: s.minBidCents!, params: toSimParams(s.forecast![W]), runs: FORECAST_RUNS, seed: FORECAST_SEED });
  const item = (key: string): PlanItem => ({ key, courseCode: key, role: 'required', curve: simulate(toPlanSimInput(s, W, 2)!) });
  it('bids carry the whole-e$ bump, and bid and chance still match the course page run', () => {
    for (const t of [0.9, 0.975, 0.99]) {
      const r = bidsAtTarget([item('a')], t, 99999);
      const bid = suggestBid(course, t);
      expect(r.bids.a).toBe(bid);
      expect(bid % 100).toBe(1);
      expect(bid).toBeGreaterThanOrEqual(recommendBid(course, t));
      expect(r.p.a).toBe(pInAt(course, bid));
    }
  });
  it('clamps an optimiser answer to the suggested bid', () => {
    const its = [item('a'), item('b')];
    const full = suggestBid(its[0].curve, 0.99);
    const fit = { bids: { a: full + 500, b: 0 }, p: { a: 1, b: 0 }, pAll: 0, spentCents: 0, bidTotalCents: 0, leftCents: 0 };
    const r = clampToRecommended(its, fit, 0.99, 99999);
    expect(r.bids.a).toBe(full);
    expect(r.p.a).toBe(pInAt(its[0].curve, full));
    expect(r.bidTotalCents).toBe(full);
  });
});

describe('belowStyle', () => {
  it('names the style a balance-cut bid fell below', () => {
    expect(belowStyle(0.99, 2000, 3501, true)).toBe('Below Safe');
    expect(belowStyle(0.975, 2000, 3501, true)).toBe('Below Balanced');
    expect(belowStyle(0.9, 1000, 1201, true)).toBe('Below Cheap');
  });
  it('is empty when the bid is whole, not cut by the balance, or skipped', () => {
    expect(belowStyle(0.99, 3501, 3501, true)).toBe('');
    expect(belowStyle(0.99, 2000, 3501, false)).toBe('');
    expect(belowStyle(0.99, 0, 3501, true)).toBe('');
    expect(belowStyle(0.99, null, 3501, true)).toBe('');
  });
});

describe('rowLowConfidence', () => {
  it('a normal window keeps both reasons on a row', () => {
    expect(rowLowConfidence(1, 'Round 2A Window 1', false)).toEqual(['oneSeat', 'lateWindow']);
  });
  it('a window the header already flags is not repeated on rows; one seat still is', () => {
    expect(rowLowConfidence(1, 'Round 2A Window 1', true)).toEqual(['oneSeat']);
    expect(rowLowConfidence(5, 'Round 2A Window 1', true)).toEqual([]);
    expect(rowLowConfidence(5, 'Round 1A Window 1', true)).toEqual([]);
  });
  it('course page rows in a late window: only the 1-seat reason, whatever the seats', () => {
    expect(rowLowConfidence(8, 'Round 2 Window 3', true)).toEqual([]);
    expect(rowLowConfidence(1, 'Round 2 Window 3', true)).toEqual(['oneSeat']);
    expect(rowLowConfidence(1, 'Round 1B Window 1', true)).toEqual(['oneSeat']);
  });
  it('knows the late windows', () => {
    expect(['Round 2 Window 3', 'Round 2A Window 1', 'Round 2A Window 3'].every(isLateWindow)).toBe(true);
    expect(['Round 2 Window 2', 'Round 1A Window 3'].some(isLateWindow)).toBe(false);
  });
});
