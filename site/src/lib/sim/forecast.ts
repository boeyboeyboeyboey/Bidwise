// Pure helpers for the section forecast panel (no DOM, no worker), so they can be unit tested.
import type { ForecastWindow, ForecastWindowMeta, SimParams } from '../data/types';
import { recommendBid, type SimResult } from './index';

export const MAX_FRIENDS_GROUP = 6;
export const WONT_FILL_BELOW = 0.3;
export const TARGETS = [0.8, 0.9, 0.95] as const;
/** Simulated bidding windows and random seed behind the section forecast. */
export const FORECAST_RUNS = 20000;
export const FORECAST_SEED = 12345;

/** The window a section's forecast shows: the chosen one if it has a forecast, else the current one (open now, or the next to open between windows), else the latest it has. */
export function effectiveWindow(chosen: string | null, open: string, available: readonly string[]): string {
  if (chosen && available.includes(chosen)) return chosen;
  return available.includes(open) ? open : (available[available.length - 1] ?? '');
}

export function toSimParams(f: ForecastWindow): SimParams {
  const { demandMean, demandDispersion, priceLevelCents, priceSigma, anchorSigma, anchorShare, anchorCents } = f;
  const out: SimParams = { demandMean, demandDispersion, priceLevelCents, priceSigma, anchorSigma, anchorShare, anchorCents };
  // distribution calibration: copied only when the build set it, so uncalibrated sections simulate exactly as before
  if (f.fillProb !== undefined) out.fillProb = f.fillProb;
  if (f.spreadLo !== undefined) out.spreadLo = f.spreadLo;
  if (f.spreadHi !== undefined) out.spreadHi = f.spreadHi;
  return out;
}

/** Group size from a free-text field: whole number, 1..MAX. Anything unreadable becomes 1. */
export function clampGroup(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(MAX_FRIENDS_GROUP, Math.max(1, Math.round(v)));
}

/**
 * Cutoff that a fraction q of simulated windows ended at or below, read off the P(win) curve
 * (P(win) at a bid is the share of runs whose cutoff is below it). Not rounded to odd cents.
 */
export function cutoffAt(result: SimResult, q: number): number {
  const { bidCents: xs, pIn: ys } = result.curve;
  const n = xs.length;
  if (ys[0] >= q) return xs[0];
  if (ys[n - 1] < q) return xs[n - 1];
  let i = 1;
  while (ys[i] < q) i++;
  const t = (q - ys[i - 1]) / (ys[i] - ys[i - 1]);
  return Math.round(xs[i - 1] + t * (xs[i] - xs[i - 1]));
}

/** Range shown as "cutoff range": 10th to 90th percentile, plus the median. */
export function cutoffRange(result: SimResult): { lo: number; p50: number; hi: number } {
  return { lo: cutoffAt(result, 0.1), p50: result.percentilesCents.p50, hi: result.percentilesCents.p90 };
}

/** Extra e$ (cents) the recommended bid grows by when one more friend joins the group. Never negative. */
export function marginalPerFriend(atG: SimResult, atGPlusOne: SimResult, targetP: number): number {
  return Math.max(0, recommendBid(atGPlusOne, targetP) - recommendBid(atG, targetP));
}

export const isLowConfidence = (m: ForecastWindowMeta | undefined): boolean => !m || m.confidence === 'low';

export const likelyWontFill = (pFill: number): boolean => pFill < WONT_FILL_BELOW;

/** nObs counts only this course and instructor, so a coarser pooling level has no count to show. */
export function pooledText(level: ForecastWindow['pooledLevel'], nObs: number): string {
  switch (level) {
    case 'course×instructor': return `${nObs} past results for this course and instructor`;
    case 'course': return "Based on this course's other instructors";
    case 'subject': return 'Based on other courses in this subject';
    default: return 'Based on all courses';
  }
}

export function poolLabel(level: ForecastWindow['pooledLevel']): string {
  switch (level) {
    case 'course×instructor': return 'This course and instructor';
    case 'course': return 'This course, all instructors';
    case 'subject': return 'Other courses in this subject';
    default: return 'All courses';
  }
}

const eCents = (c: number) => 'e$' + (c / 100).toFixed(2);

/** The seven fitted numbers in plain words, for the "How this was calculated" list. */
export function paramRows(f: ForecastWindow): { label: string; value: string; hint: string }[] {
  return [
    { label: 'Expected bidders', value: f.demandMean.toFixed(1), hint: 'how many people bid on this section in this window' },
    { label: 'Bidder count spread', value: f.demandDispersion.toFixed(2), hint: 'lower means the number of bidders varies more' },
    { label: 'Typical bid level', value: eCents(f.priceLevelCents), hint: 'the middle of the bids placed' },
    { label: 'Bid spread', value: f.priceSigma.toFixed(2), hint: 'how widely bids scatter around that level' },
    { label: 'Level uncertainty', value: f.anchorSigma.toFixed(2), hint: 'how much the typical level can shift from one window to the next' },
    { label: 'Anchor share', value: Math.round(f.anchorShare * 100) + '%', hint: 'bidders who bid at the anchor price' },
    { label: 'Anchor price', value: eCents(f.anchorCents), hint: 'the common bid that those bidders place (up to e$2.00 above it)' },
  ];
}
