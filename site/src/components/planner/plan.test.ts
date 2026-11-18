import { describe, expect, it, vi } from 'vitest';
import type { Section } from '../../lib/data/types';
import { orderSections } from '../course/sections';
import { getBalanceText, setBalanceText } from '../../lib/state';
import { pInAt, recommendBid, simulate } from '../../lib/sim';
import { FORECAST_RUNS, FORECAST_SEED, toSimParams } from '../../lib/sim/forecast';
import type { PlanItem } from '../../lib/sim/planner';
import {
  BALANCE_EMPTY_MARK, DEFAULT_BALANCE_CENTS, balanceFromCents, balanceFromStored, blockedMustGets, blockedText, blurBalance, decodePlan, defaultSection, duplicateCourses, freeLetter, MAX_BALANCE_CENTS, overBalance, parseBalance, restoreBalance, typeBalance,
  biddableItems, bidSummary, bidsAtTarget, chanceOfAll, clampToRecommended, snapTarget, samePlan, dropToFit, encodeShare, decodeShare,
  isCapped, oneBidPerCourse, withSkipped, groupLimitNote, needSaver, needSentence, balanceLabel, courseLabel, chanceTint, findClashes, clashText, clashLines, clashSummary, rowIssue, sectionLabel, sectionOption, slotsOf, startTimesOf, hiddenSections, toPlanSimInput, typicalNeedCents,
  canStartGroup, chanceOfGroup, inOptimisation, changeRole, joinableRows, moveToGroup, newGroupLetter, planParts, whereNow,
} from './plan';

// These tests pin today's 80 / 90 / 95% mode whatever the shipped data says; the calibrated twins are in *.calibrated.test.ts.
vi.mock('../../lib/data/bidLevels', () => ({ bidLevels: () => null, bidWindowData: () => null }));


const W = 'Round 1A Window 3';
const params = { demandMean: 20, demandDispersion: 5, priceLevelCents: 2000, priceSigma: 0.4, anchorSigma: 0.2, anchorShare: 0.2, anchorCents: 1000 };
const sec = (over: Partial<Section> = {}): Section => ({
  id: '1', section: 'G1', classNumber: '1', instructor: 'A B', meetings: [{ day: 'MON', start: '08:15', end: '11:30', venue: '' }],
  startDate: '', endDate: '', tba: false, hasClassDetails: true, seatsTotal: 40, seatsLeft: 12, latestWindow: '', enrolled: 28,
  minBidCents: 1000, forecast: { [W]: { ...params, pooledLevel: 'course', nObs: 9 } }, ...over,
});

describe('toPlanSimInput', () => {
  it('maps seats left, min bid and the window parameters', () => {
    const i = toPlanSimInput(sec(), W, 2)!;
    expect(i.seats).toBe(12);
    expect(i.group).toBe(2);
    expect(i.minBidCents).toBe(1000);
    expect(i.params).toEqual(params);
  });
  it('uses live seats over the last window when present', () => {
    const live = (available: number, source: 'live' | 'approx' = 'live') => ({ available, total: 40, source, capturedAt: '2026-11-07T09:42:39+08:00', window: W });
    expect(rowIssue(sec({ seatsLeft: 12, live: live(0) }), W, 1)).toBe('full');
    expect(rowIssue(sec({ seatsLeft: 0, live: live(5) }), W, 1)).toBeNull();
    expect(toPlanSimInput(sec({ seatsLeft: 12, live: live(3) }), W, 1)?.seats).toBe(3);
    expect(sectionLabel(sec({ live: live(4, 'approx') }))).toContain('≈4 left');
  });
  it('treats an estimated zero as likely full, not a hard full', () => {
    const est = { available: 0, total: 40, source: 'approx' as const, capturedAt: '2026-11-07T09:42:39+08:00', window: W };
    expect(rowIssue(sec({ live: est }), W, 1)).toBe('estfull');
    expect(toPlanSimInput(sec({ live: est }), W, 1)).toBeNull();
    expect(sectionOption(sec({ live: est }))).toContain('(likely full, est.)');
    expect(sectionLabel(sec({ live: est }))).toContain('(likely full, est.)');
    expect(rowIssue(sec({ live: { ...est, source: 'live' } }), W, 1)).toBe('full');
  });
  it('refuses rows it cannot simulate', () => {
    expect(rowIssue(sec({ seatsLeft: 0 }), W, 1)).toBe('full');
    expect(rowIssue(sec(), 'Round 2 Window 1', 1)).toBe('nofc');
    expect(rowIssue(sec({ minBidCents: undefined }), W, 1)).toBe('nofc');
    expect(rowIssue(sec({ seatsLeft: 2 }), W, 3)).toBe('group');
    expect(toPlanSimInput(sec({ seatsLeft: 0 }), W, 1)).toBeNull();
    expect(rowIssue(sec(), W, 1)).toBeNull();
  });
});

describe('startTimesOf', () => {
  it('lists the distinct start times, sorted, skipping TBA meetings', () => {
    const at = (start: string | null) => sec({ meetings: [{ day: start ? 'MON' : 'TBA', start: start as string, end: '', venue: '' }] });
    expect(startTimesOf([at('19:00'), at('08:15'), at('19:00'), at('8:15'), at(null), at('12:00')])).toEqual(['08:15', '12:00', '19:00']);
  });
});

