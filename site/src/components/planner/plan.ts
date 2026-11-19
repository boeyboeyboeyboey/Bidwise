// Pure planner logic (no DOM, no worker): mapping real sections to simulator inputs, balance validation,
// and the stored-plan format. Unit tested in plan.test.ts.
import type { CourseData, Meeting, Section } from '../../lib/data/types';
import { bossCodeOf } from '../../lib/data/bossCode';
import { isLikelyFull, seatsLeftNow, seatsOf } from '../../lib/data/seats';
import type { SimInput } from '../../lib/sim';
import { pInAt } from '../../lib/sim';
import { FORECAST_RUNS, FORECAST_SEED, MAX_FRIENDS_GROUP, TARGETS, clampGroup, groupEstimatesHidden, toSimParams } from '../../lib/sim/forecast';
import { DEFAULT_TARGET, bidCalibrated, styleName, suggestBid, targetFromStored, targetToStored } from '../../lib/sim/presets';
import type { PlanItem, PlanResult, Role } from '../../lib/sim/planner';
import { dayText } from '../course/history';
import { formatSlot } from '../../lib/format/slot';
import { eS } from '../course/fmt';
import { titleName } from '../../lib/data/format';
import { GROUP_NOTICE } from '../course/bidStyle';
import { GROUP_LETTERS, isSlot, slotOf, startText, type PlanRowState } from './types';

/** Same runs and seed as the course page, so a section shows the same bid and chance on both pages. */
export const PLAN_RUNS = FORECAST_RUNS;
export const PLAN_SEED = FORECAST_SEED;
/** Upper bound for a typed balance: a typo like 1250000 should not silently run. */
export const MAX_BALANCE_CENTS = 1_000_000;

export type RowIssue = 'nofc' | 'full' | 'estfull' | 'group';

/** Why a section cannot be simulated in this window, or null when it can. */
export function rowIssue(section: Section, window: string, group: number): RowIssue | null {
  if (isLikelyFull(section)) return 'estfull';
  if (seatsLeftNow(section) <= 0) return 'full';
  if (!section.forecast?.[window] || section.minBidCents === undefined) return 'nofc';
  if (group > seatsLeftNow(section)) return 'group';
  return null;
}

/** The rows that take part in the plan's optimisation and totals: a group row (2+ people) sits out while group estimates are withheld. */
export const inOptimisation = <T extends { group: number }>(rows: readonly T[]): T[] => rows.filter((r) => !groupEstimatesHidden(r.group));

/** "A", "A and B", "A, B and C". */
export const joinNames = (names: readonly string[]): string => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export const LOADING_REASON = 'loading';
export const FAILED_REASON = "Couldn't load this course";
export const GONE_REASON = 'Section no longer offered';

/** priced: bid and chance computed. loading: not ready yet. unpriced: will not be priced (see reason). infeasible: no seats at all. */
export type ScopeState = 'priced' | 'loading' | 'unpriced' | 'infeasible';

/** What the planner knows about one selected row. */
export interface ScopeRowInput {
  name: string;
  role: Role;
  oneOf?: string;
  group: number;
  /** The course file is in. */
  courseLoaded: boolean;
  /** The course file could not be fetched. */
  failed: boolean;
  /** The chosen section exists in the course file. */
  sec: boolean;
  issue: RowIssue | null;
  /** The row's simulation is done. */
  curveReady: boolean;
}

export interface NamedReason {
  name: string;
  reason: string;
}

/** Pure. Where one row stands: the first fact that applies, hard facts (a seat issue) before the group notice. */
export function classifyRow(r: ScopeRowInput): { state: ScopeState; reason: string } {
  if (!r.courseLoaded) return r.failed ? { state: 'unpriced', reason: FAILED_REASON } : { state: 'loading', reason: LOADING_REASON };
  if (!r.sec) return { state: 'unpriced', reason: GONE_REASON };
  if (r.issue === 'full') return { state: 'infeasible', reason: ISSUE_TEXT.full };
  if (r.issue) return { state: 'unpriced', reason: ISSUE_TEXT[r.issue] };
  if (groupEstimatesHidden(r.group)) return { state: 'unpriced', reason: GROUP_NOTICE };
  if (!r.curveReady) return { state: 'loading', reason: LOADING_REASON };
  return { state: 'priced', reason: '' };
}

