// One simulation per (section, window, group), shared by the section list, the forecast card and the other-sections table.
import type { Section } from '../../lib/data/types';
import type { SimResult } from '../../lib/sim';
import { seatsLeftNow } from '../../lib/data/seats';
import { runSim } from '../../lib/sim/client';
import { FORECAST_RUNS, FORECAST_SEED, toSimParams } from '../../lib/sim/forecast';

const cache = new Map<string, Promise<SimResult>>();

/** Simulated cutoffs for a section (needs the fetched course file: forecast parameters). Null when it cannot be simulated. */
export function simSection(s: Section, win: string, group: number): Promise<SimResult> | null {
  const f = s.forecast?.[win];
  if (!f || s.minBidCents === undefined || seatsLeftNow(s) < group || group < 1) return null;
  const key = `${s.classNumber}|${win}|${group}`;
  let p = cache.get(key);
  if (!p) {
    p = runSim({ seats: seatsLeftNow(s), group, minBidCents: s.minBidCents, params: toSimParams(f), runs: FORECAST_RUNS, seed: FORECAST_SEED });
    cache.set(key, p);
  }
  return p;
}
