import { describe, expect, it, vi } from 'vitest';
import { targetToStored } from '../../lib/sim/forecast';
import { parseSaved } from './degree';

// Calibrated mode: Cheap 0.90 / Balanced 0.975 / Safe 0.99. Twin of the parseSaved tests in degree.test.ts.
vi.mock('../../lib/data/bidLevels', () => {
  const lv = (level: number) => ({ level, lossFilled: 0.1, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
  return { bidLevels: () => ({ cheap: lv(0.9), balanced: lv(0.975), safe: lv(0.99) }) };
});

describe('parseSaved, calibrated', () => {
  it('falls back to the first preset (Cheap, 0.90) on bad storage or an unknown value', () => {
    for (const raw of [null, '', '{', '[]']) expect(parseSaved(raw).target).toBe(0.9);
    expect(parseSaved('{"target":"t90"}').target).toBe(0.9);
    expect(parseSaved('{"target":"bogus"}').target).toBe(0.9);
  });
  it('treats any stored number as an old save and uses the first preset', () => {
    for (const n of ['0.8', '0.9', '0.95', '0.975', '0.99']) expect(parseSaved(`{"target":${n}}`).target).toBe(0.9);
  });
  it('keeps a stored preset key, and the key round-trips', () => {
    expect(parseSaved('{"target":"balanced"}').target).toBe(0.975);
    expect(parseSaved('{"target":"safe"}').target).toBe(0.99);
    for (const level of [0.9, 0.975, 0.99]) expect(parseSaved(JSON.stringify({ target: targetToStored(level) })).target).toBe(level);
  });
});
