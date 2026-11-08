import { describe, expect, it } from 'vitest';
import { seatChange, seatLabel } from './seatLabel';

const live = (available: number, total: number, extra: object = {}) => ({
  seatsLeft: 0,
  live: { available, total, source: 'live' as const, capturedAt: '2026-11-08T09:00:00', window: 'Round 1 Window 2', ...extra },
});

describe('seatLabel', () => {
  it('says how many seats are left of the total', () => {
    expect(seatLabel(live(3, 45))).toBe('3 seats left of 45');
    expect(seatLabel(live(1, 45))).toBe('1 seat left of 45');
  });
  it('says Full at zero', () => {
    expect(seatLabel(live(0, 45))).toBe('Full');
  });
  it('marks estimates', () => {
    const approx = { seatsLeft: 0, live: { available: 12, total: 45, source: 'approx' as const, capturedAt: '', window: '' } };
    expect(seatLabel(approx)).toBe('About 12 seats left of 45');
    expect(seatLabel({ ...approx, live: { ...approx.live, available: 0 } })).toBe('Likely full (est.)');
  });
  it('falls back to the last results when there was no scan', () => {
    expect(seatLabel({ seatsLeft: 5, seatsTotal: 40 })).toBe('5 seats left of 40');
  });
});

describe('seatChange', () => {
  it('explains the +1 / -2 markers', () => {
    expect(seatChange(live(48, 90, { sinceOpen: 1 }))).toBe('1 more seat than when the window opened');
    expect(seatChange(live(48, 90, { sinceOpen: -2 }))).toBe('2 fewer seats than when the window opened');
  });
  it('is empty when unchanged, unknown or estimated', () => {
    expect(seatChange(live(48, 90, { sinceOpen: 0 }))).toBe('');
    expect(seatChange(live(48, 90))).toBe('');
    expect(seatChange({ live: { available: 5, total: 9, source: 'approx', capturedAt: '', window: '', sinceOpen: 2 } })).toBe('');
  });
});
