// The forecast version note, e.g. "Forecast refit 12 Nov after Round 1B Window 2 results (998 new bids)".
import type { ForecastMeta } from './types';

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Singapore' });

/** Null when the refit time is missing or unreadable; a missing window or bid count just drops that part. */
export function refitNote(m: Pick<ForecastMeta, 'refitAt' | 'afterWindow' | 'newBids'> | null | undefined): string | null {
  const at = m?.refitAt ? new Date(m.refitAt) : null;
  if (!m || !at || Number.isNaN(at.getTime())) return null;
  let s = `Forecast refit ${DAY.format(at)}`;
  if (m.afterWindow) s += ` after ${m.afterWindow} results`;
  if (typeof m.newBids === 'number' && m.newBids > 0) s += ` (${m.newBids.toLocaleString('en-US')} new ${m.newBids === 1 ? 'bid' : 'bids'})`;
  return s;
}
