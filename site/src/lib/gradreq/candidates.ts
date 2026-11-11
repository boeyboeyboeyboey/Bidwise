// Which courses can fill a block this term, with sections, times, and the bid and chance the site already forecasts.
// Forecasting is not reimplemented: sections go through the planner's own mapping (toPlanSimInput) and the
// simulator (simulate, pInAt, recommendBid), with the planner's runs and seed, so a figure here equals the course page.
import { toPlanSimInput, rowIssue, type RowIssue } from '../../components/planner/plan';
import type { CourseData, Meeting, Section } from '../data/types';
import { seatsLeftNow, seatsOf, type SeatSource } from '../data/seats';
import { formatSlot } from '../format/slot';
import { pInAt, recommendBid, simulate, type SimInput, type SimResult } from '../sim';
import { TARGETS, effectiveWindow } from '../sim/forecast';
import { canonicalJson } from '../sim/cache';
import { eligibility } from './eligibility';
import type { Block, Requisites } from './types';

/** What the site holds for a course this term (data/real/courses/<code>.json, or the page's CourseHead). */
export type OfferedCourse = Pick<CourseData, 'code' | 'title' | 'sectionsNow'>;
export type OfferedData = ReadonlyMap<string, OfferedCourse> | Readonly<Record<string, OfferedCourse>>;

export const DEFAULT_BID_CENTS = 3000;
export const DEFAULT_TARGET = TARGETS[0];

export interface CandidateOptions {
  /** chance (default): best chance at `bid`, high to low. cheapest: lowest recommended bid, low to high. */
  sort?: 'chance' | 'cheapest';
  /** Bid in cents that "chance" is measured at, the same for every course. Default e$30 (3000). */
  bid?: number;
  /** Win chance the recommended bid aims for. Default 0.8, the course page's first target. */
  target?: number;
  /** The current bidding window label, e.g. "Round 1B Window 1". */
  window: string;
  /** The window picked in the header, if any; used before `window` when a section has a forecast for it. */
  chosenWindow?: string | null;
  /** Simulated bidding windows per section (default: the planner's). Tests lower it. */
  runs?: number;
  simulate?: (input: SimInput) => SimResult;
}

export interface SectionOption {
  classNumber: string;
  section: string;
  instructor: string;
  seatsLeft: number;
  seatsTotal: number;
  seatSource: SeatSource;
  /** "Mon 12:00–15:15"; '' when the section has no time yet. Actual times, never a part of the day. */
  times: string;
  meetings: Meeting[];
  minBidCents: number | null;
  /** Forecast window used. */
  window: string | null;
  /** Bid for `target` chance, group of 1. Null without a forecast. */
  bidCents: number | null;
  /** Chance of a seat at `opts.bid`: 0 below the section's minimum bid. Null without a forecast. */
  chance: number | null;
  pFill: number | null;
  issue: RowIssue | null;
}

export interface Candidate {
  code: string;
  title: string;
  cls: 'rule' | 'tagged';
  mandatory: boolean;
  cus: number;
  /** check: the requisite rule is flagged uncertain. */
  eligibility: 'ok' | 'check';
  /** Sections with seats now, best chance first. */
  sections: SectionOption[];
  /** Sections offered but full (or estimated full). */
  fullSections: number;
  /** Best section chance at `opts.bid`; null when no section has a forecast. */
  chance: number | null;
  /** Lowest recommended bid over the sections; null when no section has a forecast. */
  bidCents: number | null;
}

export interface MayCountEntry { code: string; title: string; cus: number; eligibility: 'ok' | 'check'; sectionCount: number }

export interface CandidateResult { candidates: Candidate[]; mayCount: MayCountEntry[] }

const simCache = new Map<string, SimResult>();
export function clearCandidateCache(): void {
  simCache.clear();
}

function runSim(input: SimInput, fn: (i: SimInput) => SimResult): SimResult {
  const key = canonicalJson(input);
  let r = simCache.get(key);
  if (!r) {
    r = fn(input);
    simCache.set(key, r);
  }
  return r;
}

function lookup(data: OfferedData, code: string): OfferedCourse | undefined {
  return data instanceof Map ? data.get(code) : (data as Readonly<Record<string, OfferedCourse>>)[code];
}

