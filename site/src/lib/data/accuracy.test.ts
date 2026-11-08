import { describe, expect, it } from 'vitest';
import { readAccuracy } from './accuracy';

const held = { term: 'T2', n: 7, baseN: 6, mae: 5.5, base: 7.5, cov: 0.82 };
const filled = { term: 'T2', filled: 6, fMae: 13.5, fBase: 21, fCov: 0.8 };

describe('readAccuracy', () => {
  it('passes the generated figures through unchanged', () => {
    expect(readAccuracy({ filledTests: [filled], heldOut: held })).toEqual({ filledTests: [filled], heldOut: held });
  });
  it('refuses an empty file instead of showing made-up numbers', () => {
    expect(() => readAccuracy({ filledTests: [], heldOut: null })).toThrow(/no backtest/);
    expect(() => readAccuracy({ filledTests: [filled] })).toThrow(/no backtest/);
  });
});
