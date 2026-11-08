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
];
const out = cases.map((c) => ({ ...c, result: simulate({ seats: c.seats, group: c.group, minBidCents: c.minBidCents, params: c.params, runs: c.runs, seed: c.seed }) }));
console.log(JSON.stringify(out));
