// What the course page decides for a settled single-bidder answer, as one pure function over plain numbers and the forecast-meta
// pieces (no DOM, no worker, no data loading). ForecastPanel.svelte renders from it; scripts/claim_view.py (private) is its Python
// mirror, tied to it by __fixtures__/claim_view_parity.json (regenerate: see claim_view_parity_gen.ts).
import { bidLevels, bidWindowData } from '../../lib/data/bidLevels';
import type { BidStyleKey, ForecastMeta } from '../../lib/data/types';
import { EXAMPLE_BUDGET_CENTS as TERM_BUDGET_CENTS } from '../../lib/planner/example';
import type { LowConfidenceReason } from '../../lib/sim/presets';
import { claimsAt, ifFillsFrom, type PastRate } from '../../lib/sim/windowBids';
import { FLOOR_TEXT, GROUP_NOTICE, GROUP_NOTICE_ACTION, lowConfidenceLines, pastRateText, sameBidText, unreachedText } from './bidStyle';
import { pct } from './fmt';

/** The forecast-meta fields the claims are read from; read with the same validators as the page (bidLevels.ts). */
export type PanelMeta = Pick<ForecastMeta, 'distCalibration' | 'bidLevels' | 'bidLevelsByWindow' | 'measuredWin' | 'bandEdges'>;

export interface PanelViewInput {
  meta: PanelMeta;
  /** The window the simulation was run for. */
  window: string;
  /** Group size the simulation was run for. */
  group: number;
  /** The section's minimum bid, cents. */
  minBidCents: number;
  /** Suggested bid of each preset in preset order (Cheap, Balanced, Safe; or 80, 90, 95% without calibration), cents. */
  recs: readonly [number, number, number];
  /** Which preset is chosen (index into `recs`). */
  styleIndex: number;
  /** P(win) at the chosen bid, 0..1, and the simulated chance the section fills. */
  pNow: number;
  pFill: number;
  /** The model's median clearing bid if the section fills (conditionalMedianCents of the simulation), cents; null when it has none. */
  conditionalMedianCents: number | null;
  /** Why the forecast deserves less trust (seat count, late or far window), and the window's own "harder to forecast" flag. */
  reasons: readonly LowConfidenceReason[];
  hardWindow: boolean;
}

export interface PanelPastLine extends PastRate {
  text: string;
}

export interface PanelView {
  /** Group of 2 or more: only the notice shows, everything below is empty. */
  groupHidden: boolean;
  groupNotice: { text: string; action: string } | null;
  /** Headline bid, cents. */
  bidCents: number | null;
  /** The bid is more than one term's e$125. */
  overBudget: boolean;
  /** "NN% chance of a seat". */
  chanceNow: string | null;
  /** The "if the section fills" figure; null when it is not shown (floor, past-rate lines shown instead, or the section rarely fills). */
  ifFills: string | null;
  /** The "Chance it fills" figure and the width of its bar in whole percent; null when the section rarely fills. */
  fillChance: { text: string; barPct: number } | null;
  floor: boolean;
  floorText: string | null;
  past: PanelPastLine[];
  unreached: BidStyleKey[];
  unreachedText: string | null;
  sameAs: BidStyleKey[];
  sameAsText: string | null;
  /** All three styles give the minimum bid: "Minimum bid" replaces the style chips and the same-bid line. */
  minBidOnly: boolean;
  minBidCents: number;
  lowConfidence: { show: boolean; lines: string[] };
}

export function panelView(i: PanelViewInput): PanelView {
  const levels = bidLevels(i.meta);
  const rec = i.recs[i.styleIndex];
  const claims = claimsAt({
    group: i.group, calibrated: levels !== null, windowData: levels ? bidWindowData(i.meta) : null, window: i.window, minBid: i.minBidCents,
    recs: i.recs, rec, styleIndex: i.styleIndex, medianCents: i.conditionalMedianCents,
  });
  if (claims.groupHidden) {
    return {
      groupHidden: true, groupNotice: { text: GROUP_NOTICE, action: GROUP_NOTICE_ACTION }, bidCents: null, overBudget: false, chanceNow: null,
      ifFills: null, fillChance: null, floor: false, floorText: null, past: [], unreached: [], unreachedText: null, sameAs: [], sameAsText: null,
      minBidOnly: false, minBidCents: i.minBidCents, lowConfidence: { show: false, lines: [] },
    };
  }
  const modelIfFills = ifFillsFrom(i.pFill, i.pNow);
  // When past-rate lines are shown they carry the measured figure, so "if the section fills" is not repeated; at the floor it does not apply.
  const ifFills = modelIfFills !== null && !claims.past.length && !claims.floor ? pct(modelIfFills) : null;
  return {
    groupHidden: false,
    groupNotice: null,
    bidCents: rec,
    overBudget: rec > TERM_BUDGET_CENTS,
    chanceNow: pct(i.pNow),
    ifFills,
    fillChance: modelIfFills !== null ? { text: pct(i.pFill), barPct: Math.round(i.pFill * 100) } : null,
    floor: claims.floor,
    floorText: claims.floor ? FLOOR_TEXT : null,
    past: claims.past.map((r) => ({ ...r, text: pastRateText(r) })),
    unreached: claims.unreached,
    unreachedText: claims.unreached.length ? unreachedText(claims.unreached) : null,
    sameAs: claims.sameAs,
    sameAsText: claims.sameAs.length ? sameBidText(claims.sameAs) : null,
    minBidOnly: claims.floor && i.recs.every((r) => r === i.recs[0]),
    minBidCents: i.minBidCents,
    lowConfidence: { show: i.reasons.length > 0 || i.hardWindow, lines: lowConfidenceLines(i.reasons, i.hardWindow) },
  };
}
