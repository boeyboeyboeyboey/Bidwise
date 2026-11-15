import { describe, expect, it } from 'vitest';
import { agoText, fallbackText, freshnessText } from './freshness';
import { parseWhen } from './window';

const at = (iso: string) => parseWhen(iso);
const MIN = 60_000;
const H = 60 * MIN;

describe('agoText', () => {
  const now = at('2026-11-12T12:00:00+08:00');
  const ago = (ms: number) => agoText(now - ms, now);
  it('rounds to the nearest hour, never shows minutes', () => {
    expect(ago(20_000)).toBe('in the last hour');
    expect(ago(29 * MIN)).toBe('in the last hour');
    expect(ago(31 * MIN)).toBe('1 h ago');
    expect(ago(89 * MIN)).toBe('1 h ago');
    expect(ago(91 * MIN)).toBe('2 h ago');
    expect(ago(23 * H + 20 * MIN)).toBe('23 h ago');
  });
  it('switches to the nearest day from 23 h 30 min', () => {
    expect(ago(23 * H + 40 * MIN)).toBe('1 day ago');
    expect(ago(35 * H)).toBe('1 day ago');
    expect(ago(37 * H)).toBe('2 days ago');
    expect(ago(50 * H)).toBe('2 days ago');
  });
  it('treats a time slightly in the future (clock skew) as the last hour, and bad input as empty', () => {
    expect(agoText(1000, 0)).toBe('in the last hour');
    expect(agoText(NaN, 0)).toBe('');
    expect(agoText(0, NaN)).toBe('');
  });
});

describe('freshnessText', () => {
  const meta = { scanAt: '2026-11-11T09:00:00+08:00', capturedAt: '2026-11-11T09:20:00+08:00' };
  it('gives a rough age only, and is empty without seat data', () => {
    expect(freshnessText(meta, at('2026-11-11T09:10:00+08:00'))).toBe('Seats updated in the last hour');
    expect(freshnessText(meta, at('2026-11-11T12:10:00+08:00'))).toBe('Seats updated 3 h ago');
    expect(freshnessText(meta, at('2026-11-13T11:00:00+08:00'))).toBe('Seats updated 2 days ago');
    expect(freshnessText(meta, at('2027-02-01T12:00:00+08:00'))).toBe('Seats updated 82 days ago');
    expect(freshnessText(null, 0)).toBe('');
    expect(freshnessText({}, 0)).toBe('');
  });
});

describe('fallbackText', () => {
  it('gives the day only for the server render', () => {
    expect(fallbackText({ scanAt: '2026-11-12T00:03:33+08:00', capturedAt: '2026-11-12T00:24:08+08:00' })).toBe('Seats updated 12 Nov');
    expect(fallbackText({ capturedAt: '2026-11-12T00:24:08+08:00' })).toBe('Seats updated 12 Nov');
    expect(fallbackText(undefined)).toBe('');
    expect(fallbackText({})).toBe('');
  });
});
