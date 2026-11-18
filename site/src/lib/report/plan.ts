// Planner rows for the bid report: the same figures and wording the planner rows show (PlanRow.svelte). Pure.
import type { Section } from '../data/types';
import type { Role } from '../sim/planner';
import type { SimResult } from '../sim';
import { ISSUE_TEXT, isCapped, reasonList, type NamedReason, type RowIssue } from '../../components/planner/plan';
import { styleName } from '../sim/presets';
import { GROUP_NOTICE } from '../../components/course/bidStyle';
import { eS, pct } from '../../components/course/fmt';
import { NO_BIDS, sectionFacts, type ReportRow, type ReportTotal } from './csv';

export const ROLE_TEXT: Record<Role, string> = { required: 'Must get', oneOf: 'Pick one', optional: 'Nice to have' };

export interface PlanReportInput {
  code: string;
  title: string;
  section: Section;
  role: Role;
  /** Courses of the Pick one group ("IS469 / IS470"); '' when not a Pick one row. */
  pickOf: string;
  group: number;
  window: string;
  issue: RowIssue | null;
  /** Bid and chance from the plan result (after fitting the balance); null while not computed. */
  bid: number | null;
  p: number | null;
  /** The recommended bid for the chance wanted, before the balance cuts it. */
  fullBid: number | null;
  /** Name of the other pick that covers a skipped Pick one row, or ''. */
  covered: string;
  /** The plan is not possible within the balance. */
  none: boolean;
  /** The recommended bids add up to more than the balance. */
  capMode: boolean;
  /** Bid per preset level (80 / 90 / 95% chance, or Cheap / Balanced / Safe) at this group size. */
  bids: ReportRow['bids'];
  /** The chance level wanted: a preset level (0.8 / 0.9 / 0.95, or Cheap / Balanced / Safe when calibrated). */
  target: number;
  /** Why the plan bids this much (bidReason); '' when there is nothing to say. */
  reason: string;
  /** Lines naming the sections this one clashes with in time (clashLines). */
  clashes: string[];
  /** The row is bid for 2 or more people while group estimates are withheld: it exports no bid figure, only the group notice. */
  groupHidden?: boolean;
  /** Any other reason the row is not priced (e.g. loading): no bid figures, this text in "Why this bid". */
  unpricedReason?: string;
}

/** What a bid reason is built from: the row's simulation and what the plan did with it. */
export interface ReasonInput {
  bid: number | null;
  /** The recommended bid for the chance wanted, before the balance cuts it. */
  fullBid: number | null;
  target: number;
  minBidCents: number | undefined;
  curve: Pick<SimResult, 'pFill' | 'percentilesCents'> | undefined;
  /** Past results behind the forecast. */
  nObs: number | undefined;
}

/** A section that fills in fewer than this share of forecasts usually clears at the minimum bid. */
export const RARELY_FILLS = 0.25;
/** Fewer past results than this is worth a warning. */
export const FEW_RESULTS = 3;

/**
 * A short line on why this bid, from the row's own forecast: where the cutoff usually lands and how high it can go (whole e$),
 * with a note when few past results back it. '' when the row is not bid on. A section that rarely fills says the minimum bid is
 * enough, or (calibrated, bid above the minimum) that the style's bid also covers a surprise fill. (How much the balance cut a bid is shown by the row and the report's note, not here.)
 */
export function bidReason(i: ReasonInput): string {
  if (i.bid === null || i.bid <= 0 || !i.curve) return '';
  const n = i.nObs;
  const few = n === undefined || n >= FEW_RESULTS ? '' : n <= 0 ? 'No past results, so this is a rough guide' : `Only ${n} past ${n === 1 ? 'result' : 'results'}, so this is a rough guide`;
  // A bid above the minimum next to "minimum likely enough" would contradict itself: say what the extra buys instead.
  const style = styleName(i.target);
  const above = i.minBidCents !== undefined && i.bid > i.minBidCents + 1;
  const covers = style && (i.fullBid === null || i.bid >= i.fullBid) ? style : 'this bid';
  const main = i.curve.pFill < RARELY_FILLS && i.minBidCents !== undefined
    ? above && style
      ? `Rarely fills · ${covers} also covers a surprise fill`
      : `Rarely fills · minimum ${eS(i.minBidCents)} likely enough`
    : `Usually clears around ${eD(i.curve.percentilesCents.p50)} · up to ${eD(i.curve.percentilesCents.p90)}`;
  return few ? `${main} · ${few}` : main;
}

