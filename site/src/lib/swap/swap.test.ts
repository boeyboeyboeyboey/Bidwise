import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CourseData, ForecastWindow, HistoryRow, Section } from '../data/types';
import { simulate } from '../sim';
import { FORECAST_SEED, toSimParams } from '../sim/forecast';
import { K, LIKELY_AT, R, SWAP_WINDOW, TIE_WEIGHT, UNLIKELY_BELOW, desirabilities, fallbackDesirability, holdersIn, holdersOf, isPreAssigned, labelFor, offeredShare, rawDesirability, requestProb, swapChance, swapOptions, swapResult, type SwapLabel } from './swap';
import { SWAP_RUNS } from './swapSim';

const fc = (demandMean: number, nObs = 6, priceLevelCents = 1500): ForecastWindow => ({
  demandMean, demandDispersion: 0.4, priceLevelCents, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.3,
  anchorCents: 1000, pooledLevel: 'course×instructor', nObs,
});

function sec(id: string, o: { seats?: number; demand?: number | null; instructor?: string; day?: string; start?: string; price?: number } = {}): Section {
  const seats = o.seats ?? 48;
  return {
    id, section: id, classNumber: '1', instructor: o.instructor ?? 'PROF ' + id,
    meetings: [{ day: o.day ?? 'MON', start: o.start ?? '08:15', end: '11:30', venue: 'X' }],
    startDate: '', endDate: '', tba: false, hasClassDetails: true, seatsTotal: seats, seatsLeft: 0,
    latestWindow: '', enrolled: seats,
    forecast: o.demand == null ? undefined : { [SWAP_WINDOW]: fc(o.demand, 6, o.price) },
  };
}

const hist = (term: string, section: string, instructor: string, cents: number | null, day = 'MON', start = '08:15'): HistoryRow => ({
  term, window: 'Round 1A Window 1', section, classNumber: '1', instructor, days: day, start, end: '11:30',
  medianCents: cents, minCents: cents, vacancy: 45, before: 10, after: 2, enrolled: 45,
});

/** A Round 1 Window 1 row: `vacancy` seats in the section, `before` of them put up for bidding. */
const r1 = (section: string, before: number, vacancy = 45, window = 'Round 1A Window 1'): HistoryRow => ({
  ...hist('2025-26 Term 1', section, 'PROF ' + section, null), window, vacancy, before,
});
/** Pre-assigned history: 3 or more rows with a small share offered. */
const preHistory = (before = 2) => ['G1', 'G2', 'G3', 'G4'].map((g) => r1(g, before));

describe('swapChance', () => {
  it('is exact in a tiny case', () => {
    // nA=1: X=0, so chance = P(Y>=1) = 1-(1-p)^nB
    expect(swapChance(1, 3, 0.2, 0.5)).toBeCloseTo(1 - 0.5 ** 3, 12);
    // nA=2, nB=1, pAB=1 (X=1), pBA=1 (Y=1): min(2,1)/2
    expect(swapChance(2, 1, 1, 1)).toBeCloseTo(0.5, 12);
  });

  it('stays in [0, 1] and is deterministic', () => {
    for (const [a, b] of [[1, 1], [10, 40], [48, 48], [54, 5]]) {
      for (const p of [0, 0.01, 0.2, 0.9]) {
        const c = swapChance(a, b, p, 1 - p / 2);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        expect(swapChance(a, b, p, 1 - p / 2)).toBe(c);
      }
    }
  });

  it('rises with the number of requesters from B and falls with rivals in A', () => {
    expect(swapChance(48, 48, 0.1, 0.3)).toBeGreaterThan(swapChance(48, 48, 0.1, 0.1));
    expect(swapChance(48, 48, 0.3, 0.1)).toBeLessThan(swapChance(48, 48, 0.1, 0.1));
  });

  it('rises with the seats in B', () => {
    let prev = -1;
    for (const nB of [5, 10, 20, 40, 80]) {
      const c = swapChance(48, nB, 0.1, 0.1);
      expect(c).toBeGreaterThan(prev);
      prev = c;
    }
  });
});

