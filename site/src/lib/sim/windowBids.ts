// Per-window bid levels and the measured "if the section fills" rate. Pure functions over the data bidWindowData() loads,
// so they can be unit tested without the real forecast-meta.json.
import type { BidWindowData } from '../data/bidLevels';
import type { BidStyleKey } from '../data/types';
import type { SimResult } from './index';

/** The win rate on filled sections each style aims for: 1 - the style's loss threshold in the calibration (30 / 15 / 10%). */
export const STYLE_TARGET: Readonly<Record<BidStyleKey, number>> = { cheap: 0.7, balanced: 0.85, safe: 0.9 };

/** How far under its target the 95% upper bound of a measured rate must sit before the page says "below aim". */
export const BELOW_AIM_MARGIN = 0.03;

const STYLE_ORDER: readonly BidStyleKey[] = ['cheap', 'balanced', 'safe'];

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

/** A style's past win rate on filled sections, with what it rests on. */
export interface MeasuredCell {
  rate: number;
  nFilled: number;
  source?: 'cell' | 'group' | 'all';
  /** One-sided 95% upper bound on the rate; absent (null) when the build did not ship it. */
  upper: number | null;
}

/** measuredRate with the case count, where the rate comes from and its upper bound; null on the same conditions. */
export function measuredCell(data: BidWindowData | null, window: string | null | undefined, result: SimResult, style: BidStyleKey | null | undefined): MeasuredCell | null {
  if (!data?.measured || !data.edges || !window || !style) return null;
  const median = conditionalMedianCents(result);
  if (median === null) return null;
  const cell = data.measured[window]?.[String(bandOf(data.edges, median))];
  const rate = cell?.[style];
  if (!cell || typeof rate !== 'number') return null;
  return { rate, nFilled: cell.nFilled, ...(cell.source ? { source: cell.source } : {}), upper: cell.upper?.[style] ?? null };
}

/** True when the 95% upper bound of the rate sits more than BELOW_AIM_MARGIN under the style's target. No upper bound: never. */
export function belowAim(style: BidStyleKey, upper: number | null | undefined): boolean {
  return typeof upper === 'number' && upper < STYLE_TARGET[style] - BELOW_AIM_MARGIN - 1e-9;
}

/** The style's "reached its aim" flag for a window; null when the window or the flag is not in the data (older builds). */
export function reachedForWindow(data: BidWindowData | null, window: string | null | undefined, style: string | null | undefined): boolean | null {
  if (!data?.levels || !window || !style) return null;
  const cell = data.levels[window] as Record<string, { reached?: boolean }> | undefined;
  const r = cell?.[style]?.reached;
  return typeof r === 'boolean' ? r : null;
}

export interface PastRate {
  /** The styles this line is for: tied styles with the same rate, count, source and judgement share one line. */
  styles: BidStyleKey[];
  rate: number;
  nFilled: number;
  source?: 'cell' | 'group' | 'all';
  belowAim: boolean;
}

/**
 * Group estimates (a bid and its chance for 2 or more friends) are withheld while they are revised. One switch for every screen
 * that would show one; the code that computes them stays in place behind it.
 */
export const groupEstimatesHidden = (group: number): boolean => group >= 2;

export interface ClaimInput {
  /** Group size the bid was simulated for. */
  group: number;
  calibrated: boolean;
  /** Suggested bid and the section's minimum bid, in cents. */
  rec: number;
  minBid: number | null;
  /** The chosen bid style; null when the presets are plain percentages. */
  style: BidStyleKey | null;
  /** Every style whose suggested bid is the same as the chosen one (the chosen style included). */
  tied: readonly BidStyleKey[];
  /** The measured cell of each tied style, null when there is none. */
  cells: Partial<Record<BidStyleKey, MeasuredCell | null>>;
  /** Each tied style's `reached` flag for the window; null or missing when unknown. */
  reached: Partial<Record<BidStyleKey, boolean | null>>;
}

export interface BidClaims {
  /** Group of 2 or more: show no bid and no percentage. */
  groupHidden: boolean;
  /** One bidder at (or one cent above) the minimum bid: the "if it fills" figure does not apply. */
  floor: boolean;
  /** Past win rate of each tied style, in style order; only for one bidder above the floor, calibrated. */
  past: PastRate[];
  /** The tied styles whose aim could not be reached for this round. */
  unreached: BidStyleKey[];
  /** The other styles that give the same bid and are not already named in the chosen style's past-rate line. */
  sameAs: BidStyleKey[];
}

/** Which claims may sit next to a suggested bid. Pure: the component only renders what this returns. */
export function bidClaims(i: ClaimInput): BidClaims {
  const none: BidClaims = { groupHidden: false, floor: false, past: [], unreached: [], sameAs: [] };
  if (groupEstimatesHidden(i.group)) return { ...none, groupHidden: true };
  const floor = i.minBid !== null && i.rec <= i.minBid + 1;
  if (!i.calibrated || !i.style) return { ...none, floor };
  const tied = STYLE_ORDER.filter((s) => s === i.style || i.tied.includes(s));
  const past: PastRate[] = [];
  if (!floor) {
    for (const s of tied) {
      const c = i.cells[s];
      if (!c) continue;
      const bA = belowAim(s, c.upper);
      const same = past.find((p) => p.rate === c.rate && p.nFilled === c.nFilled && p.source === c.source && p.belowAim === bA);
      if (same) same.styles.push(s);
      else past.push({ styles: [s], rate: c.rate, nFilled: c.nFilled, ...(c.source ? { source: c.source } : {}), belowAim: bA });
    }
  }
  const named = past.find((p) => p.styles.includes(i.style as BidStyleKey))?.styles ?? [i.style];
  return {
    ...none,
    floor,
    past,
    unreached: tied.filter((s) => i.reached[s] === false),
    sameAs: tied.filter((s) => !named.includes(s)),
  };
}
