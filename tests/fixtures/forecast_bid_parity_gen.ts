// Generates forecast_bid_parity.json: the bids the SITE shows (suggestBid, calibrated mode) for simulated sections, at several
// chance levels. tests/test_forecast_bid_parity.py recomputes the bids the Python EVALUATION scores (distcal._uq + site_round)
// from the same seeded replays and compares; site/src/lib/sim/bidParity.test.ts checks this file still matches suggestBid.
// presets.ts reads the bid levels from the private forecast-meta.json, so the config below swaps that loader for fixed calibrated
// levels (suggestBid only needs them to be non-null; the level it reads at is the `target` passed in).
// regenerate: cd site && npx vite-node --config ../tests/fixtures/forecast_bid_parity_gen.config.ts ../tests/fixtures/forecast_bid_parity_gen.ts > ../tests/fixtures/forecast_bid_parity.json
import { recommendBid, simulate } from '../../site/src/lib/sim/index';
import { suggestBid } from '../../site/src/lib/sim/presets';

const LEVELS = [0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.965, 0.975, 0.985, 0.99, 0.995];
const base = { priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.1 };
const cases = [
  // plain (no calibration params): the fill chance is the simulated share of contested replays
  { name: 'one_seat_high_fill', seats: 1, group: 1, minBidCents: 1000, runs: 8000, seed: 11,
    params: { ...base, demandMean: 8, demandDispersion: 2, priceLevelCents: 2500, anchorCents: 1500 } },
  { name: 'many_seats_high_fill', seats: 35, group: 1, minBidCents: 1000, runs: 8000, seed: 12,
    params: { ...base, demandMean: 90, demandDispersion: 3, priceLevelCents: 4500, anchorCents: 5000 } },
  { name: 'many_seats_low_fill', seats: 30, group: 1, minBidCents: 1000, runs: 8000, seed: 13,
    params: { ...base, demandMean: 26, demandDispersion: 6, priceLevelCents: 2000, anchorCents: 1500 } },
  { name: 'few_seats_mid_fill', seats: 3, group: 1, minBidCents: 1000, runs: 8000, seed: 14,
    params: { ...base, demandMean: 3.5, demandDispersion: 1.5, priceLevelCents: 3000, anchorCents: 2000 } },
  // calibrated (fillProb / spreadLo / spreadHi), as the evaluation applies them
  { name: 'cal_high_fill_wide_upper', seats: 10, group: 1, minBidCents: 1000, runs: 8000, seed: 15,
    params: { ...base, demandMean: 40, demandDispersion: 8, priceLevelCents: 1800, anchorCents: 1200, fillProb: 0.9, spreadLo: 0.8, spreadHi: 1.25 } },
  { name: 'cal_low_fill_one_seat', seats: 1, group: 1, minBidCents: 1000, runs: 8000, seed: 16,
    params: { ...base, demandMean: 8, demandDispersion: 2, priceLevelCents: 2500, anchorCents: 1500, fillProb: 0.3, spreadLo: 1.2, spreadHi: 0.8 } },
  { name: 'cal_mid_fill_many_seats', seats: 25, group: 1, minBidCents: 1000, runs: 8000, seed: 17,
    params: { ...base, demandMean: 60, demandDispersion: 5, priceLevelCents: 3500, anchorCents: 3000, fillProb: 0.55, spreadLo: 1.1, spreadHi: 1.4 } },
  { name: 'cal_fillprob_only_high_price', seats: 5, group: 1, minBidCents: 1000, runs: 8000, seed: 18,
    params: { ...base, demandMean: 12, demandDispersion: 3, priceLevelCents: 9000, anchorCents: 8000, fillProb: 0.7 } },
];
const out = cases.map((c) => {
  const result = simulate({ seats: c.seats, group: c.group, minBidCents: c.minBidCents, params: c.params, runs: c.runs, seed: c.seed });
  return {
    ...c, levels: LEVELS, pFill: result.pFill,
    tsRaw: LEVELS.map((l) => recommendBid(result, l)), // recommendBid alone: the win curve inverted, next odd cent
    tsSite: LEVELS.map((l) => suggestBid(result, l)), // what the site shows: tsRaw raised to the next whole e$ plus one cent
  };
});
console.log(JSON.stringify(out));
