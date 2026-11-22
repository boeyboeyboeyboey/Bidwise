// Plain-text helpers for the professor page. Pure, so they stay out of the markup.
import { formatSlot } from '../../lib/format/slot';
import { fullWindow } from '../explore/browse';
import { eS } from '../course/fmt';
import type { ProfCourse, ProfPastSection, ProfSection } from '../../lib/data/professors';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const courseCountText = (n: number): string => plural(n, 'course');

/** The instructor filter only when it shows all of this professor's rows; otherwise the whole course history. */
export const historyHref = (c: Pick<ProfCourse, 'code' | 'historyQuery' | 'historyComplete'>): string =>
  `/course/${c.code}/history/${c.historyComplete && c.historyQuery ? `?i=${encodeURIComponent(c.historyQuery)}` : ''}`;

export const slotText = (s: Pick<ProfSection, 'meetings'>): string => formatSlot(s.meetings) || 'Time not set';

/** A past section's day and time from its history-row fields. */
export const pastSlotText = (s: Pick<ProfPastSection, 'days' | 'start' | 'end'>): string => formatSlot(s) || 'Time not set';

/** "12 of 48"; "~12 of 48" when estimated from the previous window; '' with no seat data. */
export function seatsText(live: ProfSection['live']): string {
  if (!live || !Number.isFinite(live.available) || !Number.isFinite(live.total)) return '';
  return `${live.source === 'approx' ? '~' : ''}${live.available} of ${live.total}`;
}

/** "Median e$23.50, lowest e$18.00" plus the window when it is not Round 1 Window 1; null for no bid result. */
export function bidText(bid: ProfPastSection['bid']): { text: string; window: string } | null {
  if (!bid) return null;
  const text = [
    bid.medianCents !== null ? `Median ${eS(bid.medianCents)}` : '',
    bid.minCents !== null ? `${bid.medianCents !== null ? 'lowest' : 'Lowest'} ${eS(bid.minCents)}` : '',
  ].filter(Boolean).join(', ');
  const window = fullWindow(bid.window);
  return { text, window: window === 'Round 1 Window 1' ? '' : window };
}
