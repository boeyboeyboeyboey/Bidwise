// Coarsens seat-data times before they reach a page, public JSON or the browser. Owner rule (25 Nov 2026): no exact
// update times on the site, only to the hour, then the day. Pure, so it is unit tested (scanTime.test.ts).
// model/build_site_data.py already writes these times to the hour; this is the site's own guard, applied at build time.
import type { CourseData, LiveSeats } from './types';

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Nearest hour as written (30 minutes and above round up, across days too), keeping the stamp's own offset. Null when unreadable. */
export function scanHour(iso: string | null | undefined): string | null {
  const m = RE.exec((iso ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00', zone = ''] = m;
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (Number.isNaN(wall)) return null;
  const t = new Date(Math.round(wall / HOUR) * HOUR);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return `${date}T${pad(t.getUTCHours())}:00:00${zone}`;
}

/** The calendar day ("2026-11-25") of the hour-rounded stamp, so it agrees with scanHour. Null when unreadable. */
export function scanDay(iso: string | null | undefined): string | null {
  return scanHour(iso)?.slice(0, 10) ?? null;
}

/** A section's live seats with its times cut to the day (the pages only show the day of a section's update). */
export function coarsenLive(v: LiveSeats): LiveSeats {
  return {
    ...v,
    capturedAt: scanDay(v.capturedAt) ?? '',
    ...(v.history ? { history: v.history.map((p) => ({ ...p, at: scanDay(p.at) ?? '' })) } : {}),
  };
}

/** A course with every section's live-seat times cut to the day. */
export function coarsenCourse(c: CourseData): CourseData {
  return { ...c, sectionsNow: c.sectionsNow.map((s) => (s.live ? { ...s, live: coarsenLive(s.live) } : s)) };
}

export interface PublicSeatMeta {
  scanAt: string | null;
  capturedAt: string | null;
  openScanAt: string | null;
  prevScanAt: string | null;
  window: string;
}

/** The seat times a page may carry: the newest update to the hour (for "3 h ago"), the others to the day. */
export function publicSeatMeta(s: { capturedAt: string; window: string; openScanAt?: string; prevScanAt?: string; scanAt?: string }): PublicSeatMeta {
  return {
    scanAt: scanHour(s.scanAt),
    capturedAt: scanHour(s.capturedAt),
    openScanAt: scanDay(s.openScanAt),
    prevScanAt: scanDay(s.prevScanAt),
    window: s.window,
  };
}
