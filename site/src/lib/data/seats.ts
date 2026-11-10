// Which seat count to show for a current-term section. Pure, so it is unit tested (seats.test.ts).
// Live = scanned in ClassSearch. Approx = not listed in ClassSearch for this section, taken from the previous
// window's after-process vacancy. Last = no availability file, so the last results window's vacancy.
import type { LiveSeats } from './types';

export type SeatSource = 'live' | 'approx' | 'last';

export interface SeatInput {
  seatsLeft: number;
  seatsTotal?: number;
  live?: LiveSeats;
}

export interface SeatsView {
  left: number;
  total: number;
  source: SeatSource;
  /** ISO time of the scan, null when there is no live data. */
  capturedAt: string | null;
}

export const APPROX_NOTE = "Estimated from the previous window's results; actual availability may differ";
export const SEATS_HELP_HREF = '/method#seats';

export function seatsOf(s: SeatInput): SeatsView {
  const v = s.live;
  if (v && Number.isFinite(v.available) && Number.isFinite(v.total)) {
    return { left: v.available, total: v.total, source: v.source === 'approx' ? 'approx' : 'live', capturedAt: v.capturedAt || null };
  }
  return { left: s.seatsLeft, total: s.seatsTotal ?? s.seatsLeft, source: 'last', capturedAt: null };
}

/** Seats to use for logic (full, group size, simulation). */
export function seatsLeftNow(s: SeatInput): number {
  return seatsOf(s).left;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "7 Nov, 09:42" from an ISO stamp, read as written (the scanner stamps SGT), so it does not depend on the viewer's zone. */
export function scanTimeText(iso: string | null | undefined): string {
  const m = /^\d{4}-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(iso ?? '');
  if (!m || +m[1] < 1 || +m[1] > 12) return '';
  return `${+m[2]} ${MONTHS[+m[1] - 1]}, ${m[3]}`;
}

/** Latest scan time among sections that have live data, as an ISO string, or null. */
export function latestScan(sections: readonly SeatInput[]): string | null {
  let best: string | null = null;
  for (const s of sections) {
    const t = s.live?.capturedAt;
    if (t && (best === null || t > best)) best = t;
  }
  return best;
}

/** Estimated zero: the previous window left nothing, but the section was not scanned, so it may have seats. */
export function isLikelyFull(s: SeatInput): boolean {
  const v = seatsOf(s);
  return v.source === 'approx' && v.left <= 0;
}

/** "Full", or "Likely full (est.)" when the zero is only an estimate. */
export function fullText(s: SeatInput): string {
  return isLikelyFull(s) ? 'Likely full (est.)' : 'Full';
}

/** "3 seats", "about 3 seats" (approx), for messages. */
export function seatsPhrase(s: SeatInput): string {
  const v = seatsOf(s);
  return `${v.source === 'approx' ? 'about ' : ''}${v.left} ${v.left === 1 ? 'seat' : 'seats'}`;
}

export function anyApprox(sections: readonly SeatInput[]): boolean {
  return sections.some((s) => seatsOf(s).source === 'approx');
}
