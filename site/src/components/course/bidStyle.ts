// Plain-words text for the bid styles (Cheap / Balanced / Safe), built from the held-out backtest numbers. No DOM.
import type { BidLevels, BidStyleKey, MeasuredWinSummary } from '../../lib/data/types';
import type { BidPreset, LowConfidenceReason } from '../../lib/sim/presets';
import { STYLE_TARGET, type PastRate } from '../../lib/sim/windowBids';

/** Simple fractions a share is worded as, in order of preference when two are about as close. */
const FRACTIONS: readonly (readonly [number, number])[] = [[1, 20], [1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [3, 10], [1, 3], [2, 5], [1, 2]];

/** The simple fraction ("1 in 6") nearest to a share 0..1; shares above a half are read from the other side. */
export function nearestFraction(p: number): [number, number] {
  if (p > 0.5) {
    const [k, n] = nearestFraction(1 - p);
    return [n - k, n];
  }
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) if (Math.abs(f[0] / f[1] - p) < Math.abs(best[0] / best[1] - p) - 1e-9) best = f;
  return [best[0], best[1]];
}

/** "about 3 in 10" for 0.30, "about 1 in 6" for 0.157. */
export const aboutInN = (p: number): string => {
  const [k, n] = nearestFraction(p);
  return `about ${k} in ${n}`;
};

const STYLE_LABEL: Readonly<Record<BidStyleKey, string>> = { cheap: 'Cheap', balanced: 'Balanced', safe: 'Safe' };
/** "Balanced and Safe", "Cheap, Balanced and Safe". */
const joinStyles = (ks: readonly BidStyleKey[]): string => ks.map((k) => STYLE_LABEL[k]).join(', ').replace(/, ([^,]*)$/, ' and $1');
const pc = (v: number): string => `${Math.round(v * 100)}%`;

/**
 * Tip text for the style chips: the out-of-fold win rates on sections that filled (omitted without the summary), then the cost note.
 * Empty without presets.
 */
export function styleTipLines(presets: readonly BidPreset[], summary: MeasuredWinSummary | null = null): string[] {
  if (!presets.length) return [];
  const lines: string[] = [];
  if (summary) {
    const when = summary.terms?.length === 2 ? `In ${summary.terms[0]} and ${summary.terms[1]}` : 'In past terms';
    const o = summary.overall;
    lines.push(`${when}, on sections that filled: Cheap would have won ${pc(o.cheap)}, Balanced ${pc(o.balanced)}, Safe ${pc(o.safe)}.`);
  }
  lines.push(`${presets[presets.length - 1].label} can cost more.`);
  return lines;
}

/** Shown for one bidder at the minimum bid, in place of the "if the section fills" figure. */
export const FLOOR_TEXT = 'If seats are left over, this bid wins. If the section fills, this bid often loses.';

/** Shown instead of a group's bid and chances. */
export const GROUP_NOTICE = 'Group estimates are being revised.';
export const GROUP_NOTICE_ACTION = 'Bid for 1 person';

const SOURCE_TEXT = { cell: 'this round and price range', group: 'whole round average', all: 'all rounds' } as const;

/** One style's past win rate with its case count and where it comes from; "Below aim in past terms." only when the data says so. */
export function pastRateText(r: PastRate): string {
  const src = r.source ? ` (${SOURCE_TEXT[r.source]})` : '';
  return `${joinStyles(r.styles)} would have won ${pc(r.rate)} of ${r.nFilled} filled cases${src}.${r.belowAim ? ' Below aim in past terms.' : ''}`;
}

/** The aim of each of these styles could not be reached for this round. */
export const unreachedText = (styles: readonly BidStyleKey[]): string => {
  const aims = styles.map((k) => `${Math.round(STYLE_TARGET[k] * 100)}%`);
  return styles.length === 1
    ? `${STYLE_LABEL[styles[0]]} couldn't reach its ${aims[0]} aim for this round in past terms.`
    : `${joinStyles(styles)} couldn't reach their aims (${aims.join(', ')}) for this round in past terms.`;
};

/** "Same bid as Balanced and Safe." */
export const sameBidText = (others: readonly BidStyleKey[]): string => `Same bid as ${joinStyles(others)}.`;

/** What the chosen style means, for the info tip next to the section list. */
export function styleMeaning(preset: BidPreset): string {
  const loss = preset.lossFilled;
  if (typeof loss !== 'number') return 'Bids are for 1 person.';
  const [k, n] = nearestFraction(loss);
  return `Bids are for 1 person. ${preset.label} aims to win about ${n - k} in ${n} times even when the section fills.`;
}

const REASON_TEXT: Record<LowConfidenceReason, string> = {
  oneSeat: 'Only 1 seat: the price is set by the single highest bid, so it swings a lot.',
  lateWindow: 'Late round: few seats and few bids, so prices are harder to predict.',
  farWindow: "Forecast made before the earlier windows' results are in, so it's less certain.",
};

/** The window's own flag: the backtests found it harder to forecast than most (few filled sections, or the ranges missed too often). */
export const HARD_WINDOW_TEXT = 'This window was harder to forecast in past terms.';

/** One plain sentence per reason a forecast deserves less trust; `hardWindow` adds the window flag as a last line. */
export const lowConfidenceLines = (reasons: readonly LowConfidenceReason[], hardWindow = false): string[] => [
  ...reasons.map((r) => REASON_TEXT[r]),
  ...(hardWindow ? [HARD_WINDOW_TEXT] : []),
];

export interface StyleResult {
  label: string;
  /** Share of sections that filled where this style's bid won, 0..1. */
  wonFilled: number;
  /** Share of all sections (filled or not) where it won, 0..1. */
  wonAll: number;
  /** wonFilled as a simple fraction: "about 7 in 10". */
  wonFilledText: string;
}

/** What each style did on the held-out term, for /method. Empty unless every style carries both numbers. */
export function styleResults(levels: BidLevels | null | undefined): StyleResult[] {
  if (!levels) return [];
  const rows = ([['Cheap', levels.cheap], ['Balanced', levels.balanced], ['Safe', levels.safe]] as const).map(([label, l]) =>
    typeof l.lossFilled === 'number' ? { label, wonFilled: 1 - l.lossFilled, wonAll: 1 - l.lossAll, wonFilledText: aboutInN(1 - l.lossFilled) } : null,
  );
  return rows.every((r) => r !== null) ? (rows as StyleResult[]) : [];
}
