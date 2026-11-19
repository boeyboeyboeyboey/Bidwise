// The bid and chance each open section row shows, worked out at build time so they are in the course page's HTML.
// The build and the browser run the same functions (simSection, suggestBid, pInAt), so the numbers are the ones the browser would compute.
import type { Section } from '../../lib/data/types';
import { seatsLeftNow } from '../../lib/data/seats';
import { pInAt, type SimResult } from '../../lib/sim';
import { effectiveWindow } from '../../lib/sim/forecast';
import { rowLowConfidence, suggestBid } from '../../lib/sim/presets';
import type { RowBid } from './sections';
import { simSection } from './sectionSim';

/** A row's bid, as CourseView shows it: the suggested bid for the style `style` (a key), its chance, and whether the forecast deserves less trust. */
export function rowBidOf(r: SimResult, style: string, seats: number, win: string): RowBid {
  const cents = suggestBid(r, style, win);
  return { cents, p: pInAt(r, cents), low: rowLowConfidence(seats, win, true).length > 0 };
}

export interface RowSeed {
  /** The window the numbers are for: the build's current window. */
  window: string;
  /** The key of the style the suggested bids are for. */
  style: string;
  /** By class number, for sections with seats left; null = no forecast for the section. */
  bySection: Record<string, RowBid | null>;
}

/** Whether the seed's numbers are the ones the page would compute for the window and chance now in force. */
export function seedUsable(seed: RowSeed | undefined | null, currentName: string, chosen: string | null, style: string): seed is RowSeed {
  return !!seed && seed.style === style && currentName === seed.window && (chosen === null || chosen === seed.window);
}

/** Build time: one simulation per open section for the current window (sections carry their forecast parameters here). */
export async function buildRowSeed(sections: readonly Section[], forecastWindows: readonly string[], window: string, style: string): Promise<RowSeed> {
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
    bySection[s.classNumber] = r ? rowBidOf(r, style, seats, win) : null;
  }
  return { window, style, bySection };
}