describe('hiddenSections', () => {
  const tue = sec({ id: '2', meetings: [{ day: 'TUE', start: '08:15', end: '11:30', venue: '' }] });
  it('counts blocked sections but never the chosen one', () => {
    const all = [sec(), tue, sec({ id: '3' })];
    expect(hiddenSections(all, '9', [])).toBe(0);
    expect(hiddenSections(all, '9', ['Mon-08:15'])).toBe(2);
    expect(hiddenSections(all, '1', ['Mon-08:15'])).toBe(1);
  });
});

describe('parseBalance', () => {
  it('reads decimals and currency marks', () => {
    expect(parseBalance('125')).toBe(12500);
    expect(parseBalance('125.5')).toBe(12550);
    expect(parseBalance(' e$98.07 ')).toBe(9807);
    expect(parseBalance('$1,000.00')).toBe(100000);
    expect(parseBalance('0')).toBe(0);
    expect(parseBalance('7.')).toBe(700);
  });
  it('rejects junk, negatives, 3 decimals and absurd amounts', () => {
    for (const t of ['', 'abc', '-5', '1.234', '1e3', '12 5']) expect(parseBalance(t)).toBeNull();
    expect(parseBalance(String(MAX_BALANCE_CENTS / 100 + 1))).toBeNull();
    expect(parseBalance(String(MAX_BALANCE_CENTS / 100))).toBe(MAX_BALANCE_CENTS);
  });
});

describe('typicalNeedCents / overBalance', () => {
  const item = (key: string, p50: number, role: PlanItem['role'], g?: string): PlanItem => {
    const curve = simulate({ seats: 5, group: 1, minBidCents: 1000, params: { ...params, priceLevelCents: p50 }, runs: 3000, seed: 1 });
    return { key, courseCode: key, role, oneOfGroup: g, curve };
  };
  it('adds required, takes the cheapest of each one-of group, ignores optional', () => {
    const a = item('a', 3000, 'required');
    const b = item('b', 2000, 'oneOf', 'A');
    const c = item('c', 4000, 'oneOf', 'A');
    const d = item('d', 5000, 'optional');
    const need = typicalNeedCents([a, b, c, d]);
    expect(need).toBe(a.curve.percentilesCents.p50 + Math.min(b.curve.percentilesCents.p50, c.curve.percentilesCents.p50));
    expect(overBalance(need, need - 1)).toBe(true);
    expect(overBalance(need, need)).toBe(false);
  });
});

describe('sections', () => {
  it('labels and slots', () => {
    expect(sectionLabel(sec())).toBe('G1 · Mon 08:15–11:30 · A B · 12 left');
    expect(sectionLabel(sec({ seatsLeft: 0 }))).toContain('(full)');
    expect(sectionOption(sec({ instructor: '' }))).toBe('G1 · Mon 08:15–11:30');
    expect(sectionOption(sec({ instructor: '', meetings: [] }))).toBe('G1 · Time not set');
    expect(sectionOption(sec({ instructor: '', seatsLeft: 0 }))).toContain('(full)');
    expect(sectionOption(sec())).toBe('G1 · Mon 08:15–11:30 · A B');
    expect(sectionOption(sec({ instructor: 'LEE KOK THONG', seatsLeft: 0 }))).toBe('G1 · Mon 08:15–11:30 · Lee Kok Thong · (full)');
    expect(slotsOf(sec())).toEqual(['Mon-08:15']);
    expect(slotsOf(sec({ meetings: [] }))).toEqual([]);
  });
  it('default section skips taken, full and avoided ones', () => {
    const list = [sec({ id: '1' }), sec({ id: '2', seatsLeft: 0 }), sec({ id: '3', meetings: [{ day: 'TUE', start: '13:00', end: '15:00', venue: '' }] })];
    expect(defaultSection(list, ['1'], [])?.id).toBe('3');
    expect(defaultSection(list, [], ['Mon-08:15'])?.id).toBe('3');
    expect(defaultSection(list, ['1', '3'], [])?.id).toBe('2');
  });
  it('picks a free one-of letter', () => {
    expect(freeLetter([{ role: 'oneOf', oneOf: 'A' }, { role: 'required', oneOf: 'B' }])).toBe('B');
  });
});

describe('decodePlan', () => {
  it('rejects non-plans and sanitises fields', () => {
    expect(decodePlan(null)).toBeNull();
    expect(decodePlan('x')).toBeNull();
    const p = decodePlan({ b: -5, s: 3, a: ['Mon-morning', 'Mon-08:15', 'Tue-19:00', 'Sun-08:15', 'Mon-25:00', 4], r: [{ c: 'ACCT101', i: '1', g: 99, o: 'weird' }, { c: 1 }, null] })!;
    expect(p.b).toBe(0);
    expect(p.s).toBe(1);
    // Old time-of-day slots, other days and impossible times are dropped.
    expect(p.a).toEqual(['Mon-08:15', 'Tue-19:00']);
    expect(p.r).toEqual([{ c: 'ACCT101', i: '1', g: 6, o: 'required', l: 'A' }]);
    expect(decodePlan({}) !.b).toBeNull();
  });
});

