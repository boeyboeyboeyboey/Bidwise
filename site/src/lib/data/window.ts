// Which bidding window the site treats as "current". Pure core (chooseWindow) plus the client-side clock.
// Keep chooseWindow identical to choose_window in model/build_site_data.py (the build bakes the same choice into meta.window).
import type { ScheduleEntry, WindowInfo } from './types';

export type WindowStatus = 'open' | 'upcoming' | 'closed';

export interface ChosenWindow extends ScheduleEntry {
  status: WindowStatus;
}

/** Fallback shape: the configured current window as baked into meta.window. */
export type ConfiguredWindow = Pick<WindowInfo, 'round' | 'window' | 'closesAt' | 'status'> & { opensAt?: string };

const SGT = '+08:00';

/** Epoch ms of an ISO time; a time without a zone is read as SGT. NaN when unreadable. */
export function parseWhen(iso: string): number {
  // Match Python's fromisoformat: a space may separate date and time, and a date alone means 00:00 SGT.
  let s = iso.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00';
  return Date.parse(/(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : s + SGT);
}

/**
 * Inside a window [opensAt, closesAt): that window, "open". Else the next window opening after `now`: "upcoming"
 * (mid-round gaps and the gap between rounds alike). Else the last window: "closed".
 * Falls back to the configured current window when the schedule is empty or has an unreadable time.
 */
export function chooseWindow(schedule: readonly ScheduleEntry[], configured: ConfiguredWindow, now: number): ChosenWindow {
  const timed = schedule
    .map((s) => ({ s, opens: parseWhen(s.opensAt), closes: parseWhen(s.closesAt) }))
    .sort((a, b) => a.opens - b.opens);
  if (!timed.length || timed.some((t) => Number.isNaN(t.opens) || Number.isNaN(t.closes))) {
    const m = schedule.find((s) => s.round === configured.round && s.window === configured.window);
    return {
      round: configured.round, window: configured.window,
      opensAt: m?.opensAt ?? configured.opensAt ?? '', closesAt: m?.closesAt ?? configured.closesAt, status: configured.status,
    };
  }
  const inside = timed.find((t) => t.opens <= now && now < t.closes);
  if (inside) return { ...inside.s, status: 'open' };
  const next = timed.find((t) => t.opens > now);
  if (next) return { ...next.s, status: 'upcoming' };
  return { ...timed[timed.length - 1].s, status: 'closed' };
}

// ---- client clock ----
// `?now=2026-11-20T12:00` on any page fakes the clock for the window logic (naive = SGT; it keeps ticking from there).
// For checking the between-rounds views; harmless in production because it only moves what this one visitor sees.
let skew: number | null = null;

/** Date.now(), shifted by ?now= when present. */
export function nowMs(): number {
  if (skew === null) {
    skew = 0;
    try {
      const q = new URLSearchParams(location.search).get('now');
      const t = q ? parseWhen(q) : NaN;
      if (!Number.isNaN(t)) skew = t - Date.now();
    } catch {
      /* no location (tests, SSR) */
    }
  }
  return Date.now() + skew;
}

interface WindowData {
  schedule: ScheduleEntry[];
  configured: ConfiguredWindow;
}

/** Base.astro writes the schedule and the baked window into <script id="win-data" type="application/json">. */
function readData(): WindowData | null {
  try {
    const el = document.getElementById('win-data');
    return el?.textContent ? (JSON.parse(el.textContent) as WindowData) : null;
  } catch {
    return null;
  }
}

/** The window to treat as current right now in the browser (re-evaluated on every call). Null if the page has no data. */
export function liveWindow(now: number = nowMs()): ChosenWindow | null {
  const d = readData();
  return d ? chooseWindow(d.schedule, d.configured, now) : null;
}

/** Label of the live window, or `built` (the one baked at build time) when it cannot be worked out. */
export function liveLabel(built: string): string {
  const w = liveWindow();
  return w ? `Round ${w.round} Window ${w.window}` : built;
}
