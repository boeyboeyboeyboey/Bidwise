import { describe, expect, it } from 'vitest';
import { affordableRows, blockCodes, chunk, dedupeBlocks, effectiveRequisites, noFinalOnly, eText, moneyText, noteFor, otherRows, prunedCourses, pseudoBlock, reserveCap, capTooLow, blockTabs, resolveTab, tabKeyTarget, withNotes } from './logic';
import { candidates, clearCandidateCache } from '../../lib/gradreq';
import type { Candidate, OfferedCourse, Requisites, SectionOption } from '../../lib/gradreq';
import type { Section } from '../../lib/data/types';

const sec = (section: string, bidCents: number | null, seatsLeft = 5): SectionOption => ({
  classNumber: section, section, instructor: 'P', seatsLeft, seatsTotal: 40, seatSource: 'live', times: 'Mon 12:00–15:15', meetings: [],
  minBidCents: 100, window: 'W', bidCents, chance: null, pFill: null, issue: null,
});
const cand = (code: string, sections: SectionOption[]): Candidate => ({
  code, title: 'T' + code, cls: 'rule', mandatory: false, cus: 1, eligibility: 'ok', sections, fullSections: 0, chance: null, bidCents: null,
});

describe('reserveCap', () => {
  it('leaves e$10 for each other course still needed', () => {
    expect(reserveCap(6000, 1)).toBe(6000);
    expect(reserveCap(6000, 2)).toBe(5000);
    expect(reserveCap(6000, 3)).toBe(4000);
  });
  it('is no limit when e$ left is blank, and flags a limit under the e$10 minimum bid', () => {
    expect(reserveCap(null, 3)).toBeNull();
    expect(capTooLow(reserveCap(null, 3))).toBe(false);
    expect(capTooLow(reserveCap(2500, 3))).toBe(true);
    expect(capTooLow(reserveCap(3000, 3))).toBe(false);
    expect(capTooLow(reserveCap(900, 1))).toBe(true);
  });
  it('clamps the number of courses to 1..3', () => {
    expect([reserveCap(6000, 0), reserveCap(6000, 9)]).toEqual([6000, 4000]);
  });
  it('writes whole e$ plainly and others with two decimals', () => {
    expect([moneyText(4000), moneyText(4050), moneyText(333), eText(1234)]).toEqual(['40', '40.50', '3.33', 'e$12.34']);
  });
});

describe('affordableRows', () => {
  const cands = [
    cand('A', [sec('G1', 3000), sec('G2', 1500, 2)]),
    cand('B', [sec('G1', 1500, 9), sec('G2', null), sec('G3', 900, 0)]),
    cand('C', [sec('G1', 4001)]),
  ];
  it('keeps sections with seats, a priced bid and bid <= budget, cheapest first, more seats on a tie', () => {
    const rows = affordableRows(cands, 3000);
    expect(rows.map((r) => `${r.code}${r.section.section}:${r.section.bidCents}`)).toEqual(['BG1:1500', 'AG2:1500', 'AG1:3000']);
  });
  it('includes a bid exactly at the budget and nothing when the budget is below every bid', () => {
    expect(affordableRows(cands, 4001).some((r) => r.code === 'C')).toBe(true);
    expect(affordableRows(cands, 1000)).toEqual([]);
  });
  it('keeps every section with seats and a price when there is no limit', () => {
    const rows = affordableRows(cands, null);
    expect(rows.map((r) => `${r.code}${r.section.section}`)).toEqual(['BG1', 'AG2', 'AG1', 'CG1']);
  });
  it('splits the no-degree list from the courses that fill an open requirement', () => {
    const rows = affordableRows(cands, 3000);
    expect(otherRows(rows, new Set(['A'])).map((r) => r.code)).toEqual(['B']);
  });
});

