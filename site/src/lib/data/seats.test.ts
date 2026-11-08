import { describe, expect, it } from 'vitest';
import { anyApprox, fullText, isLikelyFull, latestScan, scanTimeText, seatsLeftNow, seatsOf, seatsPhrase } from './seats';

const live = (o: Partial<{ available: number; total: number; source: 'live' | 'approx'; capturedAt: string }> = {}) => ({
  available: 6, total: 48, source: 'live' as const, capturedAt: '2026-11-07T09:42:39+08:00', window: 'Round 1B Window 1', ...o,
});

describe('seatsOf', () => {
  it('prefers live seats and the live total', () => {
    expect(seatsOf({ seatsLeft: 9, seatsTotal: 40, live: live() })).toEqual({ left: 6, total: 48, source: 'live', capturedAt: '2026-11-07T09:42:39+08:00' });
  });
  it('marks approx sections', () => {
    expect(seatsOf({ seatsLeft: 0, seatsTotal: 27, live: live({ source: 'approx', available: 0, total: 27 }) }).source).toBe('approx');
  });
  it('falls back to the last results window when there is no live row', () => {
    expect(seatsOf({ seatsLeft: 9, seatsTotal: 40 })).toEqual({ left: 9, total: 40, source: 'last', capturedAt: null });
  });
  it('keeps a live zero (full) instead of falling back', () => {
    expect(seatsLeftNow({ seatsLeft: 5, live: live({ available: 0 }) })).toBe(0);
  });
  it('ignores a malformed live object', () => {
    expect(seatsLeftNow({ seatsLeft: 5, live: live({ available: NaN }) })).toBe(5);
  });
});

describe('scan time helpers', () => {
  it('formats the stamp as written, in any viewer zone', () => {
    expect(scanTimeText('2026-11-07T09:42:39.089071+08:00')).toBe('7 Nov, 09:42');
    expect(scanTimeText('')).toBe('');
    expect(scanTimeText(null)).toBe('');
    expect(scanTimeText('2026-13-07T09:42:39')).toBe('');
  });
  it('finds the latest scan and any approx section', () => {
    const a = { seatsLeft: 1, live: live({ capturedAt: '2026-11-07T09:42:39+08:00' }) };
    const b = { seatsLeft: 1, live: live({ capturedAt: '2026-11-07T21:00:00+08:00', source: 'approx' }) };
    expect(latestScan([a, b, { seatsLeft: 2 }])).toBe('2026-11-07T21:00:00+08:00');
    expect(latestScan([{ seatsLeft: 2 }])).toBeNull();
    expect(anyApprox([a])).toBe(false);
    expect(anyApprox([a, b])).toBe(true);
  });
});

describe('estimated zero and messages', () => {
  it('only an approx zero is "likely full"', () => {
    expect(isLikelyFull({ seatsLeft: 0, live: live({ source: 'approx', available: 0 }) })).toBe(true);
    expect(isLikelyFull({ seatsLeft: 0, live: live({ available: 0 }) })).toBe(false);
    expect(isLikelyFull({ seatsLeft: 0 })).toBe(false);
    expect(isLikelyFull({ seatsLeft: 0, live: live({ source: 'approx', available: 3 }) })).toBe(false);
    expect(fullText({ seatsLeft: 0, live: live({ source: 'approx', available: 0 }) })).toBe('Likely full (est.)');
    expect(fullText({ seatsLeft: 0 })).toBe('Full');
  });
  it('seat phrases say "about" for estimates', () => {
    expect(seatsPhrase({ seatsLeft: 9, live: live({ available: 1 }) })).toBe('1 seat');
    expect(seatsPhrase({ seatsLeft: 9, live: live({ source: 'approx', available: 3 }) })).toBe('about 3 seats');
  });
});
