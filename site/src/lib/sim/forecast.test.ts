import { describe, expect, it } from 'vitest';
import { simulate, type SimInput } from './index';
import { clampGroup, cutoffAt, toSimParams, effectiveWindow, cutoffRange, isLowConfidence, likelyWontFill, marginalPerFriend, pooledText } from './forecast';

const input: SimInput = {
  seats: 10, group: 1, minBidCents: 100, runs: 6000, seed: 3,
  params: { demandMean: 40, demandDispersion: 8, priceLevelCents: 900, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.15, anchorCents: 500 },
};

describe('forecast helpers', () => {
  it('each extra friend never lowers the bid needed, and a group of 4 costs more than alone', () => {
    const r1 = simulate(input);
    const r2 = simulate({ ...input, group: 2 });
    const r4 = simulate({ ...input, group: 4 });
    const r5 = simulate({ ...input, group: 5 });
    expect(marginalPerFriend(r1, r2, 0.9)).toBeGreaterThanOrEqual(0);
    expect(marginalPerFriend(r4, r5, 0.9)).toBeGreaterThan(0);
    expect(marginalPerFriend(r2, r1, 0.9)).toBe(0); // fewer friends clamps to 0, not negative
  });

  it('cutoff range is ordered and brackets the median', () => {
    const { lo, p50, hi } = cutoffRange(simulate(input));
    expect(lo).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(hi);
    expect(lo).toBeGreaterThanOrEqual(input.minBidCents);
  });

  it('cutoffAt returns the minimum when most runs end at the minimum bid', () => {
    const r = simulate({ ...input, params: { ...input.params, demandMean: 2 } });
    expect(cutoffAt(r, 0.5)).toBe(input.minBidCents);
  });

  it('clamps group size to 1..6 and treats junk as 1', () => {
    expect([clampGroup(0), clampGroup(3.4), clampGroup(9), clampGroup(NaN)]).toEqual([1, 3, 6, 1]);
  });

  it('flags low confidence and unfilled sections', () => {
    expect(isLowConfidence(undefined)).toBe(true);
    expect(isLowConfidence({ confidence: 'ok' } as never)).toBe(false);
    expect(likelyWontFill(0.29)).toBe(true);
    expect(likelyWontFill(0.3)).toBe(false);
    expect(pooledText('subject', 12)).toContain('subject');
  });

  it('shows a count only at course x instructor level (nObs is 0 at coarser levels)', () => {
    expect(pooledText('course×instructor', 4)).toBe('4 past results for this course and instructor');
    for (const level of ['course', 'subject', 'global'] as const) {
      expect(pooledText(level, 0)).not.toMatch(/\d/);
    }
    expect(pooledText('course', 0)).toContain('other instructors');
  });
});

describe('paramRows', () => {
  it('lists the seven parameters with readable values', async () => {
    const { paramRows, poolLabel } = await import('./forecast');
    const rows = paramRows({ ...input.params, pooledLevel: 'course', nObs: 5 });
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.label === 'Typical bid level')?.value).toBe('e$9.00');
    expect(rows.find((r) => r.label === 'Anchor share')?.value).toBe('15%');
    expect(poolLabel('global')).toBe('All courses');
  });

  it('effectiveWindow prefers the chosen window, then the open one, then the latest available', () => {
    const av = ['A', 'B', 'C'];
    expect(effectiveWindow('A', 'B', av)).toBe('A');
    expect(effectiveWindow('Z', 'B', av)).toBe('B');
    expect(effectiveWindow(null, 'Z', av)).toBe('C');
    expect(effectiveWindow(null, 'Z', [])).toBe('');
  });
});

describe('toSimParams', () => {
  const f = { ...input.params, pooledLevel: 'course' as const, nObs: 12 };
  it('copies the distribution calibration when the section-window has it', () => {
    expect(toSimParams({ ...f, fillProb: 0.62, spreadLo: 0.8, spreadHi: 1.25 })).toEqual({ ...input.params, fillProb: 0.62, spreadLo: 0.8, spreadHi: 1.25 });
  });
  it('leaves the keys out for an uncalibrated one', () => {
    const r = toSimParams(f);
    expect(Object.keys(r)).toEqual(Object.keys(input.params));
  });
});