describe('calibration to the target ranges (45 v 45 seats)', () => {
  const at = (d: number) => swapResult(45, 45, 0, d);
  // Δd bands, from the pairwise within-course gaps in |d| over the 163 multi-section courses (median 0.10, 75th percentile 0.28):
  // about the same |Δd| <= 0.03; cheaper -0.25..-0.12; pricier 0.15..0.25; much pricier >= 0.40. Tolerance 3 points outside the target ranges.
  it('about the same: 60-70%', () => {
    for (const d of [-0.03, 0, 0.03]) expect(at(d).chance).toBeGreaterThanOrEqual(0.57);
    for (const d of [-0.03, 0, 0.03]) expect(at(d).chance).toBeLessThanOrEqual(0.73);
    expect(at(0).chance).toBeGreaterThanOrEqual(0.6);
    expect(at(0).chance).toBeLessThanOrEqual(0.7);
  });
  it('cheaper / less wanted: 80-90%', () => {
    for (const d of [-0.12, -0.18, -0.25]) {
      expect(at(d).chance).toBeGreaterThanOrEqual(0.8);
      expect(at(d).chance).toBeLessThanOrEqual(0.95);
    }
  });
  it('pricier / more wanted: 20-40%', () => {
    for (const d of [0.15, 0.2, 0.25]) {
      expect(at(d).chance).toBeGreaterThanOrEqual(0.2);
      expect(at(d).chance).toBeLessThanOrEqual(0.4);
    }
  });
  it('much pricier: under 15%', () => {
    for (const d of [0.4, 0.6, 1]) expect(at(d).chance).toBeLessThan(0.15);
  });
  it('is monotone: the chance never rises as the target gets more wanted', () => {
    let prev = 2;
    for (const d of [-2, -1, -0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5, 1, 2]) {
      const c = at(d).chance;
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      prev = c;
    }
  });
  it('the band brackets the central chance and is a modest width around the anchors', () => {
    for (const d of [-0.25, 0, 0.2, 0.5]) {
      const g = at(d);
      expect(0 <= g.low && g.low <= g.chance && g.chance <= g.high && g.high <= 1).toBe(true);
    }
    expect(at(0).high - at(0).low).toBeGreaterThan(0.08);
    expect(at(0).high - at(0).low).toBeLessThan(0.25);
  });
  it('uses the chosen centre', () => {
    expect([R, K]).toEqual([0.1, 5.5]);
  });
  it('request probability is symmetric around equal desirability and capped by r', () => {
    expect(requestProb(0.2, 2, 0, 0)).toBeCloseTo(0.1, 12);
    expect(requestProb(0.2, 2, 0, 5)).toBeLessThan(0.2);
    expect(requestProb(0.2, 2, 0, 5) + requestProb(0.2, 2, 5, 0)).toBeCloseTo(0.2, 12);
  });
});

describe('labels', () => {
  it('Likely from 75%, Unlikely under 40%, Possible between', () => {
    expect([LIKELY_AT, UNLIKELY_BELOW]).toEqual([0.75, 0.4]);
    expect(labelFor(0.75)).toBe('likely');
    expect(labelFor(0.7499)).toBe('possible');
    expect(labelFor(0.4)).toBe('possible');
    expect(labelFor(0.3999)).toBe('unlikely');
    expect(labelFor(0)).toBe('unlikely');
    expect(labelFor(1)).toBe('likely');
  });
  it('comes from the central chance, not the band', () => {
    const g = swapResult(45, 45, 0, 0);
    expect(g.label).toBe(labelFor(g.chance));
    expect(g.label).toBe('possible');
    expect(g.high).toBeGreaterThan(LIKELY_AT - 0.1);
  });
  it('follows desirability: cheaper target Likely, same Possible, pricier Unlikely', () => {
    expect(swapResult(45, 45, 0, -0.25).label).toBe('likely');
    expect(swapResult(45, 45, 0, 0).label).toBe('possible');
    expect(swapResult(45, 45, 0, 0.25).label).toBe('unlikely');
  });
});