describe('no-degree list through candidates()', () => {
  const W = 'Round 1B Window 1';
  const section = (cn: string, minBid: number | undefined, p: { demand: number; level: number }): Section => ({
    id: cn, section: 'G' + cn, classNumber: cn, instructor: 'P' + cn, meetings: [{ day: 'TUE', start: '15:30', end: '18:45', venue: 'X' }],
    startDate: '', endDate: '', tba: false, hasClassDetails: true, seatsTotal: 40, seatsLeft: 5, latestWindow: W, enrolled: 35,
    ...(minBid === undefined ? {} : { minBidCents: minBid, forecast: { [W]: { demandMean: p.demand, demandDispersion: 5, priceLevelCents: p.level, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.1, anchorCents: 100, pooledLevel: 'course' as const, nObs: 3 } } }),
  });
  const courses: OfferedCourse[] = [
    { code: 'CHEAP', title: 'Cheap', sectionsNow: [section('1', 100, { demand: 3, level: 300 })] },
    { code: 'DEAR', title: 'Dear', sectionsNow: [section('2', 100, { demand: 40, level: 9000 })] },
    { code: 'NOFC', title: 'No forecast', sectionsNow: [section('3', undefined, { demand: 1, level: 1 })] },
    { code: 'FLOOR', title: 'Floor above budget', sectionsNow: [section('4', 9000, { demand: 3, level: 300 })] },
  ];
  it('prunes unpriced sections and those whose minimum bid is over budget', () => {
    expect(prunedCourses(courses, 5000).map((c) => c.code)).toEqual(['CHEAP', 'DEAR']);
  });
  it('prunes only the unpriced sections when there is no limit', () => {
    expect(prunedCourses(courses, null).map((c) => c.code)).toEqual(['CHEAP', 'DEAR', 'FLOOR']);
  });
  it('lists only courses whose bid at the chosen chance fits, excluding completed ones', () => {
    clearCandidateCache();
    const pruned = prunedCourses(courses, 4000);
    const run = (done: string[]) => candidates(pseudoBlock(pruned), new Map(pruned.map((c) => [c.code, c])), done, {}, { window: W, bid: 4000, target: 0.8, runs: 400 });
    const rows = affordableRows(run([]).candidates, 4000);
    expect(rows.map((r) => r.code)).toEqual(['CHEAP']);
    expect(affordableRows(run(['CHEAP']).candidates, 4000)).toEqual([]);
    expect(affordableRows(run([]).candidates, 100)).toEqual([]);
  });
  it('knows which courses fill open blocks and chunks lists', () => {
    expect([...blockCodes([pseudoBlock([{ code: 'X', title: 'x' }])])]).toEqual(['X']);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('prerequisites with and without courses marked done', () => {
  const W = 'Round 1B Window 1';
  const section = (cn: string): Section => ({
    id: cn, section: 'G' + cn, classNumber: cn, instructor: 'P', meetings: [{ day: 'TUE', start: '15:30', end: '18:45', venue: 'X' }],
    startDate: '', endDate: '', tba: false, hasClassDetails: true, seatsTotal: 40, seatsLeft: 5, latestWindow: W, enrolled: 35,
    minBidCents: 100, forecast: { [W]: { demandMean: 3, demandDispersion: 5, priceLevelCents: 300, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.1, anchorCents: 100, pooledLevel: 'course' as const, nObs: 3 } },
  });
  const courses: OfferedCourse[] = [
    { code: 'ACCT201', title: 'Needs one', sectionsNow: [section('1')] },
    { code: 'ACCT301', title: 'Needs a tree', sectionsNow: [section('2')] },
    { code: 'FREE100', title: 'No rule', sectionsNow: [section('3')] },
    { code: 'VAGUE', title: 'Uncertain, no tree', sectionsNow: [section('4')] },
  ];
  const reqs: Requisites = {
    ACCT201: { prereq: 'ACCT101' },
    ACCT301: { prereq: ['and', ['or', 'A', 'B'], 'C'] },
    VAGUE: { uncertain: true },
  };
  const run = (done: string[]) => {
    clearCandidateCache();
    const hasDone = done.length > 0;
    const out = candidates(pseudoBlock(courses), new Map(courses.map((c) => [c.code, c])), done, effectiveRequisites(reqs, hasDone), { window: W, bid: 5000, target: 0.8, runs: 300 });
    return withNotes(affordableRows(out.candidates, 5000), reqs, hasDone).map((r) => `${r.code}:${r.note ?? ''}`);
  };

  it('with nothing done, hides nothing and tags courses that have prerequisites', () => {
    expect(run([])).toEqual(['ACCT201:Needs ACCT101', 'ACCT301:Has prerequisites', 'FREE100:', 'VAGUE:'].sort());
  });
  it('with something done, hides courses whose prerequisite is not met and keeps the rest untagged', () => {
    expect(run(['OTHER'])).toEqual(['FREE100:', 'VAGUE:']);
    expect(run(['ACCT101'])).toEqual(['ACCT201:', 'FREE100:', 'VAGUE:']);
  });
  it('words the tag for flat and, or lists and gives up on deeper trees', () => {
    const r: Requisites = { A: { prereq: ['and', 'X', 'Y'] }, B: { prereq: ['or', 'X', 'Y'] }, C: { prereq: ['and', 'W', 'X', 'Y', 'Z'] }, D: { prereq: ['and', ['or', 'X', 'Y'], 'Z'] } };
    expect(['A', 'B', 'C', 'D', 'NONE'].map((c) => noteFor(c, 'ok', r, false))).toEqual(['Needs X and Y', 'Needs X or Y', 'Has prerequisites', 'Has prerequisites', null]);
    expect(noteFor('A', 'check', r, true)).toBe('Check prerequisites on BOSS');
    expect(noteFor('A', 'ok', r, true)).toBeNull();
  });
});

describe('dedupeBlocks', () => {
  const row = (code: string, bid: number) => ({ code, title: code, eligibility: 'ok' as const, cls: 'rule' as const, section: sec('G1', bid) });
  it('lists a course once, in the first block, and names it in later blocks', () => {
    const m = dedupeBlocks([
      { key: 'a', rows: [row('IS112', 100), row('IS112', 200), row('X', 300)] },
      { key: 'b', rows: [row('IS112', 100), row('CS440', 400)] },
      { key: 'c', rows: [row('CS440', 400), row('IS112', 100)] },
    ]);
    expect(m.get('a')!.rows.map((r) => r.code)).toEqual(['IS112', 'IS112', 'X']);
    expect(m.get('b')).toMatchObject({ rows: [expect.objectContaining({ code: 'CS440' })], also: ['IS112'] });
    expect(m.get('c')).toMatchObject({ rows: [], also: ['CS440', 'IS112'] });
  });
});

describe('requirement tabs', () => {
  const blocks = [
    { key: 'v\0a', name: 'Major core', heading: 'Core', count: 12 },
    { key: 'v\0b', name: 'Electives', heading: 'Major', count: 0 },
    { key: 'w\0c', name: 'Electives', heading: 'Second major', count: 4 },
  ];
  it('lists All, each block that has rows with its count, and free electives only when there are rows', () => {
    const tabs = blockTabs(blocks, 7);
    expect(tabs.map((t) => `${t.label}|${t.count}`)).toEqual(['All|-1', 'Major core|12', 'Electives · Second major|4', 'Free electives|7']);
    expect(blockTabs(blocks, 0).some((t) => t.id === 'other')).toBe(false);
  });
  it('falls back to All when the selected tab is gone', () => {
    const tabs = blockTabs(blocks, 0);
    expect(resolveTab(tabs, 'v\0a')).toBe('v\0a');
    expect(resolveTab(tabs, 'other')).toBe('all');
    expect(resolveTab(tabs, 'gone')).toBe('all');
  });
  it('moves between tabs with the arrow keys, wrapping, and with Home and End', () => {
    expect([tabKeyTarget('ArrowRight', 3, 4), tabKeyTarget('ArrowLeft', 0, 4), tabKeyTarget('Home', 2, 4), tabKeyTarget('End', 0, 4), tabKeyTarget('a', 0, 4), tabKeyTarget('ArrowRight', 0, 0)]).toEqual([0, 3, 0, 3, null, null]);
  });
});

describe('noFinalOnly', () => {
  const osec = (id: string, exam?: Section['exam']) => ({ id, section: id, classNumber: id, instructor: 'P', meetings: [], minBidCents: 100, ...(exam === undefined ? {} : { exam }) }) as unknown as Section;
  const slot = { date: '2027-04-29', start: '13:00', end: '15:00' };
  const courses: OfferedCourse[] = [
    { code: 'A', title: 'A', sectionsNow: [osec('A1', slot), osec('A2', null)] },
    { code: 'B', title: 'B', sectionsNow: [osec('B1', slot)] },
    { code: 'C', title: 'C', sectionsNow: [osec('C1'), osec('C2', { date: 'TBA', start: '', end: null })] },
  ];
  it('returns every course unchanged when off', () => {
    expect(noFinalOnly(courses, false)).toBe(courses);
  });
  it('keeps a course with only its exam-free sections and drops a course with none', () => {
    const out = noFinalOnly(courses, true);
    expect(out.map((c) => [c.code, c.sectionsNow.map((s) => s.id)])).toEqual([['A', ['A2']], ['C', ['C1', 'C2']]]);
  });
  it('treats missing, null and unreadable exam data as no exam listed, like Browse', () => {
    expect(noFinalOnly([{ code: 'D', title: 'D', sectionsNow: [osec('D1'), osec('D2', null)] }], true)[0].sectionsNow).toHaveLength(2);
  });
});
