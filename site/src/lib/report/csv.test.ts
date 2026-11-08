import { describe, expect, it } from 'vitest';
import type { Section } from '../data/types';
import {
  NO_BIDS, REPORT_CREDIT, REPORT_DISCLAIMER, buildReportCsv, courseNote, csvCell, reportFileName, scheduleText, sectionFacts, seatsText, sgtStamp,
  type ReportRow,
} from './csv';
import { bidReason, planNote, planReportRow, planTotals } from './plan';

const section = (over: Partial<Section> = {}): Section =>
  ({
    id: 'g1', section: 'G1', classNumber: '1234', instructor: 'TAN AH KOW',
    meetings: [{ day: 'MON', start: '09:00', end: '12:15', venue: 'SOE' }, { day: 'THU', start: '15:30', end: '18:45', venue: 'SOE' }],
    seatsTotal: 45, seatsLeft: 10,
    ...over,
  }) as Section;

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  ...sectionFacts('COR3304', 'Strategic Management', section()),
  window: 'Round 1B Window 1',
  bids: { 0.8: 1050, 0.9: 1200, 0.95: 1500 },
  note: '',
  ...over,
});

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('plain')).toBe('plain');
  });
  it('neutralises formula starters in text', () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) expect(csvCell(s).replace(/^"/, '')[0]).toBe("'");
    expect(csvCell('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
  });
  it('leaves numbers and empties alone', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(NaN)).toBe('');
  });
});

describe('buildReportCsv', () => {
  const meta = { title: 'Bidwise bid report: COR3304', generatedAt: '2026-11-08 09:20 SGT', plan: false };
  it('starts with a BOM, then title, timestamp, credit and disclaimer rows, a blank row and the header', () => {
    const lines = buildReportCsv([row()], meta).split('\r\n');
    expect(lines[0]).toBe('﻿Bidwise bid report: COR3304');
    expect(lines[1]).toBe('Generated 2026-11-08 09:20 SGT');
    expect(lines[2]).toBe(csvCell(REPORT_CREDIT));
    expect(lines[3]).toBe(csvCell(REPORT_DISCLAIMER));
    expect(lines[5]).toBe('');
    expect(lines[6].split(',')[0]).toBe('Course');
    expect(lines[6]).not.toContain('Plan bid');
  });
  it('writes bids as plain e$ amounts and joins the schedule', () => {
    const data = buildReportCsv([row()], meta).split('\r\n')[7];
    expect(data).toContain('Mon 09:00–12:15; Thu 15:30–18:45');
    expect(data).toContain('10.50,12.00,15.00');
  });
  it('marks estimated seats with ≈ and says so', () => {
    const est = row({ ...sectionFacts('COR3304', 'T', section({ live: { available: 7, total: 45, source: 'approx', capturedAt: '', window: '' } })) });
    const line = buildReportCsv([est], meta).split('\r\n')[7];
    expect(line).toContain('≈7,Estimated from previous window');
    expect(seatsText(7, 'live')).toBe('7');
  });
  it('adds the plan columns and totals for a planner report', () => {
    const r = row({ priority: 'Must get', group: 2, planBidCents: 1100, planChance: '86%' });
    const csv = buildReportCsv([r], { ...meta, plan: true, totals: planTotals({ balanceCents: 12500, bidTotalCents: 1100, leftCents: 11400, pAll: 0.86, needCents: null }) });
    const lines = csv.split('\r\n');
    expect(lines[6]).toContain('Priority,Group size');
    expect(lines[6]).toContain('Plan bid (e$),Chance at plan bid');
    expect(lines[7]).toContain('Must get,2,');
    expect(lines[7]).toContain('11.00,86%');
    expect(lines).toContain('Balance (e$),125.00');
    expect(lines).toContain('Left after bids (e$),114.00');
    expect(lines).toContain('Chance of all must-get courses,86%');
  });
  it('guards a hostile professor name and has the same column count on every row', () => {
    const bad = row({ professor: '=cmd|"/c calc"!A1', note: 'a, b' });
    const csv = buildReportCsv([bad, row()], meta);
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
    const parse = (l: string) => {
      let n = 1;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) n++;
      }
      return n;
    };
    const [head, a, b] = csv.split('\r\n').slice(6, 9);
    expect(parse(a)).toBe(parse(head));
    expect(parse(b)).toBe(parse(head));
  });
  it('writes notes under the credit rows', () => {
    const lines = buildReportCsv([row()], { ...meta, notes: ['Left out, section no longer offered: IS469'] }).split('\r\n');
    expect(lines[5]).toBe('"Left out, section no longer offered: IS469"');
    expect(lines[6]).toBe('');
  });
  it('carries no data beyond the rows it was given', () => {
    const csv = buildReportCsv([], meta);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(6);
  });
});