/** What the planner may claim about the whole plan, given which rows are priced. */
export interface PlanScope {
  /** Per selected row, in the order given. */
  rows: { name: string; state: ScopeState; reason: string }[];
  /** Rows that will not be priced (not loading, not out of seats). */
  unpriced: NamedReason[];
  /** Every row that is unpriced or still loading (reason "loading"): what the totals leave out. */
  uncounted: NamedReason[];
  /** Every row without a price, out-of-seats rows included: what a terminal message lists. */
  unpricedAll: NamedReason[];
  /** Some row is still loading or simulating. */
  loading: boolean;
  /** Number of priced rows. */
  priced: number;
  /** A Must get or Pick one row is selected (in any state). */
  hasChance: boolean;
  /** Names of rows that make the plan impossible: a Must get with no seats, or every alternative of a Pick one group with none. */
  blocked: string[];
  /** Letters of the Pick one groups whose alternatives all have no seats. */
  blockedLetters: string[];
  /** A Must get or Pick one row is unpriced or loading (and nothing blocks): no chance of the whole plan. */
  chanceWithheld: boolean;
  /** The unpriced or loading Must get / Pick one rows behind chanceWithheld. */
  chanceNames: NamedReason[];
  /** Pick one groups with an unpriced or loading alternative: their own chance is withheld too. */
  pickWithheld: string[];
  /** Same as chanceWithheld: no feasibility claims or advice that changes the balance. */
  adviceWithheld: boolean;
  /** Some selected row (any role) has no price: no "left" figure. */
  leftWithheld: boolean;
  /** Nothing is priced, nothing is loading, and the plan has rows. */
  terminal: boolean;
}

/** Pure. Classifies every selected row and says what the plan may claim. */
export function planScope(inputs: readonly ScopeRowInput[]): PlanScope {
  const rows = inputs.map((r) => ({ name: r.name, role: r.role, letter: r.oneOf ?? 'A', ...classifyRow(r) }));
  const noPrice = (x: (typeof rows)[number]) => x.state === 'unpriced' || x.state === 'loading';
  const uncounted = rows.filter(noPrice).map(({ name, reason }) => ({ name, reason }));
  const chanceRows = rows.filter((x) => x.role !== 'optional' && noPrice(x));
  const letters = [...new Set(rows.filter((x) => x.role === 'oneOf').map((x) => x.letter))];
  const blockedLetters = letters.filter((l) => rows.filter((x) => x.role === 'oneOf' && x.letter === l).every((x) => x.state === 'infeasible'));
  const blocked = rows.filter((x) => (x.role === 'required' && x.state === 'infeasible') || (x.role === 'oneOf' && blockedLetters.includes(x.letter))).map((x) => x.name);
  const loading = rows.some((x) => x.state === 'loading');
  const priced = rows.filter((x) => x.state === 'priced').length;
  const chanceWithheld = !blocked.length && chanceRows.length > 0;
  return {
    rows: rows.map(({ name, state, reason }) => ({ name, state, reason })),
    unpriced: rows.filter((x) => x.state === 'unpriced').map(({ name, reason }) => ({ name, reason })),
    uncounted,
    unpricedAll: rows.filter((x) => x.state !== 'priced').map(({ name, reason }) => ({ name, reason })),
    loading,
    priced,
    hasChance: rows.some((x) => x.role !== 'optional'),
    blocked,
    blockedLetters,
    chanceWithheld,
    chanceNames: chanceRows.map(({ name, reason }) => ({ name, reason })),
    pickWithheld: letters.filter((l) => rows.some((x) => x.role === 'oneOf' && x.letter === l && noPrice(x))),
    adviceWithheld: chanceWithheld,
    leftWithheld: uncounted.length > 0,
    terminal: rows.length > 0 && priced === 0 && !loading,
  };
}

/** "IS215 G1 (No forecast); IS216 G2 (loading)": a reason never ends in a full stop inside the brackets. */
export const reasonList = (xs: readonly NamedReason[]): string => xs.map((x) => `${x.name} (${x.reason.replace(/\.$/, '')})`).join('; ');

/** In place of the chance of all Must get while a Must get or Pick one row has no bid. */
export const chanceWithheldText = (xs: readonly NamedReason[]): string => `Not shown until every Must get and Pick one course has a bid: ${reasonList(xs)}`;
/** Under "Bids total" while rows have no price. */
export const notCountedText = (xs: readonly NamedReason[]): string => `Bids total for priced rows only. Not counted: ${reasonList(xs)}`;
/** When no row has a price at all. */
export const terminalText = (xs: readonly NamedReason[]): string => `No chance shown: ${xs.map((x) => `${x.name}: ${x.reason.replace(/\.$/, '')}`).join('; ')}`;

export const ISSUE_TEXT: Record<RowIssue, string> = {
  nofc: 'No forecast',
  full: 'No seats left',
  estfull: 'Likely full (est.)',
  group: 'Group too big',
};

/** Names of the Must get rows whose chosen section has no seats at all (Pick one and Nice to have rows never block the plan). */
export function blockedMustGets(rows: { role: Role; issue: RowIssue | null; label: string }[]): string[] {
  return rows.filter((r) => r.role === 'required' && r.issue === 'full').map((r) => r.label);
}

/** One line for the plan notice, e.g. "IS215 G1 has no seats left". */
export const blockedText = (labels: string[]): string => labels.map((l) => `${l} has ${ISSUE_TEXT.full.toLowerCase()}`).join(', ');

