import type { WindowInfo } from './types';

/** e.g. "Round 1A Window 1" */
export function windowLabel(w: Pick<WindowInfo, 'round' | 'window'>): string {
  return `Round ${w.round} Window ${w.window}`;
}

/** e.g. "Mon 9 Nov, 10:00" in SGT */
export function formatWhen(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Asia/Singapore',
    }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute}`;
}

/** Same person across terms: BOSS writes names in upper case, sometimes with a comma. */
export const sameInstructor = (a: string, b: string): boolean => {
  const n = (s: string) => s.toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  return !!a && n(a) === n(b);
};
