import { describe, expect, it } from 'vitest';
import type { SwapLabel, SwapOption } from '../../lib/swap/swap';
import { basisText, chipFor, chipTipLines, modeFromUrl, modeToSearch, orderForSwap, rangeText, roughText } from './swapUi';

const opt = (section: string, label: SwapLabel, o: Partial<SwapOption> = {}): SwapOption => ({
  section, label, chance: 0.64, chanceLow: 0.55, chanceHigh: 0.76, desirability: 0, fallback: false, preAssigned: false, sampleSize: 8, ...o,
});

describe('mode from URL', () => {
  it('reads mode and own section', () => {
    expect(modeFromUrl('?mode=swap&from=G9')).toEqual({ mode: 'swap', from: 'G9' });
    expect(modeFromUrl('?s=G1')).toEqual({ mode: 'bid', from: null });
    expect(modeFromUrl('?mode=nonsense')).toEqual({ mode: 'bid', from: null });
  });
  it('writes it back and keeps other params', () => {
    expect(modeToSearch('?s=G1', 'swap', 'G9')).toBe('?s=G1&mode=swap&from=G9');
    expect(modeToSearch('?mode=swap&from=G9&s=G1', 'bid', 'G9')).toBe('?s=G1');
    expect(modeToSearch('', 'bid', null)).toBe('');
    expect(modeToSearch('', 'swap', null)).toBe('?mode=swap');
  });
});

describe('chips', () => {
  it('maps label to text and tone', () => {
    expect(chipFor('likely')).toEqual({ text: 'Likely', tone: 'good' });
    expect(chipFor('unlikely').tone).toBe('bad');
    expect(chipFor('unknown').tone).toBe('none');
  });
  it('formats the rough percentage, range and basis', () => {
    expect(roughText(opt('A', 'possible'))).toBe('About 65%');
    expect(roughText(opt('A', 'unlikely', { chance: 0.012 }))).toBe('Under 5%');
    expect(roughText(opt('A', 'unknown', { chance: null }))).toBeNull();
    expect(rangeText(opt('A', 'possible'))).toBe('55–75%');
    expect(rangeText(opt('A', 'possible', { chanceLow: 0.501, chanceHigh: 0.504 }))).toBe('50%');
    expect(rangeText(opt('A', 'unknown', { chanceLow: null, chanceHigh: null }))).toBeNull();
    expect(basisText({ fallback: false, preAssigned: false, sampleSize: 1 })).toBe('Based on predicted bids from 1 past result.');
    expect(basisText({ fallback: false, preAssigned: false, sampleSize: 0 })).toBe('Based on predicted bids, estimated from similar courses.');
    expect(basisText({ fallback: true, preAssigned: false, sampleSize: 3 })).toBe('Estimate from last term’s bids.');
    expect(basisText({ fallback: false, preAssigned: true, sampleSize: 3 })).toMatch(/pre-assigned/);
  });
  it('tooltip says what the label means, then basis and the judgment note, with no percentages', () => {
    const lines = chipTipLines(opt('A', 'possible'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('How likely a one-for-one swap into this section is.');
    expect(lines[1]).toBe('Based on predicted bids from 8 past results.');
    expect(lines[2]).toBe('Set by judgment of how hard swaps are, not measured from real swaps.');
    expect(lines.join(' ')).not.toMatch(/%/);
    expect(chipTipLines(opt('A', 'unknown', { chance: null, chanceLow: null, chanceHigh: null }))).toEqual(['No seat count for this section, so no estimate.']);
  });
});

describe('orderForSwap', () => {
  it('puts mine first, then likely to unknown, keeping ties in order', () => {
    const rows = ['G1', 'G2', 'G3', 'G4', 'G5', 'G9'].map((section) => ({ section }));
    const m = new Map<string, SwapOption>([
      ['G1', opt('G1', 'unlikely')], ['G2', opt('G2', 'likely')], ['G3', opt('G3', 'possible')], ['G5', opt('G5', 'likely')],
    ]);
    expect(orderForSwap(rows, 'G9', m).map((r) => r.section)).toEqual(['G9', 'G2', 'G5', 'G3', 'G1', 'G4']);
  });
});
