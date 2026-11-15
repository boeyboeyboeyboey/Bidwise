// The bid and chance each open section row shows, worked out at build time so they are in the course page's HTML.
// The build and the browser run the same functions (simSection, suggestBid, pInAt), so the numbers are the ones the browser would compute.
import type { Section } from '../../lib/data/types';
import { seatsLeftNow } from '../../lib/data/seats';
import { pInAt, type SimResult } from '../../lib/sim';
import { effectiveWindow } from '../../lib/sim/forecast';
import { rowLowConfidence, suggestBid } from '../../lib/sim/presets';
import type { RowBid } from './sections';
import { simSection } from './sectionSim';

/** A row's bid, as CourseView shows it: the suggested bid for `target`, its chance, and whether the forecast deserves less trust. */
export function rowBidOf(r: SimResult, target: number, seats: number, win: string): RowBid {
  const cents = suggestBid(r, target);
  return { cents, p: pInAt(r, cents), low: rowLowConfidence(seats, win, true).length > 0 };
}

export interface RowSeed {
  /** The window the numbers are for: the build's current window. */
  window: string;
  /** The chance the suggested bids aim for. */
  target: number;
  /** By class number, for sections with seats left; null = no forecast for the section. */
  bySection: Record<string, RowBid | null>;
}

/** Whether the seed's numbers are the ones the page would compute for the window and chance now in force. */
export function seedUsable(seed: RowSeed | undefined | null, currentName: string, chosen: string | null, target: number): seed is RowSeed {
  return !!seed && seed.target === target && currentName === seed.window && (chosen === null || chosen === seed.window);
}

/** Build time: one simulation per open section for the current window (sections carry their forecast parameters here). */
export async function buildRowSeed(sections: readonly Section[], forecastWindows: readonly string[], window: string, target: number): Promise<RowSeed> {
  const bySection: RowSeed['bySection'] = {};
  for (const s of sections) {
    const seats = seatsLeftNow(s);
    if (seats <= 0) continue;
    const win = effectiveWindow(null, window, forecastWindows.filter((w) => !!s.forecast?.[w]));
    let r: SimResult | null = null;
    try {
      r = (await simSection(s, win, 1)) ?? null;
    } catch {
      r = null;
    }
    bySection[s.classNumber] = r ? rowBidOf(r, target, seats, win) : null;
  }
  return { window, target, bySection };
}
