import { describe, expect, it, vi } from 'vitest';
import { bidLevels, bidWindowData } from './bidLevels';
import type { BidLevel } from './types';

// This file tests the real loader, so it opts out of the forced-calibrated setup mock (src/test-setup.ts).
vi.unmock('./bidLevels');

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

describe('bidWindowData', () => {
  const lvl = (level: number) => ({ level, lossFilled: 0.2 });
  const cell = { cheap: 0.7, balanced: 0.8, safe: 0.9, nFilled: 60 };
  const full = {
    ...meta,
    bidLevelsByWindow: { 'Round 1 Window 1': { cheap: lvl(0.5), balanced: lvl(0.7), safe: lvl(0.9) } },
    measuredWin: { 'Round 1 Window 1': { '0': cell, '1': cell, '2': cell, '3': cell, '4': cell } },
    bandEdges: [15, 25, 40, 60],
  };
  it('reads levels, measured rates and edges', () => {
    const d = bidWindowData(full);
    expect(d?.levels?.['Round 1 Window 1'].balanced.level).toBe(0.7);
    expect(d?.measured?.['Round 1 Window 1']['3'].nFilled).toBe(60);
    expect(d?.edges).toEqual([15, 25, 40, 60]);
  });
  it('reads the course counts when valid and drops invalid ones silently', () => {
    const w = (c: object) => bidWindowData({ ...full, measuredWin: { 'Round 1 Window 1': Object.fromEntries(['0', '1', '2', '3', '4'].map((k) => [k, c])) } } as never)?.measured?.['Round 1 Window 1']['0'];
    const up = { upper: { cheap: 0.75, balanced: 0.9, safe: 0.95 } };
    expect(w({ ...cell, ...up, nCourses: 30, effCourses: 20.5 })).toEqual({ ...cell, ...up, nCourses: 30, effCourses: 20.5 });
    expect(w({ ...cell, ...up, nCourses: 30.5, effCourses: 0 })).toEqual({ ...cell, ...up });
    expect(w({ ...cell, ...up, nCourses: -3, effCourses: Infinity })).toEqual({ ...cell, ...up });
    expect(w({ ...cell, ...up, nCourses: '30', effCourses: '20' })).toEqual({ ...cell, ...up });
  });
  it('reads source and upper bounds when present, ignores bad ones, and works without them', () => {
    const w = (c: object) => bidWindowData({ ...full, measuredWin: { 'Round 1 Window 1': Object.fromEntries(['0', '1', '2', '3', '4'].map((k) => [k, c])) } } as never)?.measured?.['Round 1 Window 1']['0'];
    expect(w({ ...cell, source: 'cell', upper: { cheap: 0.75, balanced: 0.9, safe: 0.95 } })).toMatchObject({ source: 'cell', upper: { cheap: 0.75, balanced: 0.9, safe: 0.95 } });
    expect(w({ ...cell, source: 'galaxy', upper: { cheap: 7, balanced: 'x' } })).toEqual({ ...cell, upper: { cheap: null, balanced: null, safe: null } });
    expect(w(cell)).toEqual(cell);
  });
  it('passes reached through when present', () => {
    const d = bidWindowData({ ...full, bidLevelsByWindow: { 'Round 1 Window 1': { cheap: lvl(0.5), balanced: lvl(0.7), safe: { ...lvl(0.995), reached: false } } } });
    expect(d?.levels?.['Round 1 Window 1'].safe.reached).toBe(false);
    expect(d?.levels?.['Round 1 Window 1'].cheap).not.toHaveProperty('reached');
  });
  it('is null when the keys are absent (the meta today) or the calibration is not ok', () => {
    expect(bidWindowData(meta)).toBeNull();
    expect(bidWindowData(undefined)).toBeNull();
    expect(bidWindowData({ ...full, distCalibration: { enabled: true, ok: false } })).toBeNull();
  });
  it('keeps each part independent and drops malformed entries', () => {
    const lvOnly = bidWindowData({ ...meta, bidLevelsByWindow: full.bidLevelsByWindow });
    expect(lvOnly?.measured).toBeNull();
    expect(lvOnly?.edges).toBeNull();
    const bad = bidWindowData({ ...full, bidLevelsByWindow: { 'Round 1 Window 1': { cheap: lvl(0.5), balanced: lvl(1.2), safe: lvl(0.9) } }, bandEdges: [15, 15, 40, 60] });
    expect(bad?.levels).toBeNull();
    expect(bad?.edges).toBeNull();
    expect(bad?.measured).not.toBeNull();
    const short = bidWindowData({ ...full, measuredWin: { 'Round 1 Window 1': { '0': cell } } });
    expect(short?.measured).toBeNull();
    expect(short?.levels).not.toBeNull();
  });
  it('accepts null rates and loss', () => {
    const d = bidWindowData({ ...full, measuredWin: { 'Round 1 Window 1': Object.fromEntries(['0', '1', '2', '3', '4'].map((k) => [k, { ...cell, safe: null }])) } });
    expect(d?.measured?.['Round 1 Window 1']['0'].safe).toBeNull();
  });
});
