// Plain-words text for the bid styles (Cheap / Balanced / Safe), built from the held-out backtest numbers. No DOM.
import type { BidLevels } from '../../lib/data/types';
import type { BidPreset, LowConfidenceReason } from '../../lib/sim/presets';

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

/** Tip text for the style chips; empty unless every preset carries its backtest number. */
export function styleTipLines(presets: readonly BidPreset[]): string[] {
  if (!presets.length || presets.some((p) => typeof p.lossFilled !== 'number')) return [];
  const parts = presets.map((p, i) => `${i === 0 ? `${p.label} bids lost` : p.label} ${aboutInN(p.lossFilled as number)}`);
  return [`Last term, of the sections that filled: ${parts.join(', ')}.`, `${presets[presets.length - 1].label} costs more.`];
}

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
