// Pure helpers for the course page's Swap mode: URL state, chip text and tone, row order, tooltip lines.
import type { SwapLabel, SwapOption } from '../../lib/swap/swap';

export type Mode = 'bid' | 'swap';

/** What a row shows in the swap column. */
export type SwapCell = { kind: 'mine' } | { kind: 'pick' } | { kind: 'wait' } | { kind: 'opt'; opt: SwapOption };

export const SWAP_DISCLAIMER = "Rough guide only. SMU doesn't publish swap results; we assume direct one-for-one swaps.";

/** ?mode=swap and ?from=G9 (the person's own section) make a swap view linkable. */
export function modeFromUrl(search: string): { mode: Mode; from: string | null } {
  const p = new URLSearchParams(search);
  const from = p.get('from')?.trim() || null;
  return { mode: p.get('mode') === 'swap' ? 'swap' : 'bid', from };
}

/** The query string for a mode and own section, keeping any other parameters (e.g. ?s=). Bid mode drops both. */
export function modeToSearch(search: string, mode: Mode, from: string | null): string {
  const p = new URLSearchParams(search);
  p.delete('mode');
  p.delete('from');
  if (mode === 'swap') {
    p.set('mode', 'swap');
    if (from) p.set('from', from);
  }
  const q = p.toString();
  return q ? `?${q}` : '';
}

export type Tone = 'good' | 'mid' | 'bad' | 'none';
export const CHIP: Record<SwapLabel, { text: string; tone: Tone }> = {
  likely: { text: 'Likely', tone: 'good' },
  possible: { text: 'Possible', tone: 'mid' },
  unlikely: { text: 'Unlikely', tone: 'bad' },
  unknown: { text: 'Unknown', tone: 'none' },
};
export const chipFor = (label: SwapLabel) => CHIP[label];

const RANK: Record<SwapLabel, number> = { likely: 0, possible: 1, unlikely: 2, unknown: 3 };

/** Own section first, then Likely, Possible, Unlikely, unknown. Ties keep the incoming order. */
export function orderForSwap<T extends { section: string }>(rows: readonly T[], mine: string | null, opts: ReadonlyMap<string, SwapOption>): T[] {
  const key = (r: T) => (r.section === mine ? -1 : RANK[opts.get(r.section)?.label ?? 'unknown']);
  return rows.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
}

/** Nearest 5 percent: the model is a judgment call, so finer figures would claim too much. */
const rough = (x: number) => Math.round((x * 100) / 5) * 5;

/** "About 65%", or "Under 5%". null when there is no estimate. */
export function roughText(o: Pick<SwapOption, 'chance'>): string | null {
  if (o.chance == null) return null;
  const c = rough(o.chance);
  return c < 5 ? 'Under 5%' : `About ${c}%`;
}

/** "55–75%", or "55%" when the ends round to the same number. null when there is no range. */
export function rangeText(o: Pick<SwapOption, 'chanceLow' | 'chanceHigh'>): string | null {
  if (o.chanceLow == null || o.chanceHigh == null) return null;
  const a = rough(o.chanceLow);
  const b = rough(o.chanceHigh);
  return a === b ? `${a}%` : `${a}–${b}%`;
}

export function basisText(o: Pick<SwapOption, 'fallback' | 'preAssigned' | 'sampleSize'>): string {
  if (o.fallback) return 'Estimate from last term’s bids.';
  if (o.preAssigned) return 'Most seats here are pre-assigned, so this uses the usual bid level for each instructor and time slot.';
  if (o.sampleSize === 0) return 'Based on predicted bids, estimated from similar courses.';
  return `Based on predicted bids from ${o.sampleSize} past ${o.sampleSize === 1 ? 'result' : 'results'}.`;
}

/** Lines for a chip's InfoTip. */
export function chipTipLines(o: SwapOption): string[] {
  const r = rangeText(o);
  const t = roughText(o);
  if (!r || !t) return ['No seat count for this section, so no estimate.'];
  return [`${t} · range ${r}`, basisText(o), 'Set by judgment of how hard swaps are, not measured from real swaps.'];
}
