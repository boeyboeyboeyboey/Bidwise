// The "Seats updated 3 h ago · next scan 21:00" line, and the seat-scan times the section rows need in the browser.
// Pure core (agoText, nextScan, freshnessText) plus a reader for the <script id="seat-data"> that Base.astro writes. Unit tested (freshness.test.ts).
import { parseWhen } from './window';
import { scanTimeText } from './seats';

/** Scan times as baked at build time (ISO, SGT). */
export interface SeatMeta {
  scanAt?: string | null;
  capturedAt?: string | null;
  openScanAt?: string | null;
  prevScanAt?: string | null;
  window?: string | null;
}

export interface WindowSpan {
  round: string;
  window: number;
  opensAt: string;
  closesAt: string;
}

export interface NextScan {
  /** Epoch ms of the scan. */
  at: number;
  /** "Round 2 Window 1": set when this is the first scan of a window that has not opened yet. */
  opens: string | null;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SGT_OFFSET = 8 * HOUR;
/** The scheduler scans at the window's open + 10 min and at 09:00 and 21:00 SGT. */
const OPEN_DELAY = 10 * MIN;
const DAILY_HOURS = [9, 21];
/** A scan slot within this long of the window's close is skipped. */
const CLOSE_GUARD = 2 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wall-clock parts in SGT, whatever the viewer's zone. */
function sgt(ms: number) {
  const d = new Date(ms + SGT_OFFSET);
  return { day: Math.floor((ms + SGT_OFFSET) / DAY), date: d.getUTCDate(), month: d.getUTCMonth(), weekday: d.getUTCDay(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

const two = (n: number) => String(n).padStart(2, '0');

/** "21:00" when `ms` is today in SGT, else "Mon 11 Jan, 10:10". */
export function whenText(ms: number, now: number): string {
  const t = sgt(ms);
  const time = `${two(t.hh)}:${two(t.mm)}`;
  return t.day === sgt(now).day ? time : `${WEEKDAYS[t.weekday]} ${t.date} ${MONTHS[t.month]}, ${time}`;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". Empty when the time is unreadable. */
export function agoText(then: number, now: number): string {
  if (Number.isNaN(then) || Number.isNaN(now)) return '';
  const d = Math.max(0, now - then);
  if (d < MIN) return 'just now';
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  const days = Math.floor(d / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Scan slots of one window, oldest first: open + 10 min, then each 09:00 and 21:00 SGT, minus any within 2 h of the close. */
function slots(opens: number, closes: number): number[] {
  const out = new Set<number>([opens + OPEN_DELAY]);
  const firstDay = Math.floor((opens + SGT_OFFSET) / DAY) * DAY - SGT_OFFSET;
  for (let day = firstDay; day < closes; day += DAY) {
    for (const h of DAILY_HOURS) {
      const t = day + h * HOUR;
      if (t > opens) out.add(t);
    }
  }
  return [...out].filter((t) => closes - t >= CLOSE_GUARD).sort((a, b) => a - b);
}

/** The next scheduled scan after `now`, or null when no window is left (or a time is unreadable). */
export function nextScan(schedule: readonly WindowSpan[], now: number): NextScan | null {
  let best: NextScan | null = null;
  for (const w of schedule) {
    const opens = parseWhen(w.opensAt);
    const closes = parseWhen(w.closesAt);
    if (Number.isNaN(opens) || Number.isNaN(closes) || closes <= now) continue;
    for (const t of slots(opens, closes)) {
      if (t > now && (!best || t < best.at)) {
        best = { at: t, opens: now < opens ? `Round ${w.round} Window ${w.window}` : null };
        break;
      }
    }
  }
  return best;
}

/** The scan the data is from: the newest scan, else the capture time. */
function seatsTime(meta: SeatMeta): string {
  return meta.scanAt || meta.capturedAt || '';
}

/** Server-rendered fallback: "Seats as of 12 Nov, 00:03". Empty without a time. */
export function fallbackText(meta: SeatMeta | null | undefined): string {
  const t = meta ? scanTimeText(seatsTime(meta)) : '';
  return t ? `Seats as of ${t}` : '';
}

/** "Seats updated 3 h ago · next scan 21:00" (or "· next scan Mon 11 Jan, 10:10 when Round 2 Window 1 opens"). Empty without a time. */
export function freshnessText(meta: SeatMeta | null | undefined, schedule: readonly WindowSpan[], now: number): string {
  if (!meta) return '';
  const ago = agoText(parseWhen(seatsTime(meta)), now);
  if (!ago) return '';
  const next = nextScan(schedule, now);
  const nextText = next ? ` · next scan ${whenText(next.at, now)} SGT${next.opens ? ` when ${next.opens} opens` : ''}` : '';
  return `Seats updated ${ago}${nextText}`;
}

// ---- browser ----
let cached: SeatMeta | null | undefined;

/** Base.astro writes the scan times into <script id="seat-data" type="application/json">. Null when absent or unreadable. */
export function readSeatMeta(): SeatMeta | null {
  if (cached !== undefined) return cached;
  try {
    const el = document.getElementById('seat-data');
    cached = el?.textContent ? (JSON.parse(el.textContent) as SeatMeta) : null;
  } catch {
    cached = null;
  }
  return cached;
}