/** Simulator input for one row: seats = seats left now, forecast parameters of the chosen window. */
export function toPlanSimInput(section: Section, window: string, group: number): SimInput | null {
  if (rowIssue(section, window, group)) return null;
  return {
    seats: seatsLeftNow(section),
    group,
    minBidCents: section.minBidCents as number,
    params: toSimParams(section.forecast![window]),
    runs: PLAN_RUNS,
    seed: PLAN_SEED,
  };
}

/**
 * Balance typed by the student, in cents. Accepts "125", "125.5", "125.50", "e$125", "$125", "1,250.00".
 * Null when empty, negative, not a number, more than 2 decimals, or above MAX_BALANCE_CENTS.
 */
export function parseBalance(text: string): number | null {
  const t = text.trim().replace(/^e?\$/i, '').replace(/,/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const cents = Math.round(parseFloat(t) * 100);
  return cents <= MAX_BALANCE_CENTS ? cents : null;
}

/** What a first-time visitor starts with: one term's e$. */
export const DEFAULT_BALANCE_CENTS = 12500;
/** Stored in place of the balance when the student cleared the field on purpose; nothing stored means "never set". */
export const BALANCE_EMPTY_MARK = 'none';

export interface BalanceState {
  /** What the field shows. */
  text: string;
  /** Last valid balance, cents; null while the field is empty (no balance assumed: balances carry over between terms). */
  cents: number | null;
  /** The text is not a valid amount. */
  bad: boolean;
  /** The student typed or chose a balance: a saved plan must not replace it. */
  edited: boolean;
}

const centsText = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

export function balanceFromCents(cents: number | null, edited = false): BalanceState {
  return { text: centsText(cents), cents, bad: false, edited };
}

/**
 * The balance from its stored text. Nothing stored (null) or unreadable text: the default. The empty mark: empty on
 * purpose. Anything else: the typed amount.
 */
export function balanceFromStored(raw: string | null): BalanceState {
  if (raw === null) return balanceFromCents(DEFAULT_BALANCE_CENTS);
  if (raw.trim() === BALANCE_EMPTY_MARK) return balanceFromCents(null, true);
  const c = parseBalance(raw);
  return c === null ? balanceFromCents(DEFAULT_BALANCE_CENTS) : balanceFromCents(c, true);
}

/** The student typed in the field. Valid text updates the balance, empty text clears it, invalid text keeps the last valid one. */
export function typeBalance(s: BalanceState, text: string): BalanceState {
  if (text.trim() === '') return { text, cents: null, bad: false, edited: true };
  const c = parseBalance(text);
  return { text, cents: c ?? s.cents, bad: c === null, edited: true };
}

/** The field lost focus: show the balance in use. */
export function blurBalance(s: BalanceState): BalanceState {
  return { ...s, text: centsText(s.cents), bad: false };
}

/** A saved plan arrives (page load). It never overwrites a balance the student already entered. */
export function restoreBalance(s: BalanceState, storedCents: number | null): BalanceState {
  return s.edited ? s : balanceFromCents(storedCents);
}

/**
 * Typical e$ needed to get every required course and one section of each one-of group: sum of the median
 * cutoffs, taking the cheapest member of each group. Optional rows do not count.
 */
export function typicalNeedCents(items: PlanItem[]): number {
  let sum = 0;
  const groups = new Map<string, number>();
  for (const it of items) {
    const p50 = it.curve.percentilesCents.p50;
    if (it.role === 'required') sum += p50;
    else if (it.role === 'oneOf') {
      const g = it.oneOfGroup ?? 'A';
      groups.set(g, Math.min(groups.get(g) ?? Infinity, p50));
    }
  }
  for (const v of groups.values()) sum += v;
  return sum;
}

/** True when the typical need of the must-have courses is more than the balance. */
export const overBalance = (needCents: number, balanceCents: number): boolean => needCents > balanceCents;

/** Next free group letter (A, B, C, D) given the letters already used by one-of rows. */
export function freeLetter(rows: Pick<PlanRowState, 'role' | 'oneOf'>[]): string {
  const used = new Set(rows.filter((r) => r.role === 'oneOf').map((r) => r.oneOf));
  return GROUP_LETTERS.find((g) => !used.has(g)) ?? GROUP_LETTERS[GROUP_LETTERS.length - 1];
}

const dayShort = (d: string) => dayText(d).slice(0, 3);

/** Slots ("Mon-08:15") a section occupies: each meeting's day and start time, for the avoid-times filter. */
export function slotsOf(section: Section): string[] {
  return section.meetings.filter((m) => startText(m.start)).map((m) => slotOf(dayShort(m.day), m.start));
}

/** The distinct meeting start times of these sections ("08:15"), sorted: the rows of the can't-attend grid. */
export function startTimesOf(sections: readonly Pick<Section, 'meetings'>[]): string[] {
  const seen = new Set<string>();
  for (const s of sections) for (const m of s.meetings) if (startText(m.start)) seen.add(startText(m.start));
  return [...seen].sort();
}

/** How many sections of a course the avoid-times filter hides (the chosen one always stays). */
export function hiddenSections(sections: Section[], chosenId: string, avoid: string[]): number {
  if (!avoid.length) return 0;
  return sections.filter((s) => s.id !== chosenId && slotsOf(s).some((x) => avoid.includes(x))).length;
}

export function meetingText(section: Section): string {
  const ms = section.meetings.filter((m) => m.start);
  return ms.length ? ms.map((m) => `${dayText(m.day)} ${m.start}–${m.end}`).join(', ') : 'No time set';
}

/** One line for the section picker: section, time, instructor, seats left. */
export function sectionLabel(section: Section): string {
  return [section.section, meetingText(section), section.instructor || 'Instructor TBA', seatsLeftNow(section) > 0 ? `${seatsOf(section).source === 'approx' ? '≈' : ''}${seatsLeftNow(section)} left` : `(${isLikelyFull(section) ? 'likely full, est.' : 'full'})`].join(' · ');
}

/** Picker text: section, day and time, instructor and "(full)", e.g. "G1 · Mon 15:30–18:45 · Lee Kok Thong · (full)". */
export function sectionOption(section: Section): string {
  const full = seatsLeftNow(section) > 0 ? '' : `(${isLikelyFull(section) ? 'likely full, est.' : 'full'})`;
  return [section.section, formatSlot(section.meetings) || 'Time not set', titleName(section.instructor), full].filter(Boolean).join(' · ');
}

/**
 * Note under a row's group-size stepper, or ''. Shown whenever the "+" button is disabled because the group is as big as
 * the section allows: because of the seats left ("Only 1 seat left"), or because of the usual maximum.
 * With no seats left it is '': the row already says "No seats left", and "Only 0 seats left" would be noise.
 */
export function groupLimitNote(seatsLeft: number, group: number, seatsText: string, maxFriends: number = MAX_FRIENDS_GROUP): string {
  if (seatsLeft <= 0) return '';
  const max = Math.max(1, Math.min(maxFriends, seatsLeft));
  if (group < max) return '';
  if (seatsLeft < maxFriends) return `Only ${seatsText} left`;
  return `Max group ${maxFriends}`;
}

/** First section with seats that is not already in the plan and not in an avoided slot. */
export function defaultSection(sections: Section[], taken: string[], avoid: string[]): Section | undefined {
  const free = sections.filter((s) => !taken.includes(s.id));
  const ok = (s: Section) => seatsLeftNow(s) > 0 && !slotsOf(s).some((x) => avoid.includes(x));
  return free.find(ok) ?? free.find((s) => seatsLeftNow(s) > 0) ?? free[0] ?? sections[0];
}

export interface StoredPlan {
  /** balance, cents; null = none set */
  b: number | null;
  /** chance you want: 0..1 (not calibrated), or a preset key 'cheap' | 'balanced' | 'safe' (calibrated; an old number there reads as the default) */
  s: number | string;
  /** window label ('' = current) */
  w: string;
  /** avoided slots ("Mon-08:15"); old "Mon-morning" entries are dropped on decode */
  a: string[];
  /** rows: course, section id, group size, role, one-of group letter */
  r: { c: string; i: string; g: number; o: Role; l: string }[];
}

/** The stored chance: a preset key when calibrated (a number is an old save: default), else a number 0..1. */
function decodeTarget(v: unknown): number | string {
  if (bidCalibrated()) return typeof v === 'string' && targetFromStored(v, -1) !== -1 ? v : targetToStored(DEFAULT_TARGET);
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_TARGET;
}

/** Validates anything read from the URL hash or localStorage; null when it is not a plan. */
export function decodePlan(raw: unknown): StoredPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const st = raw as Record<string, unknown>;
  const b = typeof st.b === 'number' && Number.isFinite(st.b) ? Math.min(MAX_BALANCE_CENTS, Math.max(0, Math.round(st.b))) : null;
  const s = decodeTarget(st.s);
  const w = typeof st.w === 'string' ? st.w : '';
  const a = Array.isArray(st.a) ? st.a.filter((x): x is string => typeof x === 'string' && isSlot(x)) : [];
  const r: StoredPlan['r'] = [];
  if (Array.isArray(st.r)) {
    for (const x of st.r.slice(0, 20)) {
      if (!x || typeof x !== 'object' || typeof x.c !== 'string' || !x.c) continue;
      r.push({
        c: x.c,
        i: typeof x.i === 'string' ? x.i : '',
        g: typeof x.g === 'number' ? clampGroup(x.g) : 1,
        o: x.o === 'oneOf' || x.o === 'optional' ? x.o : 'required',
        l: GROUP_LETTERS.some((g) => g === x.l) ? x.l : 'A',
      });
    }
  }
  return { b, s, w, a, r };
}

