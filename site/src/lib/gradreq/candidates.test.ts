import { beforeEach, describe, expect, it } from 'vitest';
import { candidates, clearCandidateCache, type OfferedCourse } from './candidates';
import { deriveBlocks } from './blocks';
import { group, loaded, member, view } from './fixtures';
import type { Block, Requisites } from './types';
import type { Section } from '../data/types';

const W = 'Round 1B Window 1';
const INTAKE = 'AY2025/26';

type Params = { demand: number; level: number };
/** A section with a forecast for W. Cheap = few bidders at low prices (almost certain at e$30); dear = many at high prices. */
function section(cn: string, p: Params | null, o: Partial<Section> = {}): Section {
  return {
    id: cn, section: 'G' + cn, classNumber: cn, instructor: 'PROF ' + cn, meetings: [{ day: 'TUE', start: '15:30', end: '18:45', venue: 'X' }],
    startDate: '2027-01-11', endDate: '2027-04-18', tba: false, hasClassDetails: true, seatsTotal: 40, seatsLeft: 5, latestWindow: W, enrolled: 35,
    minBidCents: 100,
    ...(p ? { forecast: { [W]: { demandMean: p.demand, demandDispersion: 5, priceLevelCents: p.level, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.1, anchorCents: 100, pooledLevel: 'course' as const, nObs: 3 } } } : {}),
    ...o,
  };
}
const course = (code: string, sections: Section[]): OfferedCourse => ({ code, title: 'Title ' + code, sectionsNow: sections });
const CHEAP: Params = { demand: 3, level: 300 };
const DEAR: Params = { demand: 40, level: 9000 };
const MID: Params = { demand: 12, level: 2500 };
const opts = { window: W, runs: 400 };

function blockOf(members: ReturnType<typeof member>[], completed: string[] = [], extra = {}): Block {
  const r = deriveBlocks([loaded('degree', view('v', [group('g', { cus: 2, members, ...extra })]))], INTAKE, completed);
  return [...r.open, ...r.finished][0];
}

beforeEach(() => clearCandidateCache());

describe('candidate filtering', () => {
  const offered = new Map<string, OfferedCourse>([
    ['A', course('A', [section('1', CHEAP)])],
    ['B', course('B', [section('2', CHEAP)])],
    ['C', course('C', [section('3', CHEAP)])],
    ['D', course('D', [section('4', CHEAP)])],
    ['H', course('H', [section('5', CHEAP)])],
    ['E', course('E', [])],
  ]);
  const reqs: Requisites = { B: { prereq: 'Z' }, C: { prereq: 'D2', uncertain: true } };

  it('keeps offered, not completed, not blocked members; hints go to mayCount; unoffered and empty ones are dropped', () => {
    const b = blockOf([member('A'), member('B'), member('C'), member('D', { cls: 'tagged' }), member('E'), member('NOKEY'), member('H', { cls: 'hint' })], ['D2']);
    const r = candidates(b, offered, ['D2'], reqs, opts);
    expect(r.candidates.map((c) => c.code).sort()).toEqual(['A', 'C', 'D']);
    expect(r.candidates.find((c) => c.code === 'C')?.eligibility).toBe('check');
    expect(r.mayCount.map((m) => m.code)).toEqual(['H']);
  });

  it('skips a completed course and a member whose choice set is satisfied; a complete block has no candidates', () => {
    const sets = { choiceSets: [{ id: 's', members: [0, 1] }] };
    const b = blockOf([member('A'), member('B'), member('C')], ['A'], sets);
    expect(b.complete).toBe(false);
    expect(candidates(b, offered, ['A'], {}, opts).candidates.map((c) => c.code)).toEqual(['C']);
    const done = blockOf([member('A'), member('C')], ['A', 'C']);
    expect(candidates(done, offered, ['A', 'C'], {}, opts)).toEqual({ candidates: [], mayCount: [] });
  });

  it('accepts a plain object as offered data', () => {
    const b = blockOf([member('A')]);
    expect(candidates(b, { A: offered.get('A') as OfferedCourse }, [], {}, opts).candidates).toHaveLength(1);
  });
});

