import { describe, expect, it } from 'vitest';
import { deltaMarker, deltaText, lastScanText, scanBadge, scanBadgeFor, sparkline, topFreed } from './seatDeltas';

const live = (o: Record<string, unknown> = {}) => ({
  available: 6, total: 48, source: 'live' as const, capturedAt: '2026-11-07T09:42:39+08:00', window: 'w', ...o,
});

describe('deltaText', () => {
  it('signs with a real minus and hides zero and missing', () => {
    expect(deltaText(3)).toBe('+3');
    expect(deltaText(-2)).toBe('−2');
    expect(deltaText(0)).toBe('');
    expect(deltaText(null)).toBe('');
    expect(deltaText(undefined)).toBe('');
    expect(deltaText(NaN)).toBe('');
  });
});

describe('deltaMarker', () => {
  it('is green for freed seats, with the last-scan change in the tooltip', () => {
    const m = deltaMarker({ live: live({ sinceOpen: 4, sinceLast: -1 }) }, '2026-11-06T17:29:20+08:00', '2026-11-07T01:30:50+08:00');
    expect(m).toMatchObject({ text: '+4', tone: 'up' });
    expect(m?.title).toBe('+4 since the window opened (6 Nov, 17:29) · −1 since the previous scan (7 Nov, 01:30)');
  });
  it('is red for taken seats and omits a zero last-scan change', () => {
    const m = deltaMarker({ live: live({ sinceOpen: -2, sinceLast: 0 }) });
    expect(m).toMatchObject({ text: '−2', tone: 'down' });
    expect(m?.title).toBe('−2 since the window opened');
  });
  it('shows nothing for zero, null, missing or approx', () => {
    expect(deltaMarker({ live: live({ sinceOpen: 0, sinceLast: 3 }) })).toBeNull();
    expect(deltaMarker({ live: live({ sinceOpen: null }) })).toBeNull();
    expect(deltaMarker({ live: live() })).toBeNull();
    expect(deltaMarker({})).toBeNull();
    expect(deltaMarker({ live: live({ source: 'approx', sinceOpen: 5 }) })).toBeNull();
  });
});

describe('lastScanText', () => {
  it('describes a non-zero change on a live section only', () => {
    expect(lastScanText({ live: live({ sinceLast: 2 }) })).toBe('+2 since last scan');
    expect(lastScanText({ live: live({ sinceLast: 0 }) })).toBe('');
    expect(lastScanText({ live: live({ source: 'approx', sinceLast: 2 }) })).toBe('');
  });
});

describe('sparkline', () => {
  const h = (...n: number[]) => n.map((available, i) => ({ at: `2026-11-0${i + 1}T00:00:00+08:00`, available }));
  it('needs two points', () => {
    expect(sparkline(undefined, 60, 20)).toBeNull();
    expect(sparkline(h(3), 60, 20)).toBeNull();
  });
  it('puts more seats higher and spans the box', () => {
    const s = sparkline(h(2, 6, 4), 60, 20, 2)!;
    expect(s.points).toBe('2,18 30,2 58,10');
    expect([s.first, s.last, s.min, s.max, s.count]).toEqual([2, 4, 2, 6, 3]);
  });
  it('draws a flat history in the middle', () => {
    expect(sparkline(h(5, 5), 60, 20, 2)!.points).toBe('2,10 58,10');
  });
});

describe('topFreed', () => {
  const sec = (code: string, section: string, l?: ReturnType<typeof live>) => ({ code, section, live: l });
  it('keeps live sections with seats freed, biggest first, capped', () => {
    const rows = topFreed([
      sec('B', 'G1', live({ sinceOpen: 2 })),
      sec('A', 'G1', live({ sinceOpen: 2 })),
      sec('C', 'G1', live({ sinceOpen: 9 })),
      sec('D', 'G1', live({ sinceOpen: 0 })),
      sec('E', 'G1', live({ sinceOpen: -3 })),
      sec('F', 'G1', live({ sinceOpen: null })),
      sec('G', 'G1', live({ source: 'approx', sinceOpen: 7 })),
      sec('H', 'G1'),
    ], 3);
    expect(rows.map((r) => `${r.code}${r.sinceOpen}`)).toEqual(['C9', 'A2', 'B2']);
  });
});

describe('scanBadge', () => {
  const NEWEST = '2026-11-12T21:00:00+08:00';
  it('says how many seats were taken since the previous scan, with its time', () => {
    expect(scanBadge({ live: live({ sinceLast: -3 }) }, '2026-11-12T09:00:00+08:00', NEWEST)).toMatchObject({ text: '−3 since 09:00', tone: 'down', label: '3 fewer seats since 09:00', n: -3 });
  });
  it('says how many were freed, singular for one', () => {
    expect(scanBadge({ live: live({ sinceLast: 2 }) }, '2026-11-12T09:00:00+08:00', NEWEST)).toMatchObject({ text: '+2 since 09:00', tone: 'up', label: '2 more seats since 09:00' });
    expect(scanBadge({ live: live({ sinceLast: 1 }) }, '2026-11-12T09:00:00+08:00', NEWEST)?.label).toBe('1 more seat since 09:00');
  });
  it('adds the date when the previous scan was on another day', () => {
    expect(scanBadge({ live: live({ sinceLast: 2 }) }, '2026-11-11T21:00:00+08:00', NEWEST)?.text).toBe('+2 since 11 Nov, 21:00');
  });
  it('adds the date when the newest scan time is unknown', () => {
    expect(scanBadgeFor(-1, '2026-11-12T09:00:00+08:00')?.text).toBe('−1 since 12 Nov, 09:00');
  });
  it('is null for no change, no data, approx seats or no previous scan time', () => {
    expect(scanBadge({ live: live({ sinceLast: 0 }) }, '2026-11-12T09:00:00+08:00', NEWEST)).toBeNull();
    expect(scanBadge({ live: live({ sinceLast: null }) }, '2026-11-12T09:00:00+08:00', NEWEST)).toBeNull();
    expect(scanBadge({ live: live({ sinceLast: 2, source: 'approx' }) }, '2026-11-12T09:00:00+08:00', NEWEST)).toBeNull();
    expect(scanBadge({}, '2026-11-12T09:00:00+08:00', NEWEST)).toBeNull();
    expect(scanBadge({ live: live({ sinceLast: 2 }) }, null, NEWEST)).toBeNull();
  });
});