/**
 * Courses that appear in more than one row without being alternatives of each other. You can only take
 * one section of a course, so those rows must be "one of" in the same group. Split sites of one BOSS course
 * (COR-STAT1202 and COR-STAT1202-X) count as one course; such a group is named by all its site codes.
 */
export function duplicateCourses(rows: Pick<PlanRowState, 'course' | 'role' | 'oneOf'>[], bossOf: (course: string) => string = bossCodeOf): string[] {
  const by = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = bossOf(r.course);
    by.set(k, [...(by.get(k) ?? []), r]);
  }
  const out: string[] = [];
  for (const rs of by.values()) {
    if (rs.length < 2) continue;
    const alt = rs.every((r) => r.role === 'oneOf' && r.oneOf === rs[0].oneOf);
    if (!alt) out.push(courseLabel(rs.map((r) => r.course)));
  }
  return out;
}

/** Rows of `code` whose section is not in its own course file but is in the split sibling's (an old link or saved plan from before the split): they belong to the sibling. */
export function rowsInSibling<T extends { course: string; sectionId: string }>(
  rows: readonly T[], code: string, own: Pick<CourseData, 'sectionsNow'>, sibling: Pick<CourseData, 'sectionsNow'>,
): T[] {
  return rows.filter((r) => r.course === code && !own.sectionsNow.some((s) => s.id === r.sectionId) && sibling.sectionsNow.some((s) => s.id === r.sectionId));
}

