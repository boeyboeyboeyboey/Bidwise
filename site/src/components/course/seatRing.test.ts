import { describe, expect, it } from 'vitest';
import { seatRing } from './seatRing';

describe('seatRing', () => {
  it('maps room for the group to a level and fill', () => {
    expect(seatRing(1, 1)).toEqual({ level: 'low', fill: 0.1 });
    expect(seatRing(6, 6)).toEqual({ level: 'low', fill: 0.1 });
    expect(seatRing(3, 6)).toEqual({ level: 'low', fill: 0.1 });
    expect(seatRing(8, 6)).toEqual({ level: 'some', fill: 0.3 });
    expect(seatRing(4, 1)).toEqual({ level: 'some', fill: 0.4 });
    expect(seatRing(5, 1)).toEqual({ level: 'ok', fill: 0.5 });
    expect(seatRing(8, 1)).toEqual({ level: 'ok', fill: 0.8 });
    expect(seatRing(48, 1)).toEqual({ level: 'ok', fill: 1 });
  });
  it('is empty with no seats', () => {
    expect(seatRing(0, 1)).toEqual({ level: 'empty', fill: 0 });
    expect(seatRing(-3)).toEqual({ level: 'empty', fill: 0 });
  });
  it('copes with odd input', () => {
    expect(seatRing(NaN).level).toBe('empty');
    expect(seatRing(Infinity).level).toBe('empty');
    expect(seatRing(2.5, 1).level).toBe('some');
    expect(seatRing(5, 0)).toEqual({ level: 'ok', fill: 0.5 });
  });
});
