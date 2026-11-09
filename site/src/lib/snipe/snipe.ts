// "Drop and re-bid": a student who won a section with a high bid drops it in a later window, gets a capped refund,
// and re-bids near the minimum hoping nobody else takes the freed seat. Pure helpers, no DOM, no worker.
import type { ForecastWindow, SimParams } from '../data/types';
import { pInAt, type SimInput, type SimResult } from '../sim';
import { FORECAST_RUNS, FORECAST_SEED, toSimParams } from '../sim/forecast';

/** Largest refund for dropping a class, in cents, by round (BOSS_FACTS section 3: e$50 R1 and 1A, e$40 1B, e$30 2, e$10 2A). */
const CAP_CENTS: ReadonlyArray<[RegExp, number]> = [
  [/^Round 2A\b/, 1000],
  [/^Round 2\b/, 3000],
  [/^Round 1B\b/, 4000],
  [/^Round 1A\b/, 5000],
  [/^Round 1\b/, 5000],
];

/** Refund cap in cents for a window label such as "Round 1B Window 1"; null for a label we do not know. */
export function refundCapCents(windowLabel: string): number | null {
  for (const [re, cap] of CAP_CENTS) if (re.test(windowLabel)) return cap;
  return null;
}

/**
 * Refund in cents: what you paid, up to the round's cap. The sources give only the maximum, so "up to what you paid"
 * is our reading. Null when the window has no known cap.
 */
export function refundCents(paidCents: number, windowLabel: string): number | null {
  const cap = refundCapCents(windowLabel);
  if (cap === null || !(paidCents > 0)) return null;
  return Math.min(cap, Math.round(paidCents));
}

/**
 * Windows a drop can happen in: the current one and every later one, in `ordered` (the site's window order), keeping
 * those this section has a forecast for (`available`) and a known cap.
 */
export function dropWindows(ordered: readonly string[], current: string, available: readonly string[]): string[] {
  const i = ordered.indexOf(current);
  return (i >= 0 ? ordered.slice(i) : [...ordered]).filter((w) => available.includes(w) && refundCapCents(w) !== null);
}

export interface SnipeMoney {
  refundCents: number;
  /** What the class cost if the snipe works: paid - refund + re-bid. */
  netCents: number;
  /** Saving against keeping the class: refund - re-bid. Negative when the re-bid is more than the refund. */
  savingCents: number;
}

export function snipeMoney(paidCents: number, rebidCents: number, windowLabel: string): SnipeMoney | null {
  const refund = refundCents(paidCents, windowLabel);
  if (refund === null || !(rebidCents > 0)) return null;
  const paid = Math.round(paidCents);
  const rebid = Math.round(rebidCents);
  return { refundCents: refund, netCents: paid - refund + rebid, savingCents: refund - rebid };
}

/** The freed seat is one seat, bid for by one person, in the chosen window. */
export function snipeSimInput(f: ForecastWindow, minBidCents: number): SimInput {
  return { seats: 1, group: 1, minBidCents, params: toSimParams(f) as SimParams, runs: FORECAST_RUNS, seed: FORECAST_SEED };
}

/** Chance the re-bid wins the single freed seat. A re-bid below the minimum is raised to it. */
export function snipeChance(sim: SimResult, rebidCents: number, minBidCents: number): number {
  return pInAt(sim, Math.max(rebidCents, minBidCents));
}

/** Whole e$ from a text field, as cents; null when unreadable or not above zero. */
export function parseDollars(v: string): number | null {
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}
