import { describe, expect, it } from 'vitest';
import { compareSections, finalLine, gradingTotal, midtermLine, outlinesDiffer, pct, sameOutline, weekText } from './outlineText';

describe('outlineText', () => {
  it('sorts section codes naturally', () => {
    expect(['G10', 'G2', 'G1'].sort(compareSections)).toEqual(['G1', 'G2', 'G10']);
  });
  it('lists the other sections that share an outline', () => {
    const s = [{ section: 'G1', sha: 'a' }, { section: 'G2', sha: 'a' }, { section: 'G3', sha: 'b' }, { section: 'G4', sha: null }];
    expect(sameOutline(s, 0)).toEqual(['G2']);
    expect(sameOutline(s, 2)).toEqual([]);
    expect(sameOutline(s, 3)).toEqual([]);
    expect(outlinesDiffer(s)).toBe(true);
    expect(outlinesDiffer(s.slice(0, 2))).toBe(false);
    expect(outlinesDiffer([{ sha: 'a' }, { sha: null }])).toBe(false);
  });
  it('totals the stated weights without float noise', () => {
    expect(gradingTotal([{ weight_pct: 33.3 }, { weight_pct: 33.3 }, { weight_pct: 33.4 }])).toBe(100);
    expect(gradingTotal([{ weight_pct: null }])).toBeNull();
    expect(pct(null)).toBe('–');
    expect(pct(12.5)).toBe('12.5%');
  });
  it('words weeks and exam facts', () => {
    expect(weekText('7')).toBe('Week 7');
    expect(weekText('1-2')).toBe('Weeks 1-2');
    expect(weekText('Recess Week')).toBe('Recess Week');
    expect(finalLine({ exists: true, weight_pct: 50, duration: '3-hour', book: 'closed', cheat_sheet: null, calculator: null, online: true, take_home: null })).toBe('50% · 3-hour · Closed book · Online');
    expect(midtermLine({ exists: true, week_label: '7', weight_pct: 20 })).toBe('Week 7 · 20%');
    expect(midtermLine({ exists: true, week_label: null, weight_pct: null })).toBe('Yes');
    expect(midtermLine({ exists: false, week_label: null, weight_pct: null })).toBeNull();
  });
});