/** Chance the student wants, same choices and default as the course page. */
export { DEFAULT_TARGET };

/** The chance option a stored value belongs to: the closest of 80/90/95%. Old plans stored other numbers. With calibrated presets only a preset key counts; any number (an old save) becomes the default. */
export function snapTarget(s: unknown): number {
  if (bidCalibrated()) return targetFromStored(s);
  if (typeof s !== 'number' || !Number.isFinite(s)) return DEFAULT_TARGET;
  let best: number = TARGETS[0];
  for (const t of TARGETS) if (Math.abs(t - s) < Math.abs(best - s)) best = t;
  return best;
}

/** Chance that all Must get rows and one row of every Pick one group win, from each row's chance. Nice to have rows do not count. */
export function chanceOfAll(items: Pick<PlanItem, 'role' | 'oneOfGroup'>[], ps: number[]): number {
  let all = 1;
  const miss = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.role === 'required') all *= ps[i];
    else if (it.role === 'oneOf') {
      const g = it.oneOfGroup ?? 'A';
      miss.set(g, (miss.get(g) ?? 1) * (1 - ps[i]));
    }
  });
  for (const m of miss.values()) all *= 1 - m;
  return all;
}

function resultOf(items: PlanItem[], bids: number[], ps: number[], balanceCents: number): PlanResult {
  const out: PlanResult = {
    bids: {}, p: {}, pAll: chanceOfAll(items, ps),
    spentCents: Math.round(bids.reduce((a, b, i) => a + b * ps[i], 0)),
    bidTotalCents: bids.reduce((a, b) => a + b, 0), leftCents: 0,
  };
  out.leftCents = balanceCents - out.spentCents;
  items.forEach((it, i) => {
    out.bids[it.key] = bids[i];
    out.p[it.key] = ps[i];
  });
  return out;
}

/** Every row bids exactly the course page's recommended bid for the chance `target`. */
export function bidsAtTarget(items: PlanItem[], target: number, balanceCents: number, window?: string | null): PlanResult {
  const bids = items.map((it) => suggestBid(it.curve, target, window));
  return resultOf(items, bids, bids.map((b, i) => pInAt(items[i].curve, b)), balanceCents);
}

/**
 * Bids that fit the balance, from the optimiser's answer `fit` (run for the same items): no row bids more than its
 * recommended bid, so the total can only go down. Rows still keep the optimiser's chance where its bid was kept.
 */
export function clampToRecommended(items: PlanItem[], fit: PlanResult, target: number, balanceCents: number, window?: string | null): PlanResult {
  const bids: number[] = [];
  const ps: number[] = [];
  for (const it of items) {
    const full = suggestBid(it.curve, target, window);
    const b = fit.bids[it.key] ?? 0;
    if (b > full) {
      bids.push(full);
      ps.push(pInAt(it.curve, full));
    } else {
      bids.push(b);
      ps.push(fit.p[it.key] ?? 0);
    }
  }
  return resultOf(items, bids, ps, balanceCents);
}

export interface BidSummary {
  /** Sum of all bids. In a pay-as-bid auction this is the most you can pay. */
  bidCents: number;
  /** Expected spend: bids that win. Never above bidCents. */
  likelyCents: number;
  /** Balance minus all bids. */
  leftCents: number;
  /** Bar segment shares of the balance, summing to 1: likely spend, rest of the bids, left. */
  share: { likely: number; rest: number; left: number };
}

/** Numbers and bar shares for "Bids total X of Y · Z left". Left is measured against the bids, not the likely spend. */
export function bidSummary(bidTotalCents: number, spentCents: number, balanceCents: number): BidSummary {
  const bid = Math.max(0, bidTotalCents);
  const likely = Math.min(bid, Math.max(0, spentCents));
  const left = balanceCents - bid;
  const whole = Math.max(balanceCents, bid, 1);
  return {
    bidCents: bid,
    likelyCents: likely,
    leftCents: left,
    share: { likely: likely / whole, rest: (bid - likely) / whole, left: Math.max(0, left) / whole },
  };
}