describe('duplicateCourses', () => {
  it('flags a repeated course unless the rows are alternatives in one group', () => {
    const r = (course: string, role: 'required' | 'oneOf', oneOf = 'A') => ({ course, role, oneOf });
    expect(duplicateCourses([r('X', 'oneOf'), r('X', 'oneOf'), r('Y', 'required')])).toEqual([]);
    expect(duplicateCourses([r('X', 'oneOf'), r('X', 'oneOf', 'B')])).toEqual(['X']);
    expect(duplicateCourses([r('X', 'required'), r('X', 'oneOf')])).toEqual(['X']);
  });
});

describe('balance field state', () => {
  it('a plain field is empty and takes a saved balance while untouched', () => {
    const s = balanceFromCents(null);
    expect(s).toMatchObject({ text: '', cents: null, bad: false });
    expect(restoreBalance(s, 8000).cents).toBe(8000);
    expect(restoreBalance(s, null).cents).toBeNull();
  });
  it('never overwrites what the student typed', () => {
    let s = typeBalance(balanceFromCents(null), '60.25');
    expect(s.cents).toBe(6025);
    s = restoreBalance(s, 12500);
    expect(s.cents).toBe(6025);
    expect(s.text).toBe('60.25');
  });
  it('clears the balance when the field is emptied', () => {
    const s = typeBalance(balanceFromCents(6025), '  ');
    expect(s).toMatchObject({ cents: null, bad: false, edited: true });
    expect(blurBalance(s).text).toBe('');
  });
  it('keeps the last valid amount while the text is invalid, and shows it on blur', () => {
    let s = typeBalance(balanceFromCents(null), '60.25');
    s = typeBalance(s, '60.2x');
    expect(s.bad).toBe(true);
    expect(s.cents).toBe(6025);
    s = blurBalance(s);
    expect(s).toMatchObject({ text: '60.25', bad: false, cents: 6025 });
  });
});