/** Whole e$ for the bid reason's sentence (cents in). */
const eD = (cents: number): string => `e$${Math.round(cents / 100)}`;

/** One line on what the plan does with this row, in the planner's own words; '' when it is a plain bid. */
export function planNote(i: Pick<PlanReportInput, 'issue' | 'bid' | 'p' | 'fullBid' | 'covered' | 'none' | 'capMode' | 'target'>): string {
  if (i.issue) return ISSUE_TEXT[i.issue];
  const need = i.fullBid !== null && i.fullBid > 0 ? `Needs ${eS(i.fullBid)}` : '';
  if (i.none && need) return need;
  if (i.bid === null) return '';
  if (i.bid === 0) {
    if (i.covered) return `Not bid · ${i.covered} covers it`;
    return i.capMode && need ? need : "Can't win a seat";
  }
  if (!isCapped(i.bid, i.fullBid, i.capMode)) return '';
  const style = styleName(i.target);
  if (style) return `Cut to fit your balance · Below ${style} · a ${style} bid would be ${eS(i.fullBid as number)}`;
  return `Cut to fit your balance · a bid for ${pct(i.target)} would be ${eS(i.fullBid as number)} (wanted ${pct(i.target)})`;
}

export function planReportRow(i: PlanReportInput): ReportRow {
  // A hard fact (a seat issue) comes before the group notice.
  const why = i.issue ? ISSUE_TEXT[i.issue] : (i.unpricedReason ?? (i.groupHidden ? GROUP_NOTICE : ''));
  if (why) {
    return {
      ...sectionFacts(i.code, i.title, i.section),
      window: i.window,
      bids: NO_BIDS,
      note: i.clashes.join(' · '),
      priority: i.role === 'oneOf' && i.pickOf ? `${ROLE_TEXT.oneOf} of ${i.pickOf}` : ROLE_TEXT[i.role],
      group: i.group,
      planBidCents: null,
      planChance: '',
      planP: null,
      reason: why,
    };
  }
  const bidOn = !i.none && i.bid !== null && i.bid > 0;
  return {
    ...sectionFacts(i.code, i.title, i.section),
    window: i.window,
    bids: i.bids,
    note: [planNote(i), ...i.clashes].filter(Boolean).join(' · '),
    priority: i.role === 'oneOf' && i.pickOf ? `${ROLE_TEXT.oneOf} of ${i.pickOf}` : ROLE_TEXT[i.role],
    group: i.group,
    planBidCents: bidOn ? i.bid : null,
    planChance: bidOn && i.p !== null ? pct(i.p) : '',
    planP: bidOn ? i.p : null,
    reason: bidOn ? i.reason : '',
  };
}

export interface PlanTotalsInput {
  balanceCents: number | null;
  /** Sum of the plan's bids, and what is left (null with no balance); both null when the planner shows "Not possible". */
  bidTotalCents: number | null;
  leftCents: number | null;
  /** Chance of all must-get courses as the planner shows it; null when there is none to show. */
  pAll: number | null;
  /** What the must-gets need when that is more than the balance. */
  needCents: number | null;
  /** Rows with no price (unpriced or loading) and why: left out of the bid total. */
  notCounted?: readonly NamedReason[];
}

export const NOT_COUNTED_LABEL = 'Not counted';

const e = (c: number) => (c / 100).toFixed(2);

export function planTotals(t: PlanTotalsInput): ReportTotal[] {
  const out: ReportTotal[] = t.balanceCents === null ? [] : [{ label: 'Balance (e$)', value: e(t.balanceCents) }];
  if (t.bidTotalCents !== null) out.push({ label: t.notCounted?.length ? 'Plan bids total, priced rows only (e$)' : 'Plan bids total (e$)', value: e(t.bidTotalCents) });
  if (t.leftCents !== null) out.push({ label: 'Left after bids (e$)', value: e(Math.max(0, t.leftCents)) });
  if (t.needCents !== null) out.push({ label: 'Must-gets need about (e$)', value: e(t.needCents) });
  if (t.notCounted?.length) out.push({ label: NOT_COUNTED_LABEL, value: reasonList(t.notCounted) });
  if (t.pAll !== null) out.push({ label: 'Chance of all must-get courses', value: pct(t.pAll) });
  return out;
}