/** A row is cut by the balance only when it is bid on, below its full bid. A skipped row bids e$0 and counts for nothing. */
export function isCapped(bid: number | null, fullBid: number | null, capMode: boolean): boolean {
  return capMode && fullBid !== null && bid !== null && bid > 0 && bid < fullBid;
}

/**
 * "Below Safe": a row whose bid the balance cut under the bid of the style picked. '' when the presets are plain percentages
 * (the row shows its real chance instead) or the row is not cut. A student who picked Safe must not read a cut bid as Safe.
 */
export function belowStyle(target: number, bid: number | null, fullBid: number | null, capMode: boolean): string {
  const name = styleName(target);
  return name && isCapped(bid, fullBid, capMode) ? `Below ${name}` : '';
}

/**
 * BOSS lets a student bid on one section of a course per window, so rows of the same course are alternatives, not
 * extra chances. Of each course only the row with the cheapest recommended bid for `target` is kept (the first on a
 * tie); the others are returned as skipped and must bid e$0 and add no chance.
 */
export function oneBidPerCourse(items: PlanItem[], target: number, window?: string | null, bossOf: (course: string) => string = bossCodeOf): { kept: PlanItem[]; skipped: PlanItem[] } {
  // A row the student must get (Must / Pick one) is never displaced by a cheaper Nice to have row of the same course.
  const rank = (r: Role) => (r === 'required' ? 0 : r === 'oneOf' ? 1 : 2);
  const best = new Map<string, PlanItem>();
  for (const it of items) {
    const k = bossOf(it.courseCode);
    const cur = best.get(k);
    if (!cur || rank(it.role) < rank(cur.role) || (rank(it.role) === rank(cur.role) && suggestBid(it.curve, target, window) < suggestBid(cur.curve, target, window))) {
      best.set(k, it);
    }
  }
  const kept = items.filter((it) => best.get(bossOf(it.courseCode)) === it);
  return { kept, skipped: items.filter((it) => best.get(bossOf(it.courseCode)) !== it) };
}

/** `result` for the kept items, with each skipped row at a bid of e$0 and no chance. */
export function withSkipped(result: PlanResult, skipped: PlanItem[]): PlanResult {
  if (!skipped.length) return result;
  const bids = { ...result.bids };
  const p = { ...result.p };
  for (const it of skipped) {
    bids[it.key] = 0;
    p[it.key] = 0;
  }
  return { ...result, bids, p };
}

/** Items the optimiser may bid on. Over balance, Nice to have rows get nothing: Must gets come first. */
export function biddableItems<T extends { role: Role }>(items: T[], over: boolean): T[] {
  return over ? items.filter((i) => i.role !== 'optional') : items;
}

/** Same plan (ignoring row ids and key order)? Used to tell a shared link from the saved plan. */
export function samePlan(a: StoredPlan, b: StoredPlan): boolean {
  return JSON.stringify([a.b, typeof a.s === 'number' ? Math.round(a.s * 100) : a.s, a.w, a.a, a.r]) === JSON.stringify([b.b, typeof b.s === 'number' ? Math.round(b.s * 100) : b.s, b.w, b.a, b.r]);
}

type GroupRow = Pick<PlanRowState, 'role' | 'oneOf'>;

/**
 * Letter of a new Pick one group for the row `selfId`: the first of A-D no other Pick one row holds, or null when four
 * groups already exist (the row's own old letter does not count). Choosing "Pick one" always starts a new group.
 */
export function newGroupLetter(rows: (GroupRow & { id: string })[], selfId: string): string | null {
  const used = new Set(rows.filter((r) => r.id !== selfId && r.role === 'oneOf').map((r) => r.oneOf));
  return GROUP_LETTERS.find((g) => !used.has(g)) ?? null;
}

/** True when "Pick one" can be chosen on this row: it already is one, or a group letter is free. */
export const canStartGroup = (rows: (GroupRow & { id: string })[], selfId: string): boolean =>
  rows.some((r) => r.id === selfId && r.role === 'oneOf') || newGroupLetter(rows, selfId) !== null;

/** Role change from the role control: the new role and group letter of the row (a patch), or null when it is not allowed (four groups). */
export function changeRole(rows: (GroupRow & { id: string })[], selfId: string, role: Role): { role: Role; oneOf: string } | null {
  const row = rows.find((r) => r.id === selfId);
  if (!row) return null;
  if (role !== 'oneOf' || row.role === 'oneOf') return { role, oneOf: row.oneOf };
  const letter = newGroupLetter(rows, selfId);
  return letter ? { role, oneOf: letter } : null;
}

/** The row moves into the Pick one group `letter` (whatever it was before). Its old group keeps its other rows or disappears. */
export const moveToGroup = (letter: string): { role: Role; oneOf: string } => ({ role: 'oneOf', oneOf: letter });