describe('helpers', () => {
  it('formats SGT whatever the viewer zone', () => {
    expect(sgtStamp(new Date('2026-11-08T01:20:00Z'))).toBe('2026-11-08 09:20 SGT');
    expect(sgtStamp(new Date('2026-11-07T17:05:00Z'))).toBe('2026-11-08 01:05 SGT');
  });
  it('says Time not set without meetings', () => {
    expect(scheduleText([])).toBe('Time not set');
  });
  it('builds a safe file name', () => {
    expect(reportFileName('COR 3304/x', new Date('2026-11-08T01:00:00Z'))).toBe('bidwise-COR-3304-x-bid-report-2026-11-08.csv');
  });
  it('course notes: full, likely full (est.), no forecast', () => {
    expect(courseNote(section({ seatsLeft: 0 }), true)).toBe('Full');
    expect(courseNote(section({ live: { available: 0, total: 45, source: 'approx', capturedAt: '', window: '' } }), true)).toBe('Likely full (est.)');
    expect(courseNote(section(), false)).toBe('No forecast');
    expect(courseNote(section(), true)).toBe('');
  });
  it('uses the seat counts the site shows and never the scan time', () => {
    const f = sectionFacts('X', 'Y', section({ live: { available: 3, total: 40, source: 'live', capturedAt: '2026-11-08T08:00:00+08:00', window: 'w' } }));
    expect(f.seats).toBe(3);
    expect(JSON.stringify(f)).not.toContain('2026-11-08T08');
    expect(NO_BIDS[0.9]).toBeNull();
  });
});

describe('planner rows', () => {
  const base = { code: 'COR3304', title: 'T', section: section(), role: 'required' as const, pickOf: '', group: 1, window: 'Round 1B Window 1', issue: null, bid: 1200, p: 0.9, fullBid: 1200, covered: '', none: false, capMode: false, target: 0.9, reason: '', clashes: [] as string[], bids: { 0.8: 1050, 0.9: 1200, 0.95: 1500 } };
  it('plain bid has no note and shows the plan figures', () => {
    const r = planReportRow(base);
    expect(r.note).toBe('');
    expect(r.planBidCents).toBe(1200);
    expect(r.planChance).toBe('90%');
    expect(r.priority).toBe('Must get');
  });
  it('labels a capped bid with the full bid', () => {
    expect(planNote({ ...base, bid: 900, capMode: true })).toBe('Cut to fit your balance · a bid for 90% would be e$12.00 (wanted 90%)');
    expect(planNote({ ...base, bid: 900, capMode: true, target: 0.95 })).toContain('a bid for 95% would be');
  });
  it('a skipped Pick one row says which course covers it and has no plan bid', () => {
    const r = planReportRow({ ...base, role: 'oneOf', pickOf: 'IS469 / IS470', bid: 0, p: 0, covered: 'COR3304 G2' });
    expect(r.note).toBe('Not bid · COR3304 G2 covers it');
    expect(r.planBidCents).toBeNull();
    expect(r.priority).toBe('Pick one of IS469 / IS470');
  });
  it('a row that cannot be simulated has no figures and the planner reason', () => {
    const r = planReportRow({ ...base, issue: 'estfull', bid: null, p: null, fullBid: null });
    expect(r.note).toBe('Likely full (est.)');
    expect(r.bids[0.9]).toBeNull();
    expect(r.planBidCents).toBeNull();
  });
  it('shows what it needs when the plan is not possible', () => {
    expect(planNote({ ...base, none: true, bid: 0 })).toBe('Needs e$12.00');
    expect(planTotals({ balanceCents: 12500, bidTotalCents: null, leftCents: null, pAll: null, needCents: 14000 })).toEqual([
      { label: 'Balance (e$)', value: '125.00' },
      { label: 'Must-gets need about (e$)', value: '140.00' },
    ]);
  });
});

