import { describe, expect, it } from 'vitest';
import { chooseWindow, parseWhen, type ConfiguredWindow } from './window';
import type { ScheduleEntry } from './types';

// Mirrors ChooseWindow in tests/test_build_site_data.py: keep the two in step.
const CUR: ConfiguredWindow = { round: '1B', window: 1, closesAt: 'd', status: 'open' };
const SCHED: ScheduleEntry[] = [
  { round: '1B', window: 2, opensAt: '2026-11-10T17:00:00+08:00', closesAt: '2026-11-12T10:00:00+08:00' },
  { round: '1B', window: 1, opensAt: '2026-11-06T17:00:00+08:00', closesAt: '2026-11-10T10:00:00+08:00' },
  { round: '2', window: 1, opensAt: '2027-01-11T10:00:00+08:00', closesAt: '2027-01-13T10:00:00+08:00' },
]; // deliberately out of order

const pick = (now: string, sched = SCHED) => {
  const w = chooseWindow(sched, CUR, parseWhen(now));
  return [w.round, w.window, w.status];
};

describe('parseWhen', () => {
  it('reads a date alone and a space separator as SGT, like Python', () => {
    expect(parseWhen('2027-01-11')).toBe(parseWhen('2027-01-11T00:00+08:00'));
    expect(parseWhen('2026-11-10 12:00')).toBe(parseWhen('2026-11-10T12:00:00+08:00'));
  });
});

describe('chooseWindow', () => {
  it('inside a window', () => {
    expect(pick('2026-11-08T12:00')).toEqual(['1B', 1, 'open']);
    expect(pick('2026-11-11T09:00+08:00')).toEqual(['1B', 2, 'open']);
  });
  it('mid-round gap', () => {
    expect(pick('2026-11-10T12:00')).toEqual(['1B', 2, 'upcoming']);
  });
  it('between rounds', () => {
    expect(pick('2026-11-20T12:00')).toEqual(['2', 1, 'upcoming']);
  });
  it('before the first and after the last window', () => {
    expect(pick('2026-11-01T00:00')).toEqual(['1B', 1, 'upcoming']);
    expect(pick('2027-02-01T00:00')).toEqual(['2', 1, 'closed']);
  });
  it('is open at opensAt and not at closesAt', () => {
    expect(pick('2026-11-06T17:00')).toEqual(['1B', 1, 'open']);
    expect(pick('2026-11-06T16:59:59')).toEqual(['1B', 1, 'upcoming']);
    expect(pick('2026-11-10T10:00')).toEqual(['1B', 2, 'upcoming']);
    expect(pick('2027-01-13T10:00')).toEqual(['2', 1, 'closed']);
  });
  it('reads a time without a zone as SGT', () => {
    expect(pick('2026-11-10T09:59:59')).toEqual(pick('2026-11-10T09:59:59+08:00'));
    expect(pick('2026-11-10T02:00:00+00:00')).toEqual(['1B', 2, 'upcoming']);
  });
  it('carries opensAt and closesAt', () => {
    const w = chooseWindow(SCHED, CUR, parseWhen('2026-11-20T12:00'));
    expect([w.opensAt, w.closesAt]).toEqual(['2027-01-11T10:00:00+08:00', '2027-01-13T10:00:00+08:00']);
  });
  it('falls back to the configured window when the schedule is empty or unreadable', () => {
    const bad = [{ round: '1B', window: 1, opensAt: 'c', closesAt: 'd' }];
    expect(pick('2030-01-01T00:00', bad)).toEqual(['1B', 1, 'open']);
    expect(chooseWindow([], CUR, 0).status).toBe('open');
  });
});