/** Where a row is now, for the list that adds a course to a group; '' for a row of that same group (it is not listed). */
export function whereNow(row: GroupRow, letter: string): string {
  if (row.role === 'oneOf') return row.oneOf === letter ? '' : 'in another group';
  return row.role === 'required' ? 'Must get' : 'Nice to have';
}

/**
 * The courses the list "Add a course to this group" offers: one row per other course, in plan order (the first of its
 * rows outside the group), skipping courses whose rows are all in this group already.
 */
export function joinableRows<T extends GroupRow & { course: string }>(rows: T[], letter: string): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if ((r.role === 'oneOf' && r.oneOf === letter) || seen.has(r.course)) return false;
    seen.add(r.course);
    return true;
  });
}

/**
 * The plan list in its three parts, as row indexes in plan order: Must get rows, then one entry per Pick one group
 * (in the order of the group's first row), then Nice to have rows.
 */
export function planParts(rows: GroupRow[]): { must: number[]; groups: { letter: string; idxs: number[] }[]; nice: number[] } {
  const must: number[] = [];
  const nice: number[] = [];
  const groups: { letter: string; idxs: number[] }[] = [];
  rows.forEach((r, i) => {
    if (r.role === 'required') must.push(i);
    else if (r.role === 'optional') nice.push(i);
    else {
      const g = groups.find((x) => x.letter === r.oneOf);
      if (g) g.idxs.push(i);
      else groups.push({ letter: r.oneOf, idxs: [i] });
    }
  });
  return { must, groups, nice };
}

/**
 * Chance of getting at least one row of Pick one group `letter`, from each row's chance: the same product the plan
 * chance uses for a group (chanceOfAll). A group with one row is that row's own chance. Null when the group has no row.
 */
export function chanceOfGroup(items: Pick<PlanItem, 'role' | 'oneOfGroup'>[], ps: number[], letter: string): number | null {
  let miss = 1;
  let n = 0;
  items.forEach((it, i) => {
    if (it.role === 'oneOf' && (it.oneOfGroup ?? 'A') === letter) {
      miss *= 1 - ps[i];
      n++;
    }
  });
  return n ? 1 - miss : null;
}

/**
 * The Must-get course to drop so the typical need fits the balance: the most expensive one, since it
 * frees the most. Null when no single Must-get course is enough.
 */
export function dropToFit(items: PlanItem[], balanceCents: number): { key: string; courseCode: string } | null {
  const req = items.filter((i) => i.role === 'required').sort((a, b) => b.curve.percentilesCents.p50 - a.curve.percentilesCents.p50);
  for (const it of req) {
    if (!overBalance(typicalNeedCents(items.filter((x) => x.key !== it.key)), balanceCents)) return { key: it.key, courseCode: it.courseCode };
  }
  return null;
}

/** Course codes of a group, each once, as "IS469 / IS470". */
export const courseLabel = (codes: string[]): string => [...new Set(codes)].join(' / ');

/** "e$125" for a whole-dollar balance, "e$125.50" otherwise. */
export const balanceLabel = (cents: number): string => (cents % 100 === 0 ? `e$${cents / 100}` : `e$${(cents / 100).toFixed(2)}`);

export interface Saver {
  /** Rows that stop being required together: one Must-get row, or every row of a Pick-one group. */
  keys: string[];
  /** Course code, or the group's courses ("IS469 / IS470"). */
  label: string;
  freedCents: number;
  /** That change alone brings the typical need within the balance. */
  fits: boolean;
}

/**
 * What to move out of the must-haves to free the most of the balance: for every Must-get row, and for every Pick-one
 * group as a whole, how much the typical need (typicalNeedCents) falls if it becomes Nice to have (or is dropped).
 * One row of a group on its own frees nothing while another member stays, so groups are judged whole.
 * `fits` is judged on the typical need, not on bids for your wanted chance. Null when nothing would free anything.
 */
export function needSaver(items: PlanItem[], balanceCents: number): Saver | null {
  const need = typicalNeedCents(items);
  let best: Saver | null = null;
  const consider = (keys: string[], label: string) => {
    const out = new Set(keys);
    const after = typicalNeedCents(items.map((x) => (out.has(x.key) ? { ...x, role: 'optional' as Role } : x)));
    const freed = need - after;
    if (freed > 0 && (!best || freed > best.freedCents)) best = { keys, label, freedCents: freed, fits: !overBalance(after, balanceCents) };
  };
  for (const it of items) if (it.role === 'required') consider([it.key], it.courseCode);
  const groups = new Map<string, PlanItem[]>();
  for (const it of items) if (it.role === 'oneOf') groups.set(it.oneOfGroup ?? 'A', [...(groups.get(it.oneOfGroup ?? 'A') ?? []), it]);
  for (const g of groups.values()) consider(g.map((x) => x.key), courseLabel(g.map((x) => x.courseCode)));
  return best;
}