function sectionOption(s: Section, o: CandidateOptions, bid: number, target: number): SectionOption | 'full' {
  const forecastKeys = Object.keys(s.forecast ?? {});
  const win = effectiveWindow(o.chosenWindow ?? null, o.window, forecastKeys);
  const issue = rowIssue(s, win, 1);
  if (issue === 'full' || issue === 'estfull') return 'full';
  const seats = seatsOf(s);
  const base: SectionOption = {
    classNumber: s.classNumber, section: s.section, instructor: s.instructor,
    seatsLeft: seatsLeftNow(s), seatsTotal: seats.total, seatSource: seats.source,
    times: formatSlot(s.meetings), meetings: s.meetings,
    minBidCents: s.minBidCents ?? null, window: null, bidCents: null, chance: null, pFill: null, issue,
  };
  const input = toPlanSimInput(s, win, 1);
  if (!input) return base;
  const r = runSim(o.runs ? { ...input, runs: o.runs } : input, o.simulate ?? simulate);
  const minBid = s.minBidCents as number;
  return { ...base, window: win, bidCents: recommendBid(r, target), chance: bid < minBid ? 0 : pInAt(r, bid), pFill: r.pFill };
}

const clsRank = (c: Candidate) => (c.cls === 'rule' ? 0 : 1);
const pct = (x: number) => Math.round(x * 100);

/**
 * Members of the block that can be bid for this term: counting members with a site key and at least one section now,
 * not completed, not in a satisfied choice set, and not blocked by a requisite. Hints are never candidates; the ones
 * offered this term come back as `mayCount`. A complete block has none.
 *
 * Chance is comparable across courses because it is measured at one bid for all of them (`opts.bid`, default e$30):
 * the forecast's P(win) for each section at that bid, group of 1, and a course takes its best section.
 */
export function candidates(
  block: Block,
  offered: OfferedData,
  completedCodes: Iterable<string>,
  requisites: Requisites,
  opts: CandidateOptions,
): CandidateResult {
  if (block.kind === 'free' || block.complete) return { candidates: [], mayCount: [] };
  const completed = new Set(completedCodes);
  const bid = opts.bid ?? DEFAULT_BID_CENTS;
  const target = opts.target ?? DEFAULT_TARGET;
  const out: Candidate[] = [];

  for (const m of block.members) {
    if (m.done || m.setSatisfied || completed.has(m.code)) continue;
    const course = lookup(offered, m.code);
    if (!course || !course.sectionsNow?.length) continue;
    const elig = eligibility(m.code, completed, requisites);
    if (elig === 'blocked') continue;
    let full = 0;
    const sections: SectionOption[] = [];
    for (const s of course.sectionsNow) {
      const o = sectionOption(s, opts, bid, target);
      if (o === 'full') full++;
      else sections.push(o);
    }
    sections.sort((a, b) => (b.chance ?? -1) - (a.chance ?? -1) || (a.bidCents ?? Infinity) - (b.bidCents ?? Infinity) || a.classNumber.localeCompare(b.classNumber));
    const chances = sections.map((s) => s.chance).filter((x): x is number => x !== null);
    const bids = sections.map((s) => s.bidCents).filter((x): x is number => x !== null);
    out.push({
      code: m.code, title: course.title || m.title, cls: m.cls, mandatory: m.mandatory, cus: m.cus, eligibility: elig,
      sections, fullSections: full,
      chance: chances.length ? Math.max(...chances) : null,
      bidCents: bids.length ? Math.min(...bids) : null,
    });
  }

  const tie = (a: Candidate, b: Candidate) => clsRank(a) - clsRank(b) || Number(b.mandatory) - Number(a.mandatory) || a.code.localeCompare(b.code);
  if ((opts.sort ?? 'chance') === 'cheapest') {
    out.sort((a, b) => (a.bidCents ?? Infinity) - (b.bidCents ?? Infinity) || pct(b.chance ?? -1) - pct(a.chance ?? -1) || tie(a, b));
  } else {
    out.sort((a, b) => pct(b.chance ?? -1) - pct(a.chance ?? -1) || (a.bidCents ?? Infinity) - (b.bidCents ?? Infinity) || tie(a, b));
  }

  const mayCount: MayCountEntry[] = [];
  for (const h of block.hints) {
    if (completed.has(h.code)) continue;
    const course = lookup(offered, h.code);
    if (!course || !course.sectionsNow?.length) continue;
    const elig = eligibility(h.code, completed, requisites);
    if (elig === 'blocked') continue;
    mayCount.push({ code: h.code, title: course.title || h.title, cus: h.cus, eligibility: elig, sectionCount: course.sectionsNow.length });
  }
  mayCount.sort((a, b) => a.code.localeCompare(b.code));
  return { candidates: out, mayCount };
}
