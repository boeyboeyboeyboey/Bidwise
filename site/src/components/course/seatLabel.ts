// Plain-words seat text for the section list. Pure, so it is unit tested (seatLabel.test.ts).
import { deltaMarker, type DeltaInput } from '../../lib/data/seatDeltas';
import { fullText, seatsOf, type SeatInput } from '../../lib/data/seats';

/** "3 seats left of 45", "About 3 seats left of 45" (estimate), "Full", or "Likely full (est.)". */
export function seatLabel(s: SeatInput): string {
  const v = seatsOf(s);
  if (v.left <= 0) return fullText(s);
  return `${v.source === 'approx' ? 'About ' : ''}${v.left} ${v.left === 1 ? 'seat' : 'seats'} left of ${v.total}`;
}

/**
 * The old "+1" next to the seat count: how many more (or fewer) seats are free than when the bidding window opened,
 * because of drops. "1 more seat than when the window opened", "2 fewer seats than when the window opened", or '' when unchanged or unknown.
 */
export function seatChange(s: DeltaInput): string {
  const m = deltaMarker(s);
  const n = s.live?.sinceOpen;
  if (!m || typeof n !== 'number') return '';
  const k = Math.abs(n);
  return `${k} ${m.tone === 'up' ? 'more' : 'fewer'} ${k === 1 ? 'seat' : 'seats'} than when the window opened`;
}