describe('pre-assigned courses', () => {
  it('are detected by the median share of seats offered in Round 1 Window 1 (under 0.25)', () => {
    expect(offeredShare(preHistory(2))).toBeCloseTo(2 / 45, 12);
    expect(isPreAssigned(preHistory(2))).toBe(true);
    expect(isPreAssigned(preHistory(11))).toBe(true); // 0.244
    expect(isPreAssigned(preHistory(12))).toBe(false); // 0.267
    expect(isPreAssigned([r1('G1', 40), r1('G2', 40), r1('G3', 40), r1('G4', 0)])).toBe(false); // median, not mean
  });
  it('reads both Round 1 Window 1 labels and ignores other windows and too few rows', () => {
    expect(isPreAssigned(['G1', 'G2', 'G3'].map((g) => r1(g, 0, 45, 'Round 1 Window 1')))).toBe(true);
    expect(isPreAssigned(['G1', 'G2', 'G3'].map((g) => r1(g, 0, 45, 'Round 1B Window 1')))).toBe(false);
    expect(isPreAssigned([r1('G1', 0), r1('G2', 0)])).toBe(false);
    expect(isPreAssigned([])).toBe(false);
    expect(isPreAssigned(undefined)).toBe(false);
  });
  it('holders are seats minus the typical seats offered for that section, else the course, at least 1', () => {
    const h = [r1('G1', 4), r1('G1', 2), r1('G1', 6), r1('G2', 1), r1('G2', 1), r1('G2', 1)]; // G1 median 4, course median 1.5
    expect(holdersIn(sec('G1', { seats: 45 }), h, true)).toBe(41);
    expect(holdersIn(sec('G7', { seats: 45 }), h, true)).toBe(43); // no rows for G7: course median 1.5 rounds to 2
    expect(holdersIn(sec('G1', { seats: 3 }), [r1('G1', 9), r1('G1', 9), r1('G1', 9)], true)).toBe(1);
    expect(holdersIn(sec('G1', { seats: 0 }), h, true)).toBe(0);
    expect(holdersIn(sec('G1', { seats: 45 }), h, false)).toBe(45); // normal courses: seats
  });
  it('use ln(forecast price level), centred on the course, with no predicted bids', () => {
    const c = {
      sectionsNow: [sec('G1', { demand: 2, price: 1000 }), sec('G2', { demand: 2, price: 2000 }), sec('G3', { demand: 2, price: 4000 })],
      history: preHistory(),
    };
    const ds = desirabilities(c); // no bids passed
    expect(ds.get('G2')!.d).toBeCloseTo(0, 12);
    expect(ds.get('G3')!.d).toBeCloseTo(Math.log(2), 12);
    expect(ds.get('G1')!.d).toBeCloseTo(-Math.log(2), 12);
    expect(ds.get('G1')!.fallback).toBe(false);
    // simulated bids are ignored for these courses
    expect(desirabilities(c, new Map([['G1', 9999], ['G2', 1], ['G3', 1]])).get('G3')!.d).toBeCloseTo(Math.log(2), 12);
    const o = swapOptions(c, 'G1');
    expect(o.every((x) => x.preAssigned && !x.fallback && x.chance !== null)).toBe(true);
    expect(o.find((x) => x.section === 'G3')!.chance!).toBeLessThan(o.find((x) => x.section === 'G2')!.chance!);
  });
  it('are not Possible by default: a cheaper slot is Likely, a pricier one Unlikely', () => {
    const c = {
      sectionsNow: [sec('G1', { demand: 2, price: 3000 }), sec('G2', { demand: 2, price: 2000 }), sec('G3', { demand: 2, price: 4000 }), sec('G4', { demand: 2, price: 3000 })],
      history: preHistory(),
    };
    const by = Object.fromEntries(swapOptions(c, 'G1').map((x) => [x.section, x.label]));
    expect(by).toEqual({ G2: 'likely', G3: 'unlikely', G4: 'possible' });
  });
  it('normal courses are not affected: they still need predicted bids', () => {
    const c = { sectionsNow: [sec('G1', { demand: 100 }), sec('G2', { demand: 100 })], history: [r1('G1', 40), r1('G2', 40), r1('G3', 40)] };
    expect(swapOptions(c, 'G1')[0]).toMatchObject({ preAssigned: false, fallback: true });
  });
});

