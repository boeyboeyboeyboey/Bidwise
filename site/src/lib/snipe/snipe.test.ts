import { describe, expect, it } from 'vitest';
import type { ForecastWindow } from '../data/types';
import { simulate } from '../sim';
import { dropWindows, parseDollars, refundCapCents, refundCents, snipeChance, snipeMoney, snipeSimInput } from './snipe';

const fw: ForecastWindow = {
  demandMean: 6, demandDispersion: 0.4, priceLevelCents: 1500, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.3,
  anchorCents: 1000, pooledLevel: 'course×instructor', nObs: 6,
};

describe('refund cap', () => {
  it('follows the round', () => {
    expect(refundCapCents('Round 1 Window 1')).toBe(5000);
    expect(refundCapCents('Round 1A Window 3')).toBe(5000);
    expect(refundCapCents('Round 1B Window 2')).toBe(4000);
    expect(refundCapCents('Round 2 Window 1')).toBe(3000);
    expect(refundCapCents('Round 2A Window 2')).toBe(1000);
    expect(refundCapCents('Round 3 Window 1')).toBeNull();
  });
  it('is the smaller of cap and amount paid', () => {
    expect(refundCents(8000, 'Round 1B Window 1')).toBe(4000);
    expect(refundCents(2500, 'Round 1B Window 1')).toBe(2500);
    expect(refundCents(0, 'Round 1B Window 1')).toBeNull();
    expect(refundCents(5000, 'Nope')).toBeNull();
  });
});

describe('money', () => {
  it('nets paid - refund + rebid and saves refund - rebid', () => {
    const m = snipeMoney(8000, 1000, 'Round 2 Window 1')!;
    expect(m).toEqual({ refundCents: 3000, netCents: 6000, savingCents: 2000 });
    expect(m.netCents).toBe(8000 - m.savingCents);
  });
  it('goes negative when the rebid is above the refund', () => {
    expect(snipeMoney(8000, 1500, 'Round 2A Window 1')!.savingCents).toBe(-500);
  });
  it('returns null on bad input', () => {
    expect(snipeMoney(8000, 0, 'Round 2 Window 1')).toBeNull();
    expect(snipeMoney(8000, 1000, 'Round 9')).toBeNull();
  });
});

describe('window list', () => {
  const all = ['Round 1 Window 1', 'Round 1A Window 1', 'Round 1B Window 1', 'Round 2 Window 1', 'Round 2A Window 1'];
  it('starts at the current window', () => {
    expect(dropWindows(all, 'Round 1B Window 1', all)).toEqual(['Round 1B Window 1', 'Round 2 Window 1', 'Round 2A Window 1']);
  });
  it('skips windows the section has no forecast for', () => {
    expect(dropWindows(all, 'Round 1A Window 1', ['Round 1A Window 1', 'Round 2 Window 1'])).toEqual(['Round 1A Window 1', 'Round 2 Window 1']);
  });
});

describe('sim mapping', () => {
  it('uses one seat and one bidder', () => {
    const i = snipeSimInput(fw, 1000);
    expect(i.seats).toBe(1);
    expect(i.group).toBe(1);
    expect(i.minBidCents).toBe(1000);
    expect(i.params.priceLevelCents).toBe(1500);
  });
  it('chance of a minimum re-bid is lower than a higher re-bid, and a sub-minimum re-bid counts as the minimum', () => {
    const sim = simulate({ ...snipeSimInput(fw, 1000), runs: 2000 });
    expect(snipeChance(sim, 1000, 1000)).toBeLessThan(snipeChance(sim, 3000, 1000));
    expect(snipeChance(sim, 500, 1000)).toBe(snipeChance(sim, 1000, 1000));
  });
});

describe('parseDollars', () => {
  it('reads e$ as cents', () => {
    expect(parseDollars('12.5')).toBe(1250);
    expect(parseDollars('')).toBeNull();
    expect(parseDollars('-3')).toBeNull();
    expect(parseDollars('abc')).toBeNull();
  });
});