describe('starting balance', () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const reload = () => balanceFromStored(getBalanceText());
  it('nothing stored: e$125, not yet edited', () => {
    expect(DEFAULT_BALANCE_CENTS).toBe(12500);
    expect(balanceFromStored(null)).toMatchObject({ text: '125.00', cents: 12500, bad: false, edited: false });
  });
  it('a stored number wins, in any form it was typed', () => {
    expect(balanceFromStored('80').cents).toBe(8000);
    expect(balanceFromStored('60.25').cents).toBe(6025);
    expect(balanceFromStored('e$99').cents).toBe(9900);
  });
  it('the empty mark is an empty field; unreadable text falls back to the default', () => {
    expect(balanceFromStored(BALANCE_EMPTY_MARK)).toMatchObject({ text: '', cents: null, bad: false });
    expect(balanceFromStored('abc').cents).toBe(12500);
    expect(balanceFromStored('99999999').cents).toBe(12500);
  });
  it('clearing the field is stored as the empty mark and survives a reload; typing again replaces it', () => {
    vi.stubGlobal('localStorage', ls);
    try {
      store.clear();
      expect(reload().cents).toBe(12500);
      setBalanceText('60');
      expect(reload().cents).toBe(6000);
      setBalanceText('  ');
      expect(getBalanceText()).toBe(BALANCE_EMPTY_MARK);
      expect(reload()).toMatchObject({ cents: null, text: '' });
      setBalanceText('125');
      expect(reload().cents).toBe(12500);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Must get rows with no seats', () => {
  const row = (role: 'required' | 'oneOf' | 'optional', issue: 'full' | 'estfull' | 'nofc' | 'group' | null, label = 'IS215 G1') => ({ role, issue, label });
  it('a full Must get blocks the plan', () => {
    expect(blockedMustGets([row('required', 'full'), row('required', null, 'IS216 G2')])).toEqual(['IS215 G1']);
  });
  it('other issues on a Must get do not block', () => {
    expect(blockedMustGets([row('required', 'estfull'), row('required', 'nofc'), row('required', 'group')])).toEqual([]);
  });
  it('a full Pick one or Nice to have does not block', () => {
    expect(blockedMustGets([row('oneOf', 'full'), row('optional', 'full')])).toEqual([]);
  });
  it('lists every full Must get, in order', () => {
    expect(blockedMustGets([row('required', 'full', 'IS215 G1'), row('optional', 'full', 'X 1'), row('required', 'full', 'IS216 G2')])).toEqual(['IS215 G1', 'IS216 G2']);
  });
  it('the notice names each section', () => {
    expect(blockedText(['IS215 G1'])).toBe('IS215 G1 has no seats left');
    expect(blockedText(['IS215 G1', 'IS216 G2'])).toBe('IS215 G1 has no seats left, IS216 G2 has no seats left');
  });
});

describe('orderSections', () => {
  it('puts sections with seats first, in natural order', () => {
    const mk = (section: string, seatsLeft: number) => ({ section, seatsLeft });
    const out = orderSections([mk('G10', 3), mk('G2', 0), mk('G1', 0), mk('G9', 1)]).map((x) => x.section);
    expect(out).toEqual(['G9', 'G10', 'G1', 'G2']);
  });
});

describe('chance you want', () => {
  it('snaps any stored value to the closest of 80, 90 and 95%', () => {
    expect(snapTarget(0.2)).toBe(0.8);
    expect(snapTarget(0.6)).toBe(0.8);
    expect(snapTarget(0.9)).toBe(0.9);
    expect(snapTarget(0.93)).toBe(0.95);
    expect(snapTarget(1)).toBe(0.95);
  });
});

describe('same numbers as the course page', () => {
  const s = sec();
  const course = simulate({ seats: s.seatsLeft, group: 2, minBidCents: s.minBidCents!, params: toSimParams(s.forecast![W]), runs: FORECAST_RUNS, seed: FORECAST_SEED });
  const item = (key: string, role: PlanItem['role'], oneOfGroup?: string): PlanItem => ({ key, courseCode: key, role, oneOfGroup, curve: simulate(toPlanSimInput(s, W, 2)!) });
  it('plans a section with the course page run, so bid and chance match', () => {
    const r = bidsAtTarget([item('a', 'required')], 0.9, 12500);
    const bid = recommendBid(course, 0.9);
    expect(r.bids.a).toBe(bid);
    expect(r.p.a).toBe(pInAt(course, bid));
    expect(r.pAll).toBe(r.p.a);
  });
  it('combines chances: Must gets multiply, a Pick one group needs just one, Nice to have is ignored', () => {
    const its = [item('a', 'required'), item('b', 'oneOf', 'A'), item('c', 'oneOf', 'A'), item('d', 'optional')];
    expect(chanceOfAll(its, [0.9, 0.5, 0.5, 0.1])).toBeCloseTo(0.9 * 0.75, 10);
  });
  it('clamps an optimiser answer to the recommended bids and keeps the total inside the balance', () => {
    const its = [item('a', 'required'), item('b', 'required')];
    const full = recommendBid(its[0].curve, 0.9);
    const fit = { bids: { a: full + 500, b: 0 }, p: { a: 0.99, b: 0 }, pAll: 0, spentCents: 0, bidTotalCents: 0, leftCents: 0 };
    const r = clampToRecommended(its, fit, 0.9, 12500);
    expect(r.bids.a).toBe(full);
    expect(r.p.a).toBe(pInAt(its[0].curve, full));
    expect(r.bids.b).toBe(0);
    expect(r.bidTotalCents).toBe(full);
    expect(r.pAll).toBe(0);
  });
});

describe('bidSummary', () => {
  it('measures left against all bids (pay-as-bid), and bar shares add to 1 inside the balance', () => {
    const s = bidSummary(5131, 3610, 6500);
    expect(s).toMatchObject({ bidCents: 5131, likelyCents: 3610, leftCents: 1369 });
    expect(s.share.likely + s.share.rest + s.share.left).toBeCloseTo(1, 10);
  });
  it('never lets likely spend exceed the bids, and handles a zero balance', () => {
    expect(bidSummary(1000, 1500, 5000).likelyCents).toBe(1000);
    const z = bidSummary(0, 0, 0);
    expect(z.leftCents).toBe(0);
    expect(z.share).toEqual({ likely: 0, rest: 0, left: 0 });
  });
});

describe('biddableItems', () => {
  const mk = (role: PlanItem['role']) => ({ role });
  it('drops Nice to have rows only when over balance', () => {
    const list = [mk('required'), mk('oneOf'), mk('optional')];
    expect(biddableItems(list, true).map((x) => x.role)).toEqual(['required', 'oneOf']);
    expect(biddableItems(list, false)).toHaveLength(3);
  });
});

describe('samePlan', () => {
  const base = { b: 6500, s: 0.6, w: '', a: [], r: [{ c: 'ACCT101', i: '1', g: 1, o: 'required' as const, l: 'A' }] };
  it('is equal for identical content and different when anything changes', () => {
    expect(samePlan(base, JSON.parse(JSON.stringify(base)))).toBe(true);
    expect(samePlan(base, { ...base, b: 6600 })).toBe(false);
    expect(samePlan(base, { ...base, r: [{ ...base.r[0], i: '2' }] })).toBe(false);
    expect(samePlan(base, { ...base, a: ['Mon-08:15'] })).toBe(false);
  });
});

describe('Pick one groups', () => {
  type R = { id: string; course: string; role: 'required' | 'oneOf' | 'optional'; oneOf: string };
  const r = (id: string, role: R['role'], oneOf = 'A', course = id): R => ({ id, course, role, oneOf });
  const four = [r('a', 'oneOf', 'A'), r('b', 'oneOf', 'B'), r('c', 'oneOf', 'C'), r('d', 'oneOf', 'D')];

  it('newGroupLetter gives the first free letter and ignores the row\'s own letter', () => {
    expect(newGroupLetter([r('x', 'required'), r('y', 'oneOf', 'A'), r('z', 'oneOf', 'C')], 'x')).toBe('B');
    expect(newGroupLetter([r('x', 'oneOf', 'A'), r('y', 'oneOf', 'B')], 'x')).toBe('A');
    expect(newGroupLetter([r('x', 'required'), ...four], 'x')).toBeNull();
  });

  it('canStartGroup is false only at the cap for a row that is not in a group', () => {
    expect(canStartGroup([r('x', 'required'), r('y', 'oneOf', 'A')], 'x')).toBe(true);
    expect(canStartGroup([r('x', 'required'), ...four], 'x')).toBe(false);
    expect(canStartGroup([r('x', 'oneOf', 'A'), ...four.slice(1)], 'x')).toBe(true);
  });

  it('changeRole starts a new group, is refused at the cap, and keeps the letter otherwise', () => {
    expect(changeRole([r('x', 'required'), r('y', 'oneOf', 'A')], 'x', 'oneOf')).toEqual({ role: 'oneOf', oneOf: 'B' });
    expect(changeRole([r('x', 'required'), ...four], 'x', 'oneOf')).toBeNull();
    expect(changeRole([r('x', 'oneOf', 'C'), r('y', 'oneOf', 'A')], 'x', 'oneOf')).toEqual({ role: 'oneOf', oneOf: 'C' });
    expect(changeRole([r('x', 'oneOf', 'C')], 'x', 'optional')).toEqual({ role: 'optional', oneOf: 'C' });
    expect(changeRole([r('x', 'required')], 'x', 'required')).toEqual({ role: 'required', oneOf: 'A' });
    expect(changeRole([r('x', 'required')], 'nobody', 'oneOf')).toBeNull();
  });

  it('moveToGroup puts a row in the given group', () => {
    expect(moveToGroup('C')).toEqual({ role: 'oneOf', oneOf: 'C' });
  });

  it('whereNow names where a row is, and is empty for a row of that group', () => {
    expect(whereNow(r('x', 'oneOf', 'A'), 'A')).toBe('');
    expect(whereNow(r('x', 'oneOf', 'B'), 'A')).toBe('in another group');
    expect(whereNow(r('x', 'required'), 'A')).toBe('Must get');
    expect(whereNow(r('x', 'optional'), 'A')).toBe('Nice to have');
  });

  it('planParts orders Must get, groups by first member, then Nice to have; an emptied group vanishes', () => {
    const rows = [r('n', 'optional'), r('g1', 'oneOf', 'B'), r('m', 'required'), r('g2', 'oneOf', 'A'), r('g3', 'oneOf', 'B')];
    expect(planParts(rows)).toEqual({ must: [2], groups: [{ letter: 'B', idxs: [1, 4] }, { letter: 'A', idxs: [3] }], nice: [0] });
    rows[1].role = 'required';
    rows[4].role = 'optional';
    expect(planParts(rows).groups.map((g) => g.letter)).toEqual(['A']);
  });

  it('joinableRows lists each other course once, in plan order, and skips courses wholly in the group', () => {
    const rows = [r('a1', 'oneOf', 'A', 'X'), r('a2', 'oneOf', 'A', 'X'), r('y1', 'required', 'A', 'Y'), r('y2', 'oneOf', 'B', 'Y'), r('z', 'optional', 'A', 'Z')];
    expect(joinableRows(rows, 'A').map((x) => x.id)).toEqual(['y1', 'z']);
    expect(joinableRows(rows, 'B').map((x) => x.id)).toEqual(['a1', 'y1', 'z']);
  });

  it('chanceOfGroup is the chance of at least one member, and null for a letter with no member', () => {
    const it = (role: PlanItem['role'], g?: string) => ({ role, oneOfGroup: g });
    expect(chanceOfGroup([it('required'), it('oneOf', 'A')], [0.1, 0.4], 'A')).toBeCloseTo(0.4, 10);
    expect(chanceOfGroup([it('oneOf', 'A'), it('oneOf', 'A'), it('oneOf', 'B')], [0.5, 0.4, 0.9], 'A')).toBeCloseTo(1 - 0.5 * 0.6, 10);
    expect(chanceOfGroup([it('oneOf', 'A')], [0.5], 'B')).toBeNull();
    const only = [it('oneOf', 'C'), it('oneOf', 'C')];
    expect(chanceOfGroup(only, [0.3, 0.6], 'C')).toBeCloseTo(chanceOfAll(only, [0.3, 0.6]), 10);
  });
});

describe('dropToFit', () => {
  const item = (key: string, p50: number, role: PlanItem['role']): PlanItem => ({
    key, courseCode: key, role, curve: simulate({ seats: 5, group: 1, minBidCents: 1000, params: { ...params, priceLevelCents: p50 }, runs: 3000, seed: 1 }),
  });
  it('picks the most expensive Must-get course, and nothing when one drop is not enough', () => {
    const a = item('a', 3000, 'required');
    const b = item('b', 6000, 'required');
    const nice = item('n', 9000, 'optional');
    const need = typicalNeedCents([a, b]);
    const aNeed = typicalNeedCents([a]);
    expect(dropToFit([a, b, nice], aNeed)).toEqual({ key: 'b', courseCode: 'b' });
    expect(need).toBeGreaterThan(aNeed);
    expect(dropToFit([a, b, nice], 0)).toBeNull();
  });
});

describe('share link', () => {
  const plan = { b: 6500, s: 0.6, w: '', a: [], r: [{ c: 'ACCT101', i: '1', g: 1, o: 'required' as const, l: 'A' }] };
  it('round-trips a #share= plan and ignores every other hash', () => {
    expect(decodeShare(encodeShare(plan))).toEqual(plan);
    expect(decodeShare('#' + btoa(JSON.stringify(plan)))).toBeNull();
    expect(decodeShare('#share=%%%')).toBeNull();
    expect(decodeShare('')).toBeNull();
  });
  it('keeps e$125 and an empty balance as they are, in new and old links', () => {
    for (const b of [12500, null, 9000]) {
      expect(decodeShare(encodeShare({ ...plan, b }))?.b).toBe(b);
      expect(decodeShare('#share=' + btoa(JSON.stringify({ ...plan, b })))?.b).toBe(b);
    }
  });
});

describe('skipped Pick one options', () => {
  const mk = (key: string, role: PlanItem['role'], g?: string): PlanItem => ({
    key, courseCode: key, role, oneOfGroup: g,
    curve: simulate({ seats: 12, group: 1, minBidCents: 1000, params, runs: 3000, seed: 1 }),
  });
  it('counts e$0 for a skipped option: the total is only the rows that are bid, and a skipped row is never "capped"', () => {
    const items = [mk('must', 'required'), mk('a', 'oneOf', 'A'), mk('b', 'oneOf', 'A')];
    const full = recommendBid(items[0].curve, 0.9);
    const fit = { bids: { must: full, a: full, b: 0 }, p: { must: 0.9, a: 0.9, b: 0 }, pAll: 0, spentCents: 0, bidTotalCents: 0, leftCents: 0 };
    const r = clampToRecommended(items, fit, 0.9, full * 2 + 1);
    expect(r.bids.b).toBe(0);
    expect(r.bidTotalCents).toBe(full * 2);
    expect(r.bidTotalCents).toBeLessThanOrEqual(full * 2 + 1);
    expect(isCapped(r.bids.b, full, true)).toBe(false);
    expect(isCapped(r.bids.a, full, true)).toBe(false);
    expect(isCapped(full - 100, full, true)).toBe(true);
    expect(isCapped(full - 100, full, false)).toBe(false);
  });
});

describe('one bid per course', () => {
  const curve = (level: number) => simulate({ seats: 12, group: 1, minBidCents: 1000, params: { ...params, priceLevelCents: level }, runs: 3000, seed: 1 });
  const item = (key: string, courseCode: string, level: number): PlanItem => ({ key, courseCode, role: 'oneOf', oneOfGroup: 'A', curve: curve(level) });
  it('keeps only the cheapest recommended bid of a course; the other row bids e$0 and adds no chance', () => {
    const items = [item('x1', 'IS469', 6000), item('x2', 'IS469', 2000), item('y', 'ACCT101', 2000)];
    const { kept, skipped } = oneBidPerCourse(items, 0.9);
    expect(kept.map((i) => i.key)).toEqual(['x2', 'y']);
    expect(skipped.map((i) => i.key)).toEqual(['x1']);
    const r = withSkipped(bidsAtTarget(kept, 0.9, 12500), skipped);
    expect(r.bids.x1).toBe(0);
    expect(r.p.x1).toBe(0);
    expect(r.bidTotalCents).toBe(r.bids.x2 + r.bids.y);
    // the group chance is one section's chance, not the union of two
    const p2 = r.p.x2;
    const group = chanceOfAll([{ role: 'oneOf', oneOfGroup: 'A' }, { role: 'oneOf', oneOfGroup: 'A' }], [p2, r.p.x1]);
    expect(group).toBeCloseTo(p2, 10);
  });
  it('never lets a cheaper Nice to have row displace a Must / Pick one row of the same course', () => {
    const cheapOptional: PlanItem = { ...item('opt', 'IS469', 2000), role: 'optional', oneOfGroup: undefined };
    const required = item('req', 'IS469', 6000);
    const { kept, skipped } = oneBidPerCourse([cheapOptional, required], 0.9);
    expect(kept.map((i) => i.key)).toEqual(['req']);
    expect(skipped.map((i) => i.key)).toEqual(['opt']);
    const mustRow: PlanItem = { ...item('must', 'IS469', 6000), role: 'required', oneOfGroup: undefined };
    expect(oneBidPerCourse([cheapOptional, mustRow], 0.9).kept.map((i) => i.key)).toEqual(['must']);
  });
  it('leaves a plan of distinct courses unchanged', () => {
    const items = [item('a', 'A1', 2000), item('b', 'B1', 2000)];
    expect(oneBidPerCourse(items, 0.9)).toEqual({ kept: items, skipped: [] });
  });
});

describe('groupLimitNote', () => {
  it('says why "+" is disabled when the seats are the limit, even at group size 1', () => {
    expect(groupLimitNote(1, 1, '1 seat')).toBe('Only 1 seat left');
    expect(groupLimitNote(1, 1, 'about 1 seat')).toBe('Only about 1 seat left');
  });
  it('says nothing when there are no seats: the row already says so, and "Only 0 seats left" would be noise', () => {
    expect(groupLimitNote(0, 1, '0 seats')).toBe('');
    expect(groupLimitNote(0, 3, '0 seats')).toBe('');
    expect(groupLimitNote(-1, 1, '-1 seats')).toBe('');
  });
  it('explains the limit once the group is as big as the seats allow', () => {
    expect(groupLimitNote(2, 2, '2 seats')).toBe('Only 2 seats left');
    expect(groupLimitNote(3, 2, '3 seats')).toBe('');
    expect(groupLimitNote(2, 1, '2 seats')).toBe('');
  });
  it('mentions the usual maximum only when seats are not the limit', () => {
    expect(groupLimitNote(20, 6, '20 seats')).toBe('Max group 6');
    expect(groupLimitNote(20, 5, '20 seats')).toBe('');
  });
});

describe('needSaver', () => {
  const item = (key: string, p50: number, role: PlanItem['role'], oneOfGroup?: string): PlanItem => ({
    key, courseCode: key.toUpperCase(), role, oneOfGroup, curve: simulate({ seats: 5, group: 1, minBidCents: 1000, params: { ...params, priceLevelCents: p50 }, runs: 3000, seed: 1 }),
  });
  it('names the Must-get course that frees the most, and whether that alone fits', () => {
    const a = item('a', 3000, 'required');
    const b = item('b', 9000, 'required');
    const c = item('c', 5000, 'required');
    const need = typicalNeedCents([a, b, c]);
    const withoutB = typicalNeedCents([a, c]);
    const s = needSaver([a, b, c], withoutB)!;
    expect(s.label).toBe('B');
    expect(s.keys).toEqual(['b']);
    expect(s.freedCents).toBe(need - withoutB);
    expect(s.fits).toBe(true);
    expect(needSaver([a, b, c], withoutB - 1)!.fits).toBe(false);
  });
  it('ignores Nice to have rows and returns null when nothing is required', () => {
    expect(needSaver([item('n', 9000, 'optional')], 0)).toBeNull();
    expect(needSaver([], 0)).toBeNull();
  });
  it('names a Pick one group by its courses when the need comes only from groups', () => {
    const x = item('x', 4000, 'oneOf', 'A');
    const y = item('y', 8000, 'oneOf', 'A');
    const s = needSaver([x, y], 0)!;
    expect(s.label).toBe('X / Y');
    expect(s.keys).toEqual(['x', 'y']);
    expect(s.freedCents).toBe(typicalNeedCents([x, y]));
  });
  it('picks the group or the course that frees more', () => {
    const x = item('x', 4000, 'oneOf', 'A');
    const y = item('y', 8000, 'oneOf', 'A');
    const z = item('z', 5000, 'oneOf', 'B');
    expect(needSaver([x, y, z], 0)!.label).toBe('Z');
    const big = item('big', 20000, 'required');
    expect(needSaver([x, y, big], 0)!.label).toBe('BIG');
  });
  it('treats a pair of the same course as one name', () => {
    const g1 = item('g1', 4000, 'oneOf', 'A');
    const g2 = { ...item('g2', 6000, 'oneOf', 'A'), courseCode: 'G1' };
    expect(needSaver([g1, g2], 0)!.label).toBe('G1');
  });
});

describe('needSentence', () => {
  it('gives the typical need against the balance as numbers', () => {
    expect(needSentence([{ role: 'required' }], 14000, 12500)).toBe('Need about e$140.00 · balance e$125.00');
  });
});

describe('labels', () => {
  it('courseLabel lists each course once', () => {
    expect(courseLabel(['IS469', 'IS470'])).toBe('IS469 / IS470');
    expect(courseLabel(['IS469', 'IS469'])).toBe('IS469');
  });
  it('balanceLabel drops the cents of a whole balance', () => {
    expect(balanceLabel(12500)).toBe('e$125');
    expect(balanceLabel(12550)).toBe('e$125.50');
    expect(balanceLabel(0)).toBe('e$0');
  });
});

describe('chanceTint', () => {
  /** WCAG contrast of dark text on the tint. */
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgbOf = (hsl: string) => {
    const [h, sat, l] = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(hsl)!.slice(1).map(Number);
    const s = sat / 100, li = l / 100, a = s * Math.min(li, 1 - li);
    const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (li - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  };
  const contrast = (fg: number[], bg: number[]) => (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
  it('runs from red (low) to green (high), clamped', () => {
    expect(chanceTint(0)).toMatch(/^hsl\(0 /);
    expect(chanceTint(0.25)).toBe(chanceTint(0));
    expect(chanceTint(1)).toMatch(/^hsl\(125 /);
    expect(chanceTint(2)).toBe(chanceTint(1));
    const hue = (p: number) => Number(/hsl\((\d+)/.exec(chanceTint(p))![1]);
    expect(hue(0.8)).toBeLessThan(hue(0.9));
    expect(hue(0.9)).toBeLessThan(hue(0.95));
  });
  it('keeps the dark text and pure black at AAA contrast (7:1) on every tint', () => {
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const bg = rgbOf(chanceTint(p));
      expect(contrast([0x1b, 0x1d, 0x21], bg)).toBeGreaterThanOrEqual(7);
      expect(contrast([0, 0, 0], bg)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('findClashes', () => {
  const m = (day: string, start: string, end: string) => ({ day, start, end });
  const e = (id: string, meetings: ReturnType<typeof m>[], alt?: string) => ({ id, label: id.toUpperCase(), meetings, alt });
  it('flags overlapping times on the same day, naming the other section and when it meets', () => {
    const c = findClashes([e('a', [m('MON', '12:00', '15:15')]), e('b', [m('MON', '14:00', '17:00')])]);
    expect(c).toHaveLength(1);
    expect(clashText(c[0], 'a')).toBe('Clashes with B (Mon 14:00–17:00)');
    expect(clashText(c[0], 'b')).toBe('Clashes with A (Mon 12:00–15:15)');
    expect(clashLines(c, 'a')).toEqual(['Clashes with B (Mon 14:00–17:00)']);
    expect(clashLines(c, 'zzz')).toEqual([]);
    expect(clashSummary(c)).toBe('A clashes with B (Mon 14:00–17:00)');
  });
  it('touching times and different days are not clashes', () => {
    expect(findClashes([e('a', [m('MON', '09:00', '12:00')]), e('b', [m('MON', '12:00', '15:00')])])).toEqual([]);
    expect(findClashes([e('a', [m('MON', '09:00', '12:00')]), e('b', [m('TUE', '09:00', '12:00')])])).toEqual([]);
  });
  it('finds a clash on the second meeting day and one inside the other', () => {
    expect(findClashes([e('a', [m('MON', '09:00', '10:00'), m('THU', '09:00', '12:00')]), e('b', [m('THU', '10:00', '11:00')])])).toHaveLength(1);
  });
  it('skips TBA and untimed meetings', () => {
    expect(findClashes([e('a', [m('TBA', '', '')]), e('b', [m('TBA', '', '')])])).toEqual([]);
    expect(findClashes([e('a', [{ day: 'TBA', start: null, end: null } as never]), e('b', [m('MON', '09:00', '12:00')])])).toEqual([]);
    expect(findClashes([e('a', []), e('b', [m('MON', '09:00', '12:00')])])).toEqual([]);
    expect(findClashes([e('a', [m('MON', '12:00', '09:00')]), e('b', [m('MON', '09:00', '12:00')])])).toEqual([]);
  });
  it('two options of the same Pick one group may overlap, but a Pick one clashes with anything outside its group', () => {
    const a = e('a', [m('MON', '09:00', '12:00')], 'A');
    const b = e('b', [m('MON', '10:00', '11:00')], 'A');
    expect(findClashes([a, b])).toEqual([]);
    expect(findClashes([a, e('c', [m('MON', '10:00', '11:00')], 'B')])).toHaveLength(1);
    expect(findClashes([a, e('d', [m('MON', '10:00', '11:00')])])).toHaveLength(1);
  });
  it('summarises several clashes', () => {
    const c = findClashes([e('a', [m('MON', '09:00', '12:00')]), e('b', [m('MON', '10:00', '11:00')]), e('c', [m('MON', '11:00', '13:00')])]);
    expect(c).toHaveLength(2);
    expect(clashSummary(c)).toBe('2 clashes: A clashes with B (Mon 10:00–11:00); A clashes with C (Mon 11:00–13:00)');
    expect(clashSummary([])).toBe('');
  });
});

describe('decodePlan group letters', () => {
  it('puts a letter outside A-D in group A, so a shared link cannot make a fifth group', () => {
    const plan = decodePlan({ r: [{ c: 'X1', o: 'oneOf', l: 'Z' }, { c: 'X2', o: 'oneOf', l: 'B' }, { c: 'X3', o: 'oneOf' }] });
    expect(plan?.r.map((x) => x.l)).toEqual(['A', 'B', 'A']);
  });
});

describe('group rows and the optimisation', () => {
  const s = sec();
  const row = (id: string, group: number) => ({ id, group, curve: simulate(toPlanSimInput(s, W, group)!) });
  const items = (rs: { id: string; curve: ReturnType<typeof simulate> }[]): PlanItem[] => rs.map((r) => ({ key: r.id, courseCode: r.id, role: 'required', curve: r.curve }));
  it('a row for 2+ people is left out, and the others plan exactly as without it', () => {
    const rows = [row('a', 1), row('g', 3), row('b', 1)];
    expect(inOptimisation(rows).map((r) => r.id)).toEqual(['a', 'b']);
    // a balance that forces the optimiser to cut: the group row must not take any of it
    const withGroup = bidsAtTarget(items(inOptimisation(rows)), 0.9, 2500);
    const without = bidsAtTarget(items(rows.filter((r) => r.id !== 'g')), 0.9, 2500);
    expect(withGroup).toEqual(without);
    expect(Object.keys(withGroup.bids)).not.toContain('g');
  });
});