describe('desirability', () => {
  it('is ln(median bid) plus the tie-break on ln(demand per seat), centred on the course', () => {
    expect(rawDesirability(2000, 100, 50)).toBeCloseTo(Math.log(2000) + TIE_WEIGHT * Math.log(2), 12);
    const c = { sectionsNow: [sec('G1', { demand: 100 }), sec('G2', { demand: 100 }), sec('G3', { demand: 100 })] };
    const ds = desirabilities(c, new Map([['G1', 1000], ['G2', 2000], ['G3', 4000]]));
    expect(ds.get('G2')!.d).toBeCloseTo(0, 12); // the course median
    expect(ds.get('G3')!.d - ds.get('G1')!.d).toBeCloseTo(Math.log(4), 12);
    expect(ds.get('G1')!.fallback).toBe(false);
    expect(ds.get('G1')!.sampleSize).toBe(6);
  });

  it('breaks ties at the same bid by demand per seat, and a 1.5x price gap outweighs a 2x demand gap', () => {
    const c = { sectionsNow: [sec('G1', { demand: 200 }), sec('G2', { demand: 50 }), sec('G3', { demand: 25 })] };
    const ds = desirabilities(c, new Map([['G1', 1000], ['G2', 1000], ['G3', 1500]]));
    expect(ds.get('G1')!.d).toBeGreaterThan(ds.get('G2')!.d);
    expect(ds.get('G3')!.d).toBeGreaterThan(ds.get('G2')!.d); // half the demand per seat, but 1.5x the bid
  });

  it('falls back to last term bids when a section has no predicted bid, and flags it', () => {
    const history = [
      hist('2024-25 Term 1', 'A', 'PROF X', 3000),
      hist('2024-25 Term 1', 'B', 'PROF Y', 1000),
      hist('2024-25 Term 1', 'C', 'PROF Z', 1500),
      hist('2023-24 Term 1', 'A', 'PROF X', 1), // older term ignored
    ];
    const hot = fallbackDesirability(sec('G1', { instructor: 'PROF X' }), history);
    const cold = fallbackDesirability(sec('G2', { instructor: 'PROF Y' }), history);
    expect(hot.fallback).toBe(true);
    expect(hot.sampleSize).toBe(1);
    expect(hot.d).toBeCloseTo(Math.log(3000 / 1500), 12);
    expect(cold.d).toBeLessThan(0);
    const ds = desirabilities({ sectionsNow: [sec('G1', { instructor: 'PROF X' })], history });
    expect(ds.get('G1')!.fallback).toBe(true);
  });

  it('matches on day and start when the instructor is new, and is neutral when nothing matches', () => {
    const history = [hist('2024-25 Term 1', 'A', 'OLD', 2000, 'TUE', '12:00'), hist('2024-25 Term 1', 'B', 'OLD2', 1000)];
    expect(fallbackDesirability(sec('G1', { instructor: 'NEW', day: 'TUE', start: '12:00' }), history).d).toBeGreaterThan(0);
    const none = fallbackDesirability(sec('G2', { instructor: 'NEW', day: 'FRI', start: '19:00' }), history);
    expect(none).toMatchObject({ d: 0, fallback: true, sampleSize: 0 });
    expect(fallbackDesirability(sec('G3'), []).sampleSize).toBe(0);
  });
});


