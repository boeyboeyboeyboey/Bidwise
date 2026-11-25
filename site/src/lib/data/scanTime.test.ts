import { describe, expect, it } from 'vitest';
import { coarsenCourse, publicSeatMeta, scanDay, scanHour } from './scanTime';
import { scanDayText } from './seats';
import type { CourseData } from './types';

describe('scanHour', () => {
  it('rounds to the nearest hour and keeps the offset', () => {
    expect(scanHour('2026-11-25T09:20:41+08:00')).toBe('2026-11-25T09:00:00+08:00');
    expect(scanHour('2026-11-25T09:30:00+08:00')).toBe('2026-11-25T10:00:00+08:00');
    expect(scanHour('2026-11-25T09:00:00')).toBe('2026-11-25T09:00:00');
  });
  it('carries across midnight, month and year', () => {
    expect(scanHour('2026-12-31T23:45:00+08:00')).toBe('2027-01-01T00:00:00+08:00');
  });
  it('returns null for unreadable input', () => {
    expect(scanHour('')).toBeNull();
    expect(scanHour(null)).toBeNull();
    expect(scanHour('yesterday')).toBeNull();
  });
});

describe('scanDay', () => {
  it('is the day of the rounded hour', () => {
    expect(scanDay('2026-11-12T00:24:08+08:00')).toBe('2026-11-12');
    expect(scanDay('2026-11-11T23:40:00+08:00')).toBe('2026-11-12');
    expect(scanDayText(scanDay('2026-11-07T21:00:00+08:00'))).toBe('7 Nov');
  });
});

describe('publicSeatMeta', () => {
  it('keeps the newest update to the hour and the rest to the day', () => {
    expect(publicSeatMeta({ capturedAt: '2026-11-25T09:20:00+08:00', scanAt: '2026-11-25T09:03:11+08:00', openScanAt: '2026-11-10T17:02:00+08:00', prevScanAt: '2026-11-24T21:04:00+08:00', window: 'W' }))
      .toEqual({ scanAt: '2026-11-25T09:00:00+08:00', capturedAt: '2026-11-25T09:00:00+08:00', openScanAt: '2026-11-10', prevScanAt: '2026-11-24', window: 'W' });
  });
});

describe('coarsenCourse', () => {
  it('cuts live capture and history times to the day and leaves other sections alone', () => {
    const live = { available: 3, total: 40, source: 'live' as const, capturedAt: '2026-11-25T09:12:00+08:00', window: 'W', history: [{ at: '2026-11-24T21:05:00+08:00', available: 4 }, { at: '2026-11-25T09:12:00+08:00', available: 3 }] };
    const c = { code: 'X', title: 'T', school: 'S', sectionsNow: [{ section: 'G1', live }, { section: 'G2' }], history: [] } as unknown as CourseData;
    const out = coarsenCourse(c);
    expect(out.sectionsNow[0].live).toEqual({ ...live, capturedAt: '2026-11-25', history: [{ at: '2026-11-24', available: 4 }, { at: '2026-11-25', available: 3 }] });
    expect(out.sectionsNow[1]).toBe(c.sectionsNow[1]);
    expect(JSON.stringify(out)).not.toMatch(/T\d{2}:\d{2}/);
  });
});