describe('plan report extras', () => {
  const base = { code: 'COR3304', title: 'T', section: section(), role: 'required' as const, pickOf: '', group: 1, window: 'Round 1B Window 1', issue: null, bid: 1200, p: 0.9, fullBid: 1200, covered: '', none: false, capMode: false, target: 0.9, reason: 'Why', clashes: [] as string[], bids: { 0.8: 1050, 0.9: 1200, 0.95: 1500 } };
  it('carries the reason, the chance as a number and the clash into the report row', () => {
    const r = planReportRow({ ...base, clashes: ['Clashes with IS469 G2 (Mon 12:00–15:15)'] });
    expect(r.reason).toBe('Why');
    expect(r.planP).toBe(0.9);
    expect(r.note).toBe('Clashes with IS469 G2 (Mon 12:00–15:15)');
    expect(planReportRow({ ...base, capMode: true, bid: 900, clashes: ['Clashes with X (Mon 09:00–10:00)'] }).note).toBe('Cut to fit your balance · a bid for 90% would be e$12.00 (wanted 90%) · Clashes with X (Mon 09:00–10:00)');
  });
  it('rows that are not bid on have no reason and no shading', () => {
    const r = planReportRow({ ...base, bid: 0, p: 0 });
    expect(r.reason).toBe('');
    expect(r.planP).toBeNull();
  });
  it('writes the reason and the group label in the CSV', () => {
    const rows = [planReportRow({ ...base, role: 'oneOf', pickOf: 'IS469 / IS470', reason: 'Typical cutoff about e$20.00' })];
    const lines = buildReportCsv(rows, { title: 'T', generatedAt: 'x', plan: true }).split('\r\n');
    const head = lines.find((l) => l.startsWith('Course'))!;
    expect(head).toContain('Why this bid');
    const data = lines[lines.indexOf(head) + 1];
    expect(data).toContain('Pick one of IS469 / IS470');
    expect(data).toContain('Typical cutoff about e$20.00');
  });
});

describe('bidReason', () => {
  const curve = { pFill: 0.8, percentilesCents: { p50: 2700, p80: 3200, p90: 4100, p95: 4800, p99: 6000 } };
  const base = { bid: 4100, fullBid: 4100, target: 0.9, minBidCents: 1000, curve, nObs: 9 };
  it('gives the typical cutoff and how high it can go, in whole e$', () => {
    expect(bidReason(base)).toBe('Usually clears around e$27 · up to e$41');
    expect(bidReason({ ...base, target: 0.95 })).toBe('Usually clears around e$27 · up to e$41');
  });
  it('says nothing about a cut: the row and the report note carry that', () => {
    expect(bidReason({ ...base, bid: 3000 })).toBe('Usually clears around e$27 · up to e$41');
  });
  it('says the minimum bid is enough for a section that rarely fills', () => {
    expect(bidReason({ ...base, bid: 1000, curve: { ...curve, pFill: 0.1 } })).toBe('Rarely fills · minimum e$10.00 likely enough');
  });
  it('notes few past results', () => {
    expect(bidReason({ ...base, nObs: 2 })).toBe('Usually clears around e$27 · up to e$41 · Only 2 past results');
    expect(bidReason({ ...base, nObs: 1 })).toMatch(/ · Only 1 past result$/);
    expect(bidReason({ ...base, nObs: 3 })).not.toContain('past result');
    expect(bidReason({ ...base, nObs: 0 })).toMatch(/ · No past results$/);
  });
  it('is empty when the row is not bid on or has no forecast', () => {
    expect(bidReason({ ...base, bid: 0 })).toBe('');
    expect(bidReason({ ...base, bid: null })).toBe('');
    expect(bidReason({ ...base, curve: undefined })).toBe('');
  });
});
