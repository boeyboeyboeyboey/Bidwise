// Pure logic for the home-page countdown. All schedule times are SGT (+08:00); they are turned into absolute
// instants, so a viewer in any time zone counts down to the same moment. Display times are always SGT.
import { parseWhen } from '../../lib/data/window';

export interface CountdownWindow { label: string; opensAt: string; closesAt: string }

export interface Target {
  /** "closes": now is inside this window. "opens": the next window ahead. */
  kind: 'closes' | 'opens';
  label: string;
  /** Epoch ms of the moment being counted down to. */
  at: number;
}

/**
 * Inside a window [opens, closes): that window, counting to its close. Otherwise the earliest window opening
 * after `now`, counting to its opening. Null when nothing is ahead or no window has a readable time.
 * Re-evaluating on every tick makes the state roll over by itself when a countdown reaches zero.
 */
export function pickTarget(windows: readonly CountdownWindow[], now: number): Target | null {
  const timed = windows
    .map((w) => ({ label: w.label, opens: parseWhen(w.opensAt), closes: parseWhen(w.closesAt) }))
    .filter((t) => !Number.isNaN(t.opens) && !Number.isNaN(t.closes))
    .sort((a, b) => a.opens - b.opens);
  const inside = timed.find((t) => t.opens <= now && now < t.closes);
  if (inside) return { kind: 'closes', label: inside.label, at: inside.closes };
  const next = timed.find((t) => t.opens > now);
  return next ? { kind: 'opens', label: next.label, at: next.opens } : null;
}

export interface Segment { value: string; unit: 'd' | 'h' | 'm' | 's' }

/**
 * Remaining time as segments. Under a day: "9h 42m 18s" (leading zero units dropped: "42m 18s", "18s").
 * A day or more: "2d 4h 10m", no seconds. Seconds are rounded up, so "0s" never shows before the rollover.
 * Minutes and seconds after the first unit are zero-padded to two digits so the width stays steady while ticking.
 */
export function segments(ms: number): Segment[] {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const raw: [number, Segment['unit']][] = d >= 1
    ? [[d, 'd'], [h, 'h'], [m, 'm']]
    : h >= 1 ? [[h, 'h'], [m, 'm'], [s, 's']]
    : m >= 1 ? [[m, 'm'], [s, 's']]
    : [[s, 's']];
  return raw.map(([n, unit], i) => ({ value: i > 0 && (unit === 'm' || unit === 's') ? String(n).padStart(2, '0') : String(n), unit }));
}

/** "9h 42m 18s" */
export const countdownText = (ms: number): string => segments(ms).map((p) => p.value + p.unit).join(' ');

/** Under an hour: the figure turns to the warning colour. */
export const isUrgent = (ms: number): boolean => ms < 3_600_000;

/** Milliseconds until the displayed figure next changes (the next whole-second boundary of the remaining time). */
export function msToNextTick(ms: number): number {
  const r = ((ms % 1000) + 1000) % 1000;
  return (r === 0 ? 1000 : r) + 5;
}

const SGT_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore',
});

/** "Tue 10 Nov, 10:00 SGT", whatever the viewer's own time zone. */
export function formatSgt(ms: number): string {
  const p = Object.fromEntries(SGT_FORMAT.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} SGT`;
}

/** The phrase before the figure: "Round 1B Window 1 closes in". */
export const leadText = (t: Target): string => `${t.label} ${t.kind === 'closes' ? 'closes' : 'opens'} in`;

/** Screen-reader summary, to the minute so it changes once a minute rather than every second. */
export function ariaSummary(t: Target, ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [d && unit(d, 'day'), (d || h) && unit(h, 'hour'), unit(m, 'minute')].filter(Boolean);
  return `${leadText(t)} ${parts.join(' ')}, ${formatSgt(t.at)}`;
}
