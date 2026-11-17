// The site half of tests/test_forecast_bid_parity.py: tests/fixtures/forecast_bid_parity.json holds the bids the site showed for
// seeded simulations (made by tests/fixtures/forecast_bid_parity_gen.ts); the Python test compares them with the bids the Python
// evaluation scores. This test keeps the file honest: it must equal what simulate + recommendBid + suggestBid give now, so a change to
// the simulator, the curve inversion or the calibrated rounding fails here until the fixture is regenerated (and then the Python test
// says whether the evaluation still agrees).
import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/forecast_bid_parity.json';

const lv = (level: number) => ({ level, lossFilled: 0.1, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });

/** Fresh modules with calibrated bid levels (suggestBid then rounds up to the next whole e$ plus one cent). */
async function load() {
  vi.resetModules();
  vi.doMock('../data/bidLevels', () => ({ bidLevels: () => ({ cheap: lv(0.9), balanced: lv(0.975), safe: lv(0.99) }), bidWindowData: () => null }));
  const presets = await import('./presets');
  const sim = await import('./index');
  return { suggestBid: presets.suggestBid, simulate: sim.simulate, recommendBid: sim.recommendBid };
}

afterEach(() => vi.doUnmock('../data/bidLevels'));

describe('bid parity fixture', () => {
  it('matches the live simulator, curve inversion and calibrated rounding', async () => {
    const m = await load();
    expect(fixture.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture) {
      const result = m.simulate({ seats: c.seats, group: c.group, minBidCents: c.minBidCents, params: c.params, runs: c.runs, seed: c.seed });
      expect(result.pFill, c.name).toBe(c.pFill);
      expect(c.levels.map((l) => m.recommendBid(result, l)), `${c.name} raw`).toEqual(c.tsRaw);
      expect(c.levels.map((l) => m.suggestBid(result, l)), `${c.name} site`).toEqual(c.tsSite);
    }
  });

  it('shows a whole e$ plus one cent above the floor, and the odd floor bid at the floor', () => {
    for (const c of fixture) {
      c.tsSite.forEach((b, i) => {
        expect(b % 100 === 1 || b <= c.minBidCents + 1, `${c.name} ${c.levels[i]}`).toBe(true);
        expect(b, `${c.name} ${c.levels[i]}`).toBeGreaterThanOrEqual(c.tsRaw[i]);
      });
    }
  });
});
