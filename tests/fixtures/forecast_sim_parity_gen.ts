import { simulate } from '../../site/src/lib/sim/index';
const cases = [
  { name: 'base', seats: 10, group: 1, minBidCents: 100, runs: 8000, seed: 7,
    params: { demandMean: 40, demandDispersion: 8, priceLevelCents: 900, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.15, anchorCents: 500 } },
  { name: 'small_demand_poisson', seats: 3, group: 1, minBidCents: 1000, runs: 6000, seed: 99,
    params: { demandMean: 4, demandDispersion: 1.5, priceLevelCents: 2500, priceSigma: 0.35, anchorSigma: 0.1, anchorShare: 0, anchorCents: 2500 } },
  { name: 'group3_big', seats: 35, group: 3, minBidCents: 1000, runs: 5000, seed: 12345,
    params: { demandMean: 90, demandDispersion: 3, priceLevelCents: 4500, priceSigma: 0.4, anchorSigma: 0.25, anchorShare: 0.3, anchorCents: 5000 } },
  { name: 'subone_dispersion', seats: 2, group: 1, minBidCents: 1000, runs: 6000, seed: 5,
    params: { demandMean: 2.5, demandDispersion: 0.6, priceLevelCents: 1500, priceSigma: 0.6, anchorSigma: 0.3, anchorShare: 0.1, anchorCents: 1200 } },
  // calibrated cases (fillProb / spreadLo / spreadHi): the Python parity test passes these params straight into SimParams
  { name: 'cal_fillprob_only', seats: 10, group: 1, minBidCents: 100, runs: 8000, seed: 7,
    params: { demandMean: 40, demandDispersion: 8, priceLevelCents: 900, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.15, anchorCents: 500, fillProb: 0.6 } },
  { name: 'cal_spreads_only', seats: 3, group: 1, minBidCents: 1000, runs: 6000, seed: 99,
    params: { demandMean: 6, demandDispersion: 1.5, priceLevelCents: 2500, priceSigma: 0.35, anchorSigma: 0.1, anchorShare: 0.1, anchorCents: 1200, spreadLo: 1.4, spreadHi: 0.6 } },
  { name: 'cal_both_group3', seats: 35, group: 3, minBidCents: 1000, runs: 5000, seed: 12345,
    params: { demandMean: 90, demandDispersion: 3, priceLevelCents: 4500, priceSigma: 0.4, anchorSigma: 0.25, anchorShare: 0.3, anchorCents: 5000, fillProb: 0.8, spreadLo: 0.7, spreadHi: 1.3 } },
  { name: 'cal_both_one_seat', seats: 1, group: 1, minBidCents: 500, runs: 6000, seed: 21,
    params: { demandMean: 8, demandDispersion: 2, priceLevelCents: 1200, priceSigma: 0.45, anchorSigma: 0.15, anchorShare: 0.2, anchorCents: 800, fillProb: 0.35, spreadLo: 1.2, spreadHi: 0.8 } },
];
const out = cases.map((c) => ({ ...c, result: simulate({ seats: c.seats, group: c.group, minBidCents: c.minBidCents, params: c.params, runs: c.runs, seed: c.seed }) }));
console.log(JSON.stringify(out));
// regenerate: cd site && npx vite-node ../tests/fixtures/forecast_sim_parity_gen.ts > ../tests/fixtures/forecast_sim_parity.json
