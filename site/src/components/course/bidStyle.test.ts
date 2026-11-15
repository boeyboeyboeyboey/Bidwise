import { describe, expect, it } from 'vitest';
import type { BidPreset } from '../../lib/sim/presets';
import { aboutInN, lowConfidenceLines, nearestFraction, styleMeaning, styleResults, styleTipLines } from './bidStyle';

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
  it('builds the sentence from the backtest numbers', () => {
    expect(styleTipLines(presets)).toEqual([
      'Last term, of the sections that filled: Cheap bids lost about 3 in 10, Balanced about 1 in 6, Safe about 1 in 10.',
      'Safe costs more.',
    ]);
  });
  it('says nothing when a number is missing', () => {
    expect(styleTipLines([{ key: 't80', label: '80%', level: 0.8 }])).toEqual([]);
  });
});

describe('styleMeaning', () => {
  it('turns the loss share into a win share', () => {
    expect(styleMeaning(presets[2])).toBe('Bids are for 1 person. Safe aims to win about 9 in 10 times even when the section fills.');
    expect(styleMeaning(presets[0])).toContain('about 7 in 10');
    expect(styleMeaning(presets[1])).toContain('about 5 in 6');
    expect(styleMeaning({ key: 'x', label: 'x', level: 0.5 })).toBe('Bids are for 1 person.');
  });
});

describe('lowConfidenceLines', () => {
  it('gives one line per reason', () => {
    expect(lowConfidenceLines(['oneSeat', 'lateWindow'])).toHaveLength(2);
    expect(lowConfidenceLines([])).toEqual([]);
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
