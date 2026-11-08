// Predicted Round 1 Window 1 median clearing bid per section, for the swap chance. Uses the same simulator,
// forecast parameters and seed as the course page's bids (group of 1), but at the section's full seat count:
// swap desirability is about how wanted a section is, not how many seats happen to be left today.
import type { Section } from '../data/types';
import { runSim } from '../sim/client';
import { FORECAST_SEED, toSimParams } from '../sim/forecast';
import { holdersOf, SWAP_WINDOW } from './swap';

/** Windows are simulated fewer times than the forecast card: only the median is read, and it is steady by 4000. */
export const SWAP_RUNS = 4000;

/** Null when the section has no Round 1 Window 1 forecast, no minimum bid or no seat count. */
export function swapBidCents(s: Section): Promise<number> | null {
  const f = s.forecast?.[SWAP_WINDOW];
  const seats = holdersOf(s);
  if (!f || s.minBidCents === undefined || seats < 1) return null;
  return runSim({ seats, group: 1, minBidCents: s.minBidCents, params: toSimParams(f), runs: SWAP_RUNS, seed: FORECAST_SEED }).then((r) => r.percentilesCents.p50);
}
