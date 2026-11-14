// How seat counts moved this window: marker text, tooltip, sparkline points and the "most freed" list.
// Only live-scan sections carry deltas. Approx or missing data gives no marker. Pure, so it is unit tested (seatDeltas.test.ts).
import type { LiveSeats, SeatPoint } from './types';
import { scanTimeText } from './seats';

export interface DeltaInput {
  live?: LiveSeats;
}

export type DeltaTone = 'up' | 'down';

export interface DeltaMarker {
  /** "+3" or "−2" (a real minus sign). */
  text: string;
  tone: DeltaTone;
  /** Tooltip: since open, then since the previous scan when that also moved. */
  title: string;
  /** Screen-reader text. */
  label: string;
}

const MINUS = '−';

function usable(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n !== 0;
}

/** "+3", "−2", or '' for zero, null, undefined or NaN. */
export function deltaText(n: number | null | undefined): string {
  if (!usable(n)) return '';
  return n > 0 ? `+${n}` : `${MINUS}${Math.abs(n)}`;
}

/** The marker for a section's seat count, or null (approx, no data, or no change since the window opened). */
export function deltaMarker(s: DeltaInput, openScanAt?: string | null, prevScanAt?: string | null): DeltaMarker | null {
  const v = s.live;
  if (!v || v.source !== 'live' || !usable(v.sinceOpen)) return null;
  const at = (iso?: string | null) => {
    const t = scanTimeText(iso);
    return t ? ` (${t})` : '';
  };
  let title = `${deltaText(v.sinceOpen)} since the window opened${at(openScanAt)}`;
  if (usable(v.sinceLast)) title += ` · ${deltaText(v.sinceLast)} since the previous scan${at(prevScanAt)}`;
  return { text: deltaText(v.sinceOpen), tone: v.sinceOpen > 0 ? 'up' : 'down', title, label: title };
}

export interface ScanBadge {
  /** "−3 since 09:00" (a real minus sign), or "+2 since 10 Nov, 21:00" when the previous scan was on another day. */
  text: string;
  tone: DeltaTone;
  /** Screen-reader text: "3 fewer seats since 09:00". */
  label: string;
  /** Change since the previous scan; the same as sinceOpen when that scan was the window-open one. */
  n: number;
}

/**
 * Badge for a row from the change since the previous scan (`sinceLast`). Null for zero, missing or an unreadable scan time.
 * The time is the real previous scan time; a scan on the same day as the newest one is just "09:00", else "10 Nov, 21:00".
 */
export function scanBadgeFor(sinceLast: number | null | undefined, prevScanAt?: string | null, scanAt?: string | null): ScanBadge | null {
  if (!usable(sinceLast)) return null;
  const full = scanTimeText(prevScanAt);
  if (!full) return null;
  const day = (iso?: string | null) => /^\d{4}-\d{2}-\d{2}/.exec(iso ?? '')?.[0];
  const since = scanAt && day(prevScanAt) === day(scanAt) ? full.slice(full.indexOf(',') + 2) : full;
  const k = Math.abs(sinceLast);
  return {
    text: `${deltaText(sinceLast)} since ${since}`,
    tone: sinceLast > 0 ? 'up' : 'down',
    label: `${k} ${sinceLast > 0 ? 'more' : 'fewer'} ${k === 1 ? 'seat' : 'seats'} since ${since}`,
    n: sinceLast,
  };
}

/** The badge for a section: only when it was seen live (approx sections have no scan change). */
export function scanBadge(s: DeltaInput, prevScanAt?: string | null, scanAt?: string | null): ScanBadge | null {
  const v = s.live;
  return v && v.source === 'live' ? scanBadgeFor(v.sinceLast, prevScanAt, scanAt) : null;
}

/** Second line for the last scan's change, '' when it is zero, null or the section is not live. */
export function lastScanText(s: DeltaInput): string {
  const v = s.live;
  if (!v || v.source !== 'live' || !usable(v.sinceLast)) return '';
  return `${deltaText(v.sinceLast)} since last scan`;
}

export interface Spark {
  /** SVG polyline `points` in a width x height box, y inverted (more seats = higher). */
  points: string;
  first: number;
  last: number;
  min: number;
  max: number;
  count: number;
}

/** Sparkline geometry for a section's history, or null with fewer than 2 valid points. Even spacing in scan order. */
export function sparkline(history: readonly SeatPoint[] | undefined, width: number, height: number, pad = 2): Spark | null {
  const pts = (history ?? []).filter((p) => p && Number.isFinite(p.available));
  if (pts.length < 2) return null;
  const ys = pts.map((p) => p.available);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = pts
    .map((p, i) => {
      const x = pad + (innerW * i) / (pts.length - 1);
      const y = span === 0 ? height / 2 : pad + innerH * (1 - (p.available - min) / span);
      return `${+x.toFixed(1)},${+y.toFixed(1)}`;
    })
    .join(' ');
  return { points, first: ys[0], last: ys[ys.length - 1], min, max, count: pts.length };
}

export interface FreedRow {
  code: string;
  section: string;
  instructor?: string;
  classNumber?: string;
  sinceOpen: number;
  available: number;
  total: number;
}

/** Sections with the most seats freed since the window opened (sinceOpen > 0, live only), biggest first, ties by code then section. */
export function topFreed(
  items: readonly { code: string; section: string; instructor?: string; classNumber?: string; live?: LiveSeats }[],
  limit = 8,
): FreedRow[] {
  const rows: FreedRow[] = [];
  for (const it of items) {
    const v = it.live;
    if (!v || v.source !== 'live' || !usable(v.sinceOpen) || v.sinceOpen < 0) continue;
    rows.push({ code: it.code, section: it.section, instructor: it.instructor, classNumber: it.classNumber, sinceOpen: v.sinceOpen, available: v.available, total: v.total });
  }
  rows.sort((a, b) => b.sinceOpen - a.sinceOpen || a.code.localeCompare(b.code) || a.section.localeCompare(b.section, undefined, { numeric: true }));
  return rows.slice(0, limit);
}
