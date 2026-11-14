import { describe, expect, it } from 'vitest';
import { agoText, fallbackText, freshnessText, nextScan, whenText } from './freshness';
import { parseWhen } from './window';

const at = (iso: string) => parseWhen(iso);
const sched = [
  { round: '1B', window: 1, opensAt: '2026-11-06T17:00:00+08:00', closesAt: '2026-11-10T10:00:00+08:00' },
  { round: '1B', window: 2, opensAt: '2026-11-10T17:00:00+08:00', closesAt: '2026-11-12T10:00:00+08:00' },
  { round: '2', window: 1, opensAt: '2027-01-11T10:00:00+08:00', closesAt: '2027-01-13T10:00:00+08:00' },
];
const next = (now: string) => nextScan(sched, at(now));
const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms + 8 * 3600_000).toISOString().slice(0, 16));

describe('agoText', () => {
  it('uses minutes, hours and days', () => {
    const now = at('2026-11-12T12:00:00+08:00');
    expect(agoText(now - 20_000, now)).toBe('just now');
    expect(agoText(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(agoText(now - 3.5 * 3600_000, now)).toBe('3 h ago');
    expect(agoText(now - 24 * 3600_000, now)).toBe('1 day ago');
    expect(agoText(now - 50 * 3600_000, now)).toBe('2 days ago');
  });
  it('treats a scan slightly in the future (clock skew) as just now, and bad input as empty', () => {
    expect(agoText(1000, 0)).toBe('just now');
    expect(agoText(NaN, 0)).toBe('');
  });
});

describe('whenText', () => {
  it('is a bare time today and a dated time on another day, in SGT', () => {
    const now = at('2026-11-12T08:00:00+08:00');
    expect(whenText(at('2026-11-12T21:00:00+08:00'), now)).toBe('21:00');
    expect(whenText(at('2026-11-13T09:00:00+08:00'), now)).toBe('Fri 13 Nov, 09:00');
    expect(whenText(at('2027-01-11T10:10:00+08:00'), now)).toBe('Mon 11 Jan, 10:10');
  });
  it('reads the day in SGT, not UTC', () => {
    // 23:30 SGT on 12 Nov is 15:30 UTC the same day; 00:30 SGT on 13 Nov is 16:30 UTC on 12 Nov.
    const now = at('2026-11-12T23:30:00+08:00');
    expect(whenText(at('2026-11-13T00:30:00+08:00'), now)).toBe('Fri 13 Nov, 00:30');
  });
});

describe('nextScan', () => {
  it('is the next 09:00 or 21:00 inside an open window', () => {
    expect(iso(next('2026-11-11T10:00:00+08:00')?.at)).toBe('2026-11-11T21:00');
    expect(iso(next('2026-11-10T21:00:00+08:00')?.at)).toBe('2026-11-11T09:00');
    expect(next('2026-11-11T10:00:00+08:00')?.opens).toBeNull();
  });
  it('crosses midnight', () => {
    expect(iso(next('2026-11-10T22:30:00+08:00')?.at)).toBe('2026-11-11T09:00');
    expect(whenText(next('2026-11-10T22:30:00+08:00')?.at ?? 0, at('2026-11-10T22:30:00+08:00'))).toBe('Wed 11 Nov, 09:00');
  });
  it('skips a slot within 2 h of the close and goes to the next window open + 10 min', () => {
    // Window 1B-2 closes 12 Nov 10:00: the 09:00 slot is inside the last 2 h.
    const n = next('2026-11-11T22:00:00+08:00');
    expect(iso(n?.at)).toBe('2027-01-11T10:10');
    expect(n?.opens).toBe('Round 2 Window 1');
  });
  it('keeps a slot just outside the 2 h guard', () => {
    const s = [{ round: '3', window: 1, opensAt: '2026-11-10T17:00:00+08:00', closesAt: '2026-11-12T11:30:00+08:00' }];
    expect(iso(nextScan(s, at('2026-11-11T22:00:00+08:00'))?.at)).toBe('2026-11-12T09:00');
  });
  it('is open + 10 min between windows, labelled with the window', () => {
    const n = next('2026-11-20T12:00:00+08:00');
    expect(iso(n?.at)).toBe('2027-01-11T10:10');
    expect(n?.opens).toBe('Round 2 Window 1');
  });
  it('has the open scan as the first slot of a window, before its first 09:00 or 21:00', () => {
    expect(iso(next('2026-11-10T16:00:00+08:00')?.at)).toBe('2026-11-10T17:10');
    expect(iso(next('2026-11-10T17:10:00+08:00')?.at)).toBe('2026-11-10T21:00');
  });
  it('is null when no window is left or the schedule is empty', () => {
    expect(next('2027-01-13T09:00:00+08:00')).toBeNull();
    expect(nextScan([], 0)).toBeNull();
  });
});

describe('freshnessText', () => {
  const meta = { scanAt: '2026-11-11T09:00:00+08:00', capturedAt: '2026-11-11T09:20:00+08:00' };
  it('joins the age and the next scan', () => {
    expect(freshnessText(meta, sched, at('2026-11-11T12:10:00+08:00'))).toBe('Seats updated 3 h ago · next scan 21:00 SGT');
  });
  it('names the window when the next scan is its opening', () => {
    expect(freshnessText(meta, sched, at('2026-11-12T11:00:00+08:00'))).toBe('Seats updated 1 day ago · next scan Mon 11 Jan, 10:10 SGT when Round 2 Window 1 opens');
  });
  it('omits the next scan when none is left, and is empty without seat data', () => {
    expect(freshnessText(meta, sched, at('2027-02-01T12:00:00+08:00'))).toBe('Seats updated 82 days ago');
    expect(freshnessText(null, sched, 0)).toBe('');
    expect(freshnessText({}, sched, 0)).toBe('');
  });
});

describe('fallbackText', () => {
  it('gives an absolute time for the server render', () => {
    expect(fallbackText({ scanAt: '2026-11-12T00:03:33+08:00', capturedAt: '2026-11-12T00:24:08+08:00' })).toBe('Seats as of 12 Nov, 00:03');
    expect(fallbackText({ capturedAt: '2026-11-12T00:24:08+08:00' })).toBe('Seats as of 12 Nov, 00:24');
    expect(fallbackText(undefined)).toBe('');
  });
});
