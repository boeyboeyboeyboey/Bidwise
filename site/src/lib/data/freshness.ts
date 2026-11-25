// The "Seats updated 3 h ago" line, and the seat-scan times the section rows need in the browser.
// Pure core (agoText, freshnessText) plus a reader for the <script id="seat-data"> that Base.astro writes. Unit tested (freshness.test.ts).
// The site never shows when scans happen: only a rough "updated" age (nearest hour, then nearest day) or the day.
import { parseWhen } from './window';
import { scanDayText } from './seats';

/** Update times as baked at build time (SGT), already coarsened by scanTime.publicSeatMeta: scanAt and capturedAt to the hour, the others to the day. */
export interface SeatMeta {
  scanAt?: string | null;
  capturedAt?: string | null;
  openScanAt?: string | null;
  prevScanAt?: string | null;
  window?: string | null;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** "in the last hour", "3 h ago", "2 days ago": rounded to the nearest hour, then the nearest day. Empty when the time is unreadable. */
export function agoText(then: number, now: number): string {
  if (Number.isNaN(then) || Number.isNaN(now)) return '';
  const d = Math.max(0, now - then);
  const h = Math.round(d / HOUR);
  if (h < 1) return 'in the last hour';
  if (h < 24) return `${h} h ago`;
  const days = Math.round(d / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The scan the data is from: the newest scan, else the capture time. */
function seatsTime(meta: SeatMeta): string {
  return meta.scanAt || meta.capturedAt || '';
}

/** Server-rendered fallback: "Seats updated 12 Nov". Empty without a time. */
export function fallbackText(meta: SeatMeta | null | undefined): string {
  const t = meta ? scanDayText(seatsTime(meta)) : '';
  return t ? `Seats updated ${t}` : '';
}

/** "Seats updated 3 h ago". Empty without a time. */
export function freshnessText(meta: SeatMeta | null | undefined, now: number): string {
  if (!meta) return '';
  const ago = agoText(parseWhen(seatsTime(meta)), now);
  return ago ? `Seats updated ${ago}` : '';
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
