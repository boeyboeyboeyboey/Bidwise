import { describe, expect, it } from 'vitest';
import { bidLevels } from './bidLevels';
import type { BidLevel } from './types';

const lv = (level: number, lossFilled: number | null, reached = true): BidLevel => ({ level, lossFilled, lossAll: 0.05, winAboveFloor: 0.8, meanOverpay: 3.2, reached });
const meta = {
  distCalibration: { enabled: true, ok: true, heldOutTerm: '2025-26 Term 2', createdAt: '2026-11-14T23:00:00+0800' },
  bidLevels: { cheap: lv(0.9, 0.304), balanced: lv(0.975, 0.155), safe: lv(0.99, 0.104, false) },
};

describe('bidLevels', () => {
  it('returns the three levels, keeping the reached flag', () => {
    const r = bidLevels(meta);
    expect(r?.cheap.level).toBe(0.9);
    expect(r?.balanced.lossFilled).toBe(0.155);
    expect(r?.safe.reached).toBe(false);
  });
  it('is null when the calibration is off, not ok, or has no levels', () => {
    expect(bidLevels(undefined)).toBeNull();
    expect(bidLevels({ bidLevels: meta.bidLevels })).toBeNull();
    expect(bidLevels({ ...meta, distCalibration: { enabled: true, ok: false } })).toBeNull();
    expect(bidLevels({ distCalibration: meta.distCalibration })).toBeNull();
  });
  it('is null when a level is missing or malformed', () => {
    expect(bidLevels({ ...meta, bidLevels: { ...meta.bidLevels, safe: undefined as unknown as BidLevel } })).toBeNull();
    expect(bidLevels({ ...meta, bidLevels: { ...meta.bidLevels, cheap: { ...meta.bidLevels.cheap, level: 'x' as unknown as number } } })).toBeNull();
  });
});
