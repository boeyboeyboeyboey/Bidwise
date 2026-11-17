// Per-window bid levels and the measured "if the section fills" rate. Pure functions over the data bidWindowData() loads,
// so they can be unit tested without the real forecast-meta.json.
import type { BidWindowData } from '../data/bidLevels';
import type { BidStyleKey } from '../data/types';
import type { SimResult } from './index';

/** The win rate on filled sections each style aims for: 1 - the style's loss threshold in the calibration (30 / 15 / 10%). */
export const STYLE_TARGET: Readonly<Record<BidStyleKey, number>> = { cheap: 0.7, balanced: 0.85, safe: 0.9 };

/** How far under its target a measured rate can fall before the page says so. */
export const MEASURED_TOLERANCE = 0.06;

/**
 * The chance level for a style in a window: that window's own level, else null so the caller keeps the pooled level.
 * No window, no per-window data or an unknown window all give null.
 */
export function levelForWindow(data: BidWindowData | null, window: string | null | undefined, style: string | null | undefined): number | null {
  if (!data?.levels || !window || !style) return null;
  const cell = data.levels[window] as Record<string, { level: number }> | undefined;
  return cell?.[style]?.level ?? null;
}

/** The forecast band (0..4) of a conditional median in cents: below the first edge is 0, at or above the last is 4. */
export function bandOf(edges: readonly number[], medianCents: number): number {
  const e = medianCents / 100;
  let b = 0;
  while (b < edges.length && e >= edges[b]) b++;
  return b;
}

/**
 * The median clearing bid if the section fills, in cents: the point of the curve where P(win) is 1 - pFill / 2.
 * Null when the section almost never fills (the same cut as chanceIfFills) or the curve does not reach it.
 */
export function conditionalMedianCents(result: SimResult): number | null {
  const f = result.pFill;
  if (!(f >= 0.02)) return null;
  const { bidCents: xs, pIn: ys } = result.curve;
  const q = 1 - f / 2;
  const n = xs.length;
  if (!n || ys[n - 1] < q) return null;
  if (ys[0] >= q) return xs[0];
  let i = 1;
  while (ys[i] < q) i++;
  const t = (q - ys[i - 1]) / (ys[i] - ys[i - 1]);
  return xs[i - 1] + t * (xs[i] - xs[i - 1]);
}

/**
 * The past win rate (0..1) of a style's bid on sections that filled, for sections of this window and forecast band;
 * null when the data, the window, the band or the section's conditional median is missing.
 */
export function measuredRate(data: BidWindowData | null, window: string | null | undefined, result: SimResult, style: string | null | undefined): number | null {
  if (!data?.measured || !data.edges || !window || !style) return null;
  const median = conditionalMedianCents(result);
  if (median === null) return null;
  const cell = data.measured[window]?.[String(bandOf(data.edges, median))] as unknown as Record<string, number | null> | undefined;
  const r = cell?.[style];
  return typeof r === 'number' ? r : null;
}

/** True when the measured rate is more than MEASURED_TOLERANCE under the style's target. */
export const underDelivers = (style: BidStyleKey, rate: number): boolean => rate < STYLE_TARGET[style] - MEASURED_TOLERANCE;
