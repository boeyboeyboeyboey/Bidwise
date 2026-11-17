import { describe, expect, it, vi } from 'vitest';
import type { Section } from '../data/types';
import { NO_BIDS, buildReportCsv, sectionFacts, type ReportRow } from './csv';
import { bidReason, planNote } from './plan';

// Calibrated mode: Cheap 0.90 / Balanced 0.975 / Safe 0.99. Twin of the 80 / 90 / 95% CSV tests in csv.test.ts.
vi.mock('../data/bidLevels', () => {
  const lv = (level: number) => ({ level, lossFilled: 0.1, lossAll: 0.07, winAboveFloor: 0.86, meanOverpay: 6.6, reached: true });
  return { bidLevels: () => ({ cheap: lv(0.9), balanced: lv(0.975), safe: lv(0.99) }), bidWindowData: () => null };
});

const section = { id: 'g1', section: 'G1', classNumber: '1234', instructor: 'TAN', meetings: [], seatsTotal: 45, seatsLeft: 10 } as unknown as Section;
const row: ReportRow = { ...sectionFacts('COR3304', 'Strategic Management', section), window: 'Round 1B Window 1', bids: { 0.9: 1201, 0.975: 2401, 0.99: 3501 }, note: '' };
const text = buildReportCsv([row], { title: 'T', generatedAt: 'now', plan: false });

describe('buildReportCsv, calibrated', () => {
  it('has the three preset columns, named after the presets', () => {
    const head = text.split('\r\n').find((l) => l.startsWith('Course,'))!;
    expect(head).toContain('Cheap bid (e$),Balanced bid (e$),Safe bid (e$)');
    expect(head).not.toContain('chance (e$)');
  });
  it('writes the bumped bids per preset', () => {
    expect(text).toContain('12.01,24.01,35.01');
    expect(Object.keys(NO_BIDS)).toEqual(['0.9', '0.975', '0.99']);
  });
});

describe('planNote, calibrated', () => {
  const base = { issue: null, bid: 900, p: 0.9, fullBid: 3501, covered: '', none: false, capMode: true, target: 0.99 };
  it('names the style a cut bid fell below, not a percentage', () => {
    expect(planNote(base)).toBe('Cut to fit your balance · Below Safe · a Safe bid would be e$35.01');
    expect(planNote({ ...base, target: 0.9, fullBid: 1201 })).toBe('Cut to fit your balance · Below Cheap · a Cheap bid would be e$12.01');
  });
  it('says nothing for a bid that was not cut', () => {
    expect(planNote({ ...base, bid: 3501 })).toBe('');
    expect(planNote({ ...base, capMode: false })).toBe('');
  });
});

describe('bidReason, calibrated', () => {
  const curve = { pFill: 0.1, percentilesCents: { p50: 2700, p80: 3200, p90: 4100, p95: 4800, p99: 6000 } };
  const base = { bid: 6001, fullBid: 6001, target: 0.99, minBidCents: 1000, curve, nObs: 9 };
  it('a rarely-filling section bid above the minimum does not say the minimum is enough', () => {
    expect(bidReason(base)).toBe('Rarely fills · Safe also covers a surprise fill');
    expect(bidReason({ ...base, target: 0.9, bid: 2001, fullBid: 2001 })).toBe('Rarely fills · Cheap also covers a surprise fill');
  });
  it('a bid cut below the style does not name the style', () => {
    expect(bidReason({ ...base, bid: 3001 })).toBe('Rarely fills · this bid also covers a surprise fill');
  });
  it('at the minimum (also the minimum plus one cent) the minimum wording stays', () => {
    expect(bidReason({ ...base, bid: 1000, fullBid: 1000 })).toBe('Rarely fills · minimum e$10.00 likely enough');
    expect(bidReason({ ...base, bid: 1001, fullBid: 1001 })).toBe('Rarely fills · minimum e$10.00 likely enough');
  });
  it('a section that usually fills is unchanged', () => {
    expect(bidReason({ ...base, curve: { ...curve, pFill: 0.8 } })).toBe('Usually clears around e$27 · up to e$41');
  });
});
