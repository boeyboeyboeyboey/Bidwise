// Pure logic for Plan B: the budget split, which sections a budget can buy, and their order. No DOM, no fetch.
import { parseBalance } from '../planner/plan';
import { TARGETS } from '../../lib/sim/forecast';
import type { Block, Candidate, OfferedCourse, ReqTree, Requisites, SectionOption } from '../../lib/gradreq';

export { parseBalance as parseMoney, TARGETS };

export type CoursesNeeded = 1 | 2 | 3;

/** "40" for whole e$, otherwise two decimals: "40.50", "0.25". */
export const moneyText = (cents: number): string => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
/** "e$40", "e$40.5". */
export const eText = (cents: number): string => `e$${moneyText(cents)}`;

/** e$ left divided over the courses still needed, rounded down to a whole cent. */
export function splitBudget(leftCents: number, courses: number): number {
  const n = Math.min(3, Math.max(1, Math.round(courses) || 1));
  return Math.floor(leftCents / n);
}

/** One section a student can buy: the course it belongs to and what the bid at the chosen chance would be. */
export interface PlanRow {
  code: string;
  title: string;
  /** check: the course has a parsed prerequisite rule that may be incomplete. */
  eligibility: 'ok' | 'check';
  cls: 'rule' | 'tagged';
  section: SectionOption;
  /** One small line under the row about prerequisites (see `noteFor`), or null. */
  note?: string | null;
}

/** Cheapest bid first; more seats first on a tie; then code and section so the order never shuffles. */
export function compareRows(a: PlanRow, b: PlanRow): number {
  return (a.section.bidCents as number) - (b.section.bidCents as number)
    || b.section.seatsLeft - a.section.seatsLeft
    || a.code.localeCompare(b.code)
    || a.section.section.localeCompare(b.section.section, 'en', { numeric: true });
}

/**
 * The sections of these candidates that have seats, a priced bid at the chosen chance, and a bid within the budget,
 * cheapest first. `bidCents` on a section is already the bid for the chosen chance (group of 1).
 */
export function affordableRows(cands: readonly Candidate[], budgetCents: number): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const c of cands) {
    for (const s of c.sections) {
      if (s.seatsLeft > 0 && s.bidCents !== null && s.bidCents <= budgetCents) {
        rows.push({ code: c.code, title: c.title, eligibility: c.eligibility, cls: c.cls, section: s });
      }
    }
  }
  return rows.sort(compareRows);
}

/** Rows of courses that fill no open requirement, in the same order. */
export function otherRows(rows: readonly PlanRow[], taken: ReadonlySet<string>): PlanRow[] {
  return rows.filter((r) => !taken.has(r.code));
}

/** Codes of the courses that could still fill the given blocks (not done, not made redundant by a chosen alternative). */
export function blockCodes(blocks: readonly Block[]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks) for (const m of b.members) if (!m.done && !m.setSatisfied) out.add(m.code);
  return out;
}

/**
 * Drops sections that cannot be priced (no forecast, so no minimum bid) or whose minimum bid already exceeds the budget,
 * so they are never simulated; then courses left with no section.
 */
export function prunedCourses(courses: readonly OfferedCourse[], budgetCents: number): OfferedCourse[] {
  const out: OfferedCourse[] = [];
  for (const c of courses) {
    const sectionsNow = c.sectionsNow.filter((s) => s.minBidCents !== undefined && s.minBidCents <= budgetCents);
    if (sectionsNow.length) out.push({ ...c, sectionsNow });
  }
  return out;
}

/** A requirement-less "block" listing these courses, so candidates() can price a plain list of courses. */
export function pseudoBlock(courses: readonly { code: string; title: string }[]): Block {
  return {
    id: 'plan-b-all', viewId: 'plan-b', viewKind: 'degree', name: 'Courses you can afford', headings: [], kind: 'list', role: 'additive',
    overlap: false, unit: 'course', need: 1, done: 0, left: 1, minCourses: null, complete: false,
    members: courses.map((c) => ({ code: c.code, title: c.title, cus: 1, cls: 'rule' as const, mandatory: false, done: false, setSatisfied: false })),
    mandatoryLeft: [], doneCodes: [], usedElsewhere: [], unnamed: [], hints: [], mayCount: [], choiceSets: [], listMissing: false,
  };
}

export const chunk = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * The requisite rules to filter by. With no course marked done every course with a prerequisite would count as blocked,
 * so nothing is hidden then (the rows carry a tag instead); once something is done, unmet prerequisites hide courses.
 */
export const effectiveRequisites = (reqs: Requisites, hasDone: boolean): Requisites => (hasDone ? reqs : {});

/** "A", "A and B", "A or B" for a flat tree of up to 3 course codes; null for anything more involved. */
function simpleTree(t: ReqTree | undefined): string | null {
  if (t === undefined) return null;
  if (typeof t === 'string') return t;
  const [op, ...rest] = t;
  if ((op !== 'and' && op !== 'or') || rest.length === 0 || rest.length > 3 || !rest.every((x) => typeof x === 'string')) return null;
  return (rest as string[]).join(` ${op} `);
}

/**
 * The line under a row. With nothing marked done: "Needs ACCT101" for a simple prerequisite, "Has prerequisites" otherwise
 * (a rule that is only flagged uncertain, with no parsed tree, says nothing). With something done, the courses that are
 * still shown are met on paper, so only the uncertain-parse warning remains.
 */
export function noteFor(code: string, eligibility: 'ok' | 'check', reqs: Requisites, hasDone: boolean): string | null {
  if (hasDone) return eligibility === 'check' ? 'Check prerequisites on BOSS' : null;
  const prereq = reqs[code]?.prereq;
  if (prereq === undefined) return null;
  const simple = simpleTree(prereq);
  return simple ? `Needs ${simple}` : 'Has prerequisites';
}

export function withNotes(rows: readonly PlanRow[], reqs: Requisites, hasDone: boolean): PlanRow[] {
  return rows.map((r) => ({ ...r, note: noteFor(r.code, r.eligibility, reqs, hasDone) }));
}

export interface BlockRows { key: string; rows: PlanRow[] }
export interface DedupedRows { rows: PlanRow[]; /** Courses of this block that are already listed in an earlier block. */ also: string[] }

/** Lists each course once, in the first block (in the order given) that has it; later blocks name those courses instead. */
export function dedupeBlocks(blocks: readonly BlockRows[]): Map<string, DedupedRows> {
  const seen = new Set<string>();
  const out = new Map<string, DedupedRows>();
  for (const b of blocks) {
    const rows = b.rows.filter((r) => !seen.has(r.code));
    const also = [...new Set(b.rows.filter((r) => seen.has(r.code)).map((r) => r.code))];
    for (const r of rows) seen.add(r.code);
    out.set(b.key, { rows, also });
  }
  return out;
}
