import { describe, expect, it } from 'vitest';
import type { BidPreset } from '../../lib/sim/presets';
import type { PastRate } from '../../lib/sim/windowBids';
import { FLOOR_TEXT, aboutInN, lowConfidenceLines, nearestFraction, pastRateText, styleMeaning, styleResults, styleTipLines, unreachedText } from './bidStyle';

const presets: BidPreset[] = [
  { key: 'cheap', label: 'Cheap', level: 0.9, lossFilled: 0.304 },
  { key: 'balanced', label: 'Balanced', level: 0.975, lossFilled: 0.157 },
  { key: 'safe', label: 'Safe', level: 0.99, lossFilled: 0.106 },
];

describe('aboutInN', () => {
  it('words a share as a simple fraction', () => {
    expect(aboutInN(0.304)).toBe('about 3 in 10');
    expect(aboutInN(0.157)).toBe('about 1 in 6');
    expect(aboutInN(0.106)).toBe('about 1 in 10');
    expect(aboutInN(0.5)).toBe('about 1 in 2');
  });
  it('reads a share above a half from the other side', () => {
    expect(nearestFraction(0.9)).toEqual([9, 10]);
    expect(nearestFraction(0.84)).toEqual([5, 6]);
  });
});

describe('styleTipLines', () => {
  const summary = { overall: { cheap: 0.7023, balanced: 0.8469, safe: 0.8922 }, byRound: [], terms: ['2025-26 Term 2', '2026-27 Term 1'] };
  it('takes the out-of-fold rates and names both terms', () => {
    expect(styleTipLines(presets, summary)).toEqual([
      'In 2025-26 Term 2 and 2026-27 Term 1, on sections that filled, bids matched or beat the lowest winning bid: Cheap 70%, Balanced 85%, Safe 89%.',
      'Tested forward on 2026-27 Term 1, the latest complete term: Cheap 61.7%, Balanced 79.8%, Safe 85.5%.',
      'A bid equal to the lowest winning bid can lose a tie.',
      'Safe can cost more.',
    ]);
  });
  it('omits the rate and tie lines without the summary, and names no term it does not have', () => {
    expect(styleTipLines(presets, null)).toEqual(['Safe can cost more.']);
    expect(styleTipLines(presets)).toEqual(['Safe can cost more.']);
    expect(styleTipLines(presets, { ...summary, terms: undefined })[0]).toMatch(/^In past terms, on sections that filled, bids matched or beat/);
  });
  it('says nothing without presets', () => {
    expect(styleTipLines([], summary)).toEqual([]);
  });
});

describe('tied style wording', () => {
  it('names tied styles in one line and one unreached note', () => {
    expect(pastRateText({ styles: ['balanced', 'safe'], rate: 0.79, nFilled: 108, belowAim: false })).toBe('Balanced and Safe matched or beat the lowest winning bid in 79% of 108 filled cases.');
  });
});

describe('unreachedText', () => {
  it('says the highest calibrated level fell short, for one style', () => {
    expect(unreachedText(['cheap'])).toBe("Even the highest level tested in calibration fell short of Cheap's 70% aim.");
  });
  it('says the highest levels fell short, for several styles', () => {
    expect(unreachedText(['balanced', 'safe'])).toBe('Even the highest levels tested in calibration fell short of the aims for Balanced and Safe (85%, 90%).');
  });
});

describe('pastRateText', () => {
  const base: PastRate = { styles: ['balanced'], rate: 0.784, nFilled: 120, belowAim: false };
  it('names the source of the rate, or none when the build does not say', () => {
    expect(pastRateText({ ...base, source: 'cell' })).toContain('this round and price range');
    expect(pastRateText({ ...base, source: 'group' })).toContain('all price ranges in this round');
    expect(pastRateText({ ...base, source: 'all' })).toContain('all rounds');
    expect(pastRateText(base)).toBe('Balanced matched or beat the lowest winning bid in 78% of 120 filled cases.');
  });
  it('floor text says the bid often loses when the section fills', () => {
    expect(FLOOR_TEXT).toBe('If seats are left over, this bid wins. If the section fills, this bid often loses.');
  });
  it('says below aim only when told', () => {
    expect(pastRateText(base)).not.toContain('Below aim');
    expect(pastRateText({ ...base, belowAim: true })).toContain('Below aim in past terms.');
  });
});

describe('styleMeaning', () => {
  it('turns the loss share into a win share', () => {
    expect(styleMeaning(presets[2])).toBe('Bids are for 1 person. Safe aims to win about 9 in 10 times even when the section fills.');
    expect(styleMeaning(presets[0])).toContain('about 7 in 10');
    expect(styleMeaning(presets[1])).toContain('about 5 in 6');
  });
  it('takes the aim from the declared target, not the training loss', () => {
    expect(styleMeaning({ key: 'safe', label: 'Safe', level: 0.99, lossFilled: 0.5 })).toBe('Bids are for 1 person. Safe aims to win about 9 in 10 times even when the section fills.');
  });
  it('uses the own level for the fallback presets', () => {
    expect(styleMeaning({ key: 't80', label: '80%', level: 0.8 })).toBe('Bids are for 1 person. 80% aims to win about 4 in 5 times even when the section fills.');
  });
  it('keeps the plain line when a preset has no target at all', () => {
    expect(styleMeaning({ key: 'x', label: 'x', level: undefined as unknown as number })).toBe('Bids are for 1 person.');
  });
});

describe('lowConfidenceLines', () => {
  it('gives one line per reason', () => {
    expect(lowConfidenceLines(['oneSeat', 'lateWindow'])).toHaveLength(2);
    expect(lowConfidenceLines([])).toEqual([]);
    expect(lowConfidenceLines(['lateWindow', 'farWindow'])).toHaveLength(2);
  });
  it('adds the window flag as a third plain line, alone or after the others', () => {
    expect(lowConfidenceLines([], true)).toEqual(['This window was harder to forecast in past terms.']);
    const all = lowConfidenceLines(['oneSeat', 'lateWindow'], true);
    expect(all).toHaveLength(3);
    expect(all[2]).toBe('This window was harder to forecast in past terms.');
  });
});

describe('styleResults', () => {
  const lv = (level: number, lossFilled: number | null, lossAll: number) => ({ level, lossFilled, lossAll, winAboveFloor: 0.9, meanOverpay: 6, reached: true });
  const levels = { cheap: lv(0.9, 0.304, 0.0732), balanced: lv(0.975, 0.157, 0.0378), safe: lv(0.99, 0.106, 0.0255) };
  it('turns the backtest losses into wins, on filled sections and on all sections', () => {
    const r = styleResults(levels);
    expect(r.map((x) => [x.label, x.wonFilledText])).toEqual([['Cheap', 'about 7 in 10'], ['Balanced', 'about 5 in 6'], ['Safe', 'about 9 in 10']]);
    expect(r[0].wonFilled).toBeCloseTo(0.696, 3);
    expect(r[2].wonAll).toBeCloseTo(0.9745, 4);
  });
  it('gives nothing without the levels, or when a style has no filled-section number', () => {
    expect(styleResults(null)).toEqual([]);
    expect(styleResults({ ...levels, safe: lv(0.99, null, 0.0255) })).toEqual([]);
  });
});
