import { describe, expect, it } from 'vitest';
import type { Section } from '../../lib/data/types';
import { pInAt, simulate } from '../../lib/sim';
import { FORECAST_RUNS, FORECAST_SEED, toSimParams } from '../../lib/sim/forecast';
import { DEFAULT_STYLE, suggestBid } from '../../lib/sim/presets';
import { buildRowSeed, rowBidOf, seedUsable, type RowSeed } from './rowSeed';

const W = 'Round 1B Window 1';
const forecast = { demandMean: 30, demandDispersion: 5, priceLevelCents: 2500, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.3, anchorCents: 2000 };
const sec = (classNumber: string, seats: number, over: Record<string, unknown> = {}) =>
  ({ classNumber, section: `G${classNumber}`, seatsLeft: seats, seatsTotal: 40, minBidCents: 1, forecast: { [W]: forecast }, ...over }) as unknown as Section;

describe('buildRowSeed', () => {
  it('gives each open section the bid, chance and low-confidence flag the page derives from the same simulation', async () => {
    const sections = [sec('1', 5), sec('2', 1), sec('3', 0), sec('4', 5, { forecast: {} })];
    const seed = await buildRowSeed(sections, [W], W, DEFAULT_STYLE);
    expect(Object.keys(seed.bySection).sort()).toEqual(['1', '2', '4']); // the full section has no row bid
    const direct = simulate({ seats: 5, group: 1, minBidCents: 1, params: toSimParams(forecast as never), runs: FORECAST_RUNS, seed: FORECAST_SEED });
    const cents = suggestBid(direct, DEFAULT_STYLE);
    expect(seed.bySection['1']).toEqual({ cents, p: pInAt(direct, cents), low: false });
    expect(seed.bySection['2']?.low).toBe(true); // one seat
    expect(seed.bySection['4']).toBeNull(); // no forecast
    expect(seed).toMatchObject({ window: W, style: DEFAULT_STYLE });
  });
  it('rowBidOf flags a late window only through the seat count, as the rows do', async () => {
    const direct = simulate({ seats: 5, group: 1, minBidCents: 1, params: toSimParams(forecast as never), runs: 2000, seed: 1 });
    expect(rowBidOf(direct, DEFAULT_STYLE, 5, 'Round 2 Window 3').low).toBe(false);
    expect(rowBidOf(direct, DEFAULT_STYLE, 1, W).low).toBe(true);
  });
});

describe('seedUsable', () => {
  const seed: RowSeed = { window: W, style: DEFAULT_STYLE, bySection: {} };
  it('applies for the build window and chance, with no chosen window or the same one', () => {
    expect(seedUsable(seed, W, null, DEFAULT_STYLE)).toBe(true);
    expect(seedUsable(seed, W, W, DEFAULT_STYLE)).toBe(true);
  });
  it('does not apply when the window or the chance differs, or there is no seed', () => {
    expect(seedUsable(seed, W, 'Round 2 Window 1', DEFAULT_STYLE)).toBe(false);
    expect(seedUsable(seed, 'Round 2 Window 1', null, DEFAULT_STYLE)).toBe(false);
    expect(seedUsable(seed, W, null, 'safe')).toBe(false);
    expect(seedUsable(undefined, W, null, DEFAULT_STYLE)).toBe(false);
  });
});