/** The over-balance notice: what the must-gets typically need against the balance, as numbers. */
export function needSentence(_items: Pick<PlanItem, 'role'>[], needCents: number, balanceCents: number): string {
  return `Need about ${eS(needCents)} · balance ${eS(balanceCents)}`;
}

/**
 * Chance of a seat as a background colour, red (low) to green (high): pale tints, so dark text on it keeps at least
 * 7:1 contrast. Chances under 25% are all the reddest. The number is always shown as text; colour only supports it.
 */
export function chanceTint(p: number): string {
  const t = Math.min(1, Math.max(0, (p - 0.25) / 0.75));
  return `hsl(${Math.round(125 * t)} 62% ${Math.round(84 + 6 * t)}%)`;
}

export interface ClashEntry {
  /** Row id. */
  id: string;
  /** "IS469 G2". */
  label: string;
  meetings: Pick<Meeting, 'day' | 'start' | 'end'>[];
  /** Pick-one group letter. Members of one group are alternatives, so they may overlap. */
  alt?: string;
}

export interface ClashPair {
  a: string;
  b: string;
  aLabel: string;
  bLabel: string;
  /** When each section meets at the overlap: "Mon 12:00-15:15". */
  aWhen: string;
  bWhen: string;
}

const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const minutes = (t: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
};

/** Meetings with a known day and a start before the end. TBA meetings (day 'TBA', no times) drop out. */
function timedMeetings(ms: ClashEntry['meetings']) {
  const out: { day: number; start: number; end: number; m: ClashEntry['meetings'][number] }[] = [];
  for (const m of ms) {
    const day = WEEK.indexOf((m.day ?? '').trim().slice(0, 3).toLowerCase());
    const start = minutes(m.start);
    const end = minutes(m.end);
    if (day >= 0 && start !== null && end !== null && start < end) out.push({ day, start, end, m });
  }
  return out;
}

/**
 * Pairs of chosen sections that meet at overlapping times on the same day. Meetings that only touch (one ends 12:00,
 * the next starts 12:00) do not clash; TBA sections are skipped; two options of one Pick one group never clash.
 */
export function findClashes(entries: ClashEntry[]): ClashPair[] {
  const timed = entries.map((e) => timedMeetings(e.meetings));
  const out: ClashPair[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].alt !== undefined && entries[i].alt === entries[j].alt) continue;
      const am: ClashEntry['meetings'] = [];
      const bm: ClashEntry['meetings'] = [];
      for (const x of timed[i]) {
        for (const y of timed[j]) {
          if (x.day === y.day && x.start < y.end && y.start < x.end) {
            if (!am.includes(x.m)) am.push(x.m);
            if (!bm.includes(y.m)) bm.push(y.m);
          }
        }
      }
      if (am.length) out.push({ a: entries[i].id, b: entries[j].id, aLabel: entries[i].label, bLabel: entries[j].label, aWhen: formatSlot(am), bWhen: formatSlot(bm) });
    }
  }
  return out;
}

/** One line for a row: "Clashes with IS469 G2 (Mon 12:00-15:15)", naming the other section and when it meets. */
export const clashText = (c: ClashPair, id: string): string => (c.a === id ? `Clashes with ${c.bLabel} (${c.bWhen})` : `Clashes with ${c.aLabel} (${c.aWhen})`);

/** The clash lines of one row. */
export const clashLines = (pairs: ClashPair[], id: string): string[] => pairs.filter((c) => c.a === id || c.b === id).map((c) => clashText(c, id));

/** "IS469 G2 clashes with IS215 G4 (Wed 15:30–18:45)": the same words as clashText, from the plan's side. */
const pairText = (c: ClashPair): string => `${c.aLabel} clashes with ${c.bLabel} (${c.bWhen})`;

/** One line for the plan, or '' when there is no clash. */
export function clashSummary(pairs: ClashPair[]): string {
  if (!pairs.length) return '';
  return pairs.length === 1 ? pairText(pairs[0]) : `${pairs.length} clashes: ${pairs.map(pairText).join('; ')}`;
}

const SHARE_PREFIX = 'share=';
/** Links without a version (v) are the old ones. An empty balance (b null) is carried by every link; e$125 is an ordinary balance again. */
const SHARE_VERSION = 2;

/** Link fragment for a shared plan: "#share=<base64 of the plan>". */
export function encodeShare(plan: StoredPlan): string {
  return `#${SHARE_PREFIX}${btoa(JSON.stringify({ ...plan, v: SHARE_VERSION }))}`;
}

/** A plan from a "#share=..." fragment. Any other fragment (old plain ones included) is not a plan. */
export function decodeShare(hash: string): StoredPlan | null {
  const h = hash.replace(/^#/, '');
  if (!h.startsWith(SHARE_PREFIX)) return null;
  try {
    return decodePlan(JSON.parse(atob(h.slice(SHARE_PREFIX.length))));
  } catch {
    return null;
  }
}

export { MAX_FRIENDS_GROUP };
