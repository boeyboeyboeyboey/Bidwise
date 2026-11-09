import { describe, expect, it } from 'vitest';
import { ariaSummary, countdownText, formatSgt, isUrgent, msToNextTick, pickTarget, segments, type CountdownWindow } from './countdown';
import { parseWhen } from '../../lib/data/window';

const W: CountdownWindow[] = [
  { label: 'Round 1B Window 2', opensAt: '2026-11-10T17:00:00+08:00', closesAt: '2026-11-12T10:00:00+08:00' },
  { label: 'Round 1B Window 1', opensAt: '2026-11-06T17:00:00+08:00', closesAt: '2026-11-10T10:00:00+08:00' },
]; // out of order on purpose
const t = (s: string) => parseWhen(s);

describe('pickTarget', () => {
  it('inside a window counts down to its close', () => {
    expect(pickTarget(W, t('2026-11-09T22:00+08:00'))).toEqual({ kind: 'closes', label: 'Round 1B Window 1', at: t('2026-11-10T10:00+08:00') });
  });
  it('between windows counts down to the next opening', () => {
    expect(pickTarget(W, t('2026-11-10T12:00+08:00'))).toEqual({ kind: 'opens', label: 'Round 1B Window 2', at: t('2026-11-10T17:00+08:00') });
  });
  it('before the first window counts down to its opening', () => {
    expect(pickTarget(W, t('2026-11-01T00:00+08:00'))?.kind).toBe('opens');
  });
  it('after the last window there is nothing to show', () => {
    expect(pickTarget(W, t('2026-11-12T10:00+08:00'))).toBeNull();
    expect(pickTarget([], 0)).toBeNull();
  });
  it('rolls over at exactly zero: the closing instant belongs to the gap, the opening instant to the window', () => {
    expect(pickTarget(W, t('2026-11-10T10:00+08:00') - 1)?.kind).toBe('closes');
    expect(pickTarget(W, t('2026-11-10T10:00+08:00'))?.kind).toBe('opens');
    expect(pickTarget(W, t('2026-11-10T17:00+08:00') - 1)?.kind).toBe('opens');
    expect(pickTarget(W, t('2026-11-10T17:00+08:00'))).toMatchObject({ kind: 'closes', label: 'Round 1B Window 2' });
  });
  it('ignores windows with unreadable times', () => {
    expect(pickTarget([{ label: 'x', opensAt: 'nope', closesAt: 'nope' }, ...W], t('2026-11-09T22:00+08:00'))?.label).toBe('Round 1B Window 1');
  });
  it('uses absolute instants: the same moment gives the same answer however the viewer writes it (other time zone)', () => {
    // 2026-11-10 02:00 UTC is 10:00 SGT, i.e. exactly the close of Window 1.
    expect(pickTarget(W, Date.parse('2026-11-10T02:00:00Z'))?.kind).toBe('opens');
    expect(pickTarget(W, Date.parse('2026-11-10T01:59:59Z'))?.kind).toBe('closes');
    // a viewer in New York (UTC-5) at 2026-11-09 20:00 local is 09:00 SGT on 10 Nov: still open, 1h left
    const left = pickTarget(W, Date.parse('2026-11-09T20:00:00-05:00'))!.at - Date.parse('2026-11-09T20:00:00-05:00');
    expect(left).toBe(3_600_000);
  });
});

describe('segments and countdownText', () => {
  const ms = (d: number, h: number, m: number, s: number, extra = 0) => (((d * 24 + h) * 60 + m) * 60 + s) * 1000 + extra;
  it('under a day shows hours, minutes and seconds', () => {
    expect(countdownText(ms(0, 9, 42, 18))).toBe('9h 42m 18s');
    expect(countdownText(ms(0, 9, 5, 3))).toBe('9h 05m 03s');
  });
  it('drops leading zero units', () => {
    expect(countdownText(ms(0, 0, 42, 18))).toBe('42m 18s');
    expect(countdownText(ms(0, 0, 0, 7))).toBe('7s');
  });
  it('a day or more shows days, hours, minutes and no seconds', () => {
    expect(countdownText(ms(2, 4, 10, 59))).toBe('2d 4h 10m');
    expect(countdownText(ms(1, 0, 0, 0))).toBe('1d 0h 00m');
    expect(countdownText(ms(0, 23, 59, 59))).toBe('23h 59m 59s');
  });
  it('rounds seconds up so 0s never shows before the rollover', () => {
    expect(countdownText(500)).toBe('1s');
    expect(countdownText(0)).toBe('0s');
    expect(countdownText(-5)).toBe('0s');
  });
  it('exposes units for styling', () => {
    expect(segments(ms(0, 1, 2, 3))).toEqual([{ value: '1', unit: 'h' }, { value: '02', unit: 'm' }, { value: '03', unit: 's' }]);
  });
});

describe('helpers', () => {
  it('urgent under one hour', () => {
    expect(isUrgent(3_599_999)).toBe(true);
    expect(isUrgent(3_600_000)).toBe(false);
  });
  it('next tick lands just after the next whole-second boundary', () => {
    expect(msToNextTick(5000)).toBe(1005);
    expect(msToNextTick(5400)).toBe(405);
  });
  it('formats SGT whatever the viewer zone', () => {
    expect(formatSgt(Date.parse('2026-11-10T02:00:00Z'))).toBe('Tue 10 Nov, 10:00 SGT');
  });
  it('aria summary is to the minute', () => {
    const tg = { kind: 'closes', label: 'Round 1B Window 1', at: t('2026-11-10T10:00+08:00') } as const;
    expect(ariaSummary(tg, 9 * 3600e3 + 42 * 60e3 + 18e3)).toBe('Round 1B Window 1 closes in 9 hours 42 minutes, Tue 10 Nov, 10:00 SGT');
    expect(ariaSummary(tg, 2 * 86400e3 + 3600e3)).toBe('Round 1B Window 1 closes in 2 days 1 hour 0 minutes, Tue 10 Nov, 10:00 SGT');
  });
});