describe('sections', () => {
  it('lists sections with seats, actual times, instructor and bid; counts full ones apart', () => {
    const full = section('2', CHEAP, { seatsLeft: 0 });
    const est = section('3', CHEAP, { seatsLeft: 0, live: { available: 0, total: 40, source: 'approx', capturedAt: '', window: W } });
    const open = section('1', CHEAP, { meetings: [{ day: 'MON', start: '08:15', end: '11:30', venue: '' }, { day: 'THU', start: '08:15', end: '11:30', venue: '' }] });
    const b = blockOf([member('A')]);
    const c = candidates(b, new Map([['A', course('A', [full, est, open])]]), [], {}, opts).candidates[0];
    expect(c.fullSections).toBe(2);
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0]).toMatchObject({ classNumber: '1', instructor: 'PROF 1', seatsLeft: 5, times: 'Mon, Thu 08:15–11:30', window: W, issue: null });
    expect(c.sections[0].bidCents).toBeGreaterThanOrEqual(100);
    expect(c.sections[0].chance).toBeGreaterThan(0.9);
  });

  it('gives no chance for a section without a forecast, and chance 0 for a bid under its minimum', () => {
    const b = blockOf([member('A'), member('B')]);
    const offered = new Map([
      ['A', course('A', [section('1', null)])],
      ['B', course('B', [section('2', CHEAP, { minBidCents: 5000 })])],
    ]);
    const r = candidates(b, offered, [], {}, { ...opts, bid: 3000 }).candidates;
    expect(r.find((c) => c.code === 'A')).toMatchObject({ chance: null, bidCents: null });
    expect(r.find((c) => c.code === 'A')?.sections[0].issue).toBe('nofc');
    expect(r.find((c) => c.code === 'B')?.sections[0].chance).toBe(0);
  });
});

describe('sorting', () => {
  const offered = new Map<string, OfferedCourse>([
    ['DEAR', course('DEAR', [section('1', DEAR)])],
    ['CHEAP', course('CHEAP', [section('2', CHEAP)])],
    ['MID', course('MID', [section('3', MID)])],
    ['NOFC', course('NOFC', [section('4', null)])],
    ['FULL', course('FULL', [section('5', CHEAP, { seatsLeft: 0 })])],
  ]);
  const b = blockOf(['DEAR', 'CHEAP', 'MID', 'NOFC', 'FULL'].map((c) => member(c)));

  it('chance (default) puts the likeliest first, courses with no forecast or no seats last', () => {
    const r = candidates(b, offered, [], {}, opts).candidates;
    expect(r.map((c) => c.code).slice(0, 3)).toEqual(['CHEAP', 'MID', 'DEAR']);
    expect(r.map((c) => c.code).slice(3).sort()).toEqual(['FULL', 'NOFC']);
    const chances = r.slice(0, 3).map((c) => c.chance as number);
    expect(chances[0]).toBeGreaterThan(chances[1]);
    expect(chances[1]).toBeGreaterThan(chances[2]);
  });

  it('chance is measured at the same bid for every course: a higher bid lifts it', () => {
    const at = (bid: number) => candidates(b, offered, [], {}, { ...opts, bid }).candidates.find((c) => c.code === 'MID')?.chance as number;
    expect(at(6000)).toBeGreaterThan(at(1500));
  });

  it('cheapest puts the lowest recommended bid first', () => {
    const r = candidates(b, offered, [], {}, { ...opts, sort: 'cheapest' }).candidates;
    expect(r.map((c) => c.code).slice(0, 3)).toEqual(['CHEAP', 'MID', 'DEAR']);
    const bids = r.slice(0, 3).map((c) => c.bidCents as number);
    expect(bids[0]).toBeLessThan(bids[1]);
    expect(bids[1]).toBeLessThan(bids[2]);
  });

  it('takes the best section of a course for both sorts', () => {
    const two = new Map([
      ['X', course('X', [section('1', DEAR), section('2', CHEAP)])],
      ['Y', course('Y', [section('3', MID)])],
    ]);
    const blk = blockOf([member('X'), member('Y')]);
    for (const sort of ['chance', 'cheapest'] as const) {
      const r = candidates(blk, two, [], {}, { ...opts, sort }).candidates;
      expect(r[0].code).toBe('X');
      expect(r[0].sections[0].classNumber).toBe('2');
    }
  });

  it('puts rule members before tagged ones at equal rank, then mandatory, then code', () => {
    const same = new Map<string, OfferedCourse>(['T1', 'R2', 'R1', 'M1'].map((c) => [c, course(c, [section('9' + c, CHEAP)])]));
    // identical sections give identical chance and bid
    const blk = blockOf([member('T1', { cls: 'tagged' }), member('R2'), member('R1'), member('M1', { mandatory: true })]);
    for (const sort of ['chance', 'cheapest'] as const) {
      const r = candidates(blk, same, [], {}, { ...opts, sort }).candidates.map((c) => c.code);
      expect(r).toEqual(['M1', 'R1', 'R2', 'T1']);
    }
  });
});