describe('swapOptions', () => {
  const course = {
    sectionsNow: [
      sec('G1', { demand: 100 }),
      sec('G2', { demand: 100 }),
      sec('G3', { demand: 100 }),
      sec('G4', { demand: 100 }),
      sec('G5', { seats: 0, demand: 100 }),
    ],
  };
  const bids = new Map([['G1', 1500], ['G2', 1500], ['G3', 3000], ['G4', 1000], ['G5', 1500]]);

  it('lists every other section and never the one you hold', () => {
    expect(swapOptions(course, 'G1', bids).map((x) => x.section)).toEqual(['G2', 'G3', 'G4', 'G5']);
  });

  it('labels a pricier section Unlikely, a cheaper one Likely, the same price Possible, unknown seats unknown', () => {
    const by = Object.fromEntries(swapOptions(course, 'G1', bids).map((x) => [x.section, x]));
    expect(by.G3.label).toBe('unlikely');
    expect(by.G4.label).toBe('likely');
    expect(by.G2.label).toBe('possible');
    expect(by.G2.chance!).toBeGreaterThanOrEqual(0.6);
    expect(by.G2.chance!).toBeLessThanOrEqual(0.7);
    expect(by.G5).toMatchObject({ label: 'unknown', chance: null, chanceLow: null, chanceHigh: null });
    expect(by.G3.desirability).toBeGreaterThan(by.G4.desirability);
    expect(by.G2.sampleSize).toBe(6);
    expect(by.G2.fallback).toBe(false);
    expect(by.G2.preAssigned).toBe(false);
  });

  it('is monotone in the price of the target section: chance never rises, label never improves', () => {
    const rank: Record<SwapLabel, number> = { likely: 0, possible: 1, unlikely: 2, unknown: 3 };
    let prev: { c: number; rank: number } = { c: 2, rank: -1 };
    for (const b of [600, 900, 1100, 1300, 1500, 1800, 2200, 3000, 6000]) {
      const c = { sectionsNow: [sec('G1', { demand: 100 }), sec('G2', { demand: 100 }), sec('G3', { demand: 100 })] };
      const o = swapOptions(c, 'G1', new Map([['G1', 1500], ['G2', b], ['G3', 1500]])).find((x) => x.section === 'G2')!;
      expect(o.chance!).toBeLessThanOrEqual(prev.c + 1e-12);
      expect(rank[o.label]).toBeGreaterThanOrEqual(prev.rank);
      prev = { c: o.chance!, rank: rank[o.label] };
    }
    expect(prev.rank).toBe(2);
  });

  it('at the same bid, the busier section is the less likely target', () => {
    const c = { sectionsNow: [sec('G1', { demand: 100 }), sec('G2', { demand: 40 }), sec('G3', { demand: 400 })] };
    const by = Object.fromEntries(swapOptions(c, 'G1', new Map([['G1', 1000], ['G2', 1000], ['G3', 1000]])).map((x) => [x.section, x]));
    expect(by.G3.chance!).toBeLessThan(by.G2.chance!);
  });

  it('a section with far fewer holders is harder to swap into', () => {
    const c = { sectionsNow: [sec('G1', { demand: 100 }), sec('G2', { demand: 100, seats: 45 }), sec('G3', { demand: 100, seats: 8 })] };
    const by = Object.fromEntries(swapOptions(c, 'G1', new Map([['G1', 1500], ['G2', 1500], ['G3', 1500]])).map((x) => [x.section, x]));
    expect(by.G3.chance!).toBeLessThan(by.G2.chance!);
  });

  it('returns nothing for an unknown section and all unknown when your own seats are unknown', () => {
    expect(swapOptions(course, 'ZZ', bids)).toEqual([]);
    expect(swapOptions(course, 'G5', bids).every((x) => x.label === 'unknown')).toBe(true);
  });

  it('flags the fallback path in the result', () => {
    const c = {
      sectionsNow: [sec('G1', { instructor: 'PROF X' }), sec('G2', { instructor: 'PROF Y' })],
      history: [hist('2024-25 Term 1', 'A', 'PROF X', 3000), hist('2024-25 Term 1', 'B', 'PROF Y', 1000)],
    };
    const [o] = swapOptions(c, 'G1');
    expect(o.fallback).toBe(true);
    expect(o.sampleSize).toBe(1);
    expect(o.label).toBe('likely'); // G2 was cheaper than G1 last term
  });
});

describe('real course smoke tests', () => {
  const load = (code: string) => JSON.parse(readFileSync(`src/data/real/courses/${code}.json`, 'utf8')) as CourseData;

  it('MGMT102 from G9 (a cheap section): the much pricier sections are Unlikely, the same-priced ones are not', () => {
    const course = load('MGMT102');
    expect(isPreAssigned(course.history)).toBe(false);
    const bids = new Map<string, number>();
    for (const s of course.sectionsNow) {
      const f = s.forecast![SWAP_WINDOW];
      bids.set(s.section, simulate({ seats: holdersOf(s), group: 1, minBidCents: s.minBidCents!, params: toSimParams(f), runs: SWAP_RUNS, seed: FORECAST_SEED }).percentilesCents.p50);
    }
    const opts = swapOptions(course, 'G9', bids);
    expect(opts).toHaveLength(course.sectionsNow.length - 1);
    for (const o of opts) {
      expect(o.fallback).toBe(false);
      expect(o.chanceLow!).toBeLessThanOrEqual(o.chanceHigh!);
      const ratio = bids.get(o.section)! / bids.get('G9')!;
      if (ratio > 1.5) expect(o.label).toBe('unlikely');
      if (ratio < 1.1) expect(o.label).not.toBe('unlikely');
    }
    expect(opts.filter((o) => o.label === 'unlikely').length).toBeGreaterThan(3);
  }, 60_000); // 18 sims; slow when the machine is busy

  it('COR2100 is pre-assigned: no simulated bids needed, a spread of labels, holders below seats', () => {
    for (const code of ['COR1100', 'COR2100', 'COR3001']) expect(isPreAssigned(load(code).history)).toBe(true);
    const course = load('COR2100');
    const opts = swapOptions(course, 'G1');
    expect(opts).toHaveLength(course.sectionsNow.length - 1);
    expect(opts.every((o) => o.preAssigned && !o.fallback && o.chance !== null)).toBe(true);
    expect(new Set(opts.map((o) => o.label)).size).toBe(3);
    const g1 = course.sectionsNow.find((s) => s.section === 'G1')!;
    expect(holdersIn(g1, course.history, true)).toBeLessThan(holdersOf(g1));
  });
});
