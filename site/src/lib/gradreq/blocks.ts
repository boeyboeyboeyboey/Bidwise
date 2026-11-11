// Turns the requirement views a student picked, plus the courses already completed, into open and finished blocks.
// Pure: no DOM, no fetch. Rules are in the module header of model/build_gradreq_data.py (roles, parent, choice sets).
import { applyTracks } from './programme';
import type {
  Block, BlockMember, BlockUnit, ChoiceSetState, DerivedBlocks, GradGroup, GradMember, Heading, HintMember,
  IgnoredGroup, LoadedView, NonCourseItem, Placeholder, SecondMajorState,
} from './types';

/** Component rows with no course list that are experiences, not courses (Internship, Community Service). */
export const NON_COURSE_NAME = /\b(internship|community service|work[- ]?study|attachment)\b/i;

interface Counting { code: string; title: string; cus: number; cls: 'rule' | 'tagged'; mandatory: boolean }

interface Draft {
  g: GradGroup;
  lv: LoadedView;
  order: number;
  headings: string[];
  kind: 'list' | 'free';
  role: 'additive' | 'component' | 'overlay';
  unit: BlockUnit;
  need: number | null;
  counting: Counting[];
  hints: HintMember[];
  unnamed: string[];
  listMissing: boolean;
  /** set id -> codes (sets of 2+ counting members, after the intake filter) */
  sets: Map<string, string[]>;
  setsOf: Map<string, string[]>;
  /** 'programme' | 'second:<view id>' | 'solo' (evaluated alone: overlays and blocks without a quantity) | 'free' */
  pool: string;
  alloc: string[];
  used: number;
  setUsed: Map<string, string>;
}

const cusOf = (m: { cus: number | null }): number => (m.cus === null || m.cus === undefined || !(m.cus > 0) ? 1 : m.cus);
const EPS = 1e-9;

function room(d: Draft): boolean {
  if (d.need === null) return false;
  return d.unit === 'cu' ? d.used < d.need - EPS : d.alloc.length < d.need;
}

function setConflict(d: Draft, code: string): boolean {
  const ids = d.setsOf.get(code);
  return !!ids && ids.some((id) => d.setUsed.has(id));
}

function take(d: Draft, c: Counting): void {
  d.alloc.push(c.code);
  d.used += d.unit === 'cu' ? c.cus : 1;
  for (const id of d.setsOf.get(c.code) ?? []) if (!d.setUsed.has(id)) d.setUsed.set(id, c.code);
}

const countingOf = (d: Draft, code: string) => d.counting.find((c) => c.code === code);

/** Each completed course lands in at most one draft. Most constrained first: mandatory somewhere, then fewest blocks it
 *  fits, then the smallest member list, then the code. Into the draft where it is mandatory, then the smaller list, then file order. */
function allocate(drafts: Draft[], completed: ReadonlySet<string>): void {
  const where = new Map<string, Draft[]>();
  for (const d of drafts) {
    for (const c of d.counting) {
      if (!completed.has(c.code)) continue;
      const list = where.get(c.code) ?? [];
      list.push(d);
      where.set(c.code, list);
    }
  }
  const order = [...where.entries()]
    .map(([code, ds]) => ({
      code,
      ds,
      mand: ds.some((d) => countingOf(d, code)?.mandatory) ? 0 : 1,
      minList: Math.min(...ds.map((d) => d.counting.length)),
    }))
    .sort((a, b) => a.mand - b.mand || a.ds.length - b.ds.length || a.minList - b.minList || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const o of order) {
    const fits = o.ds.filter((d) => room(d) && !setConflict(d, o.code));
    if (!fits.length) continue;
    const rank = (d: Draft) => (countingOf(d, o.code)?.mandatory ? 0 : 1);
    fits.sort((a, b) => rank(a) - rank(b) || a.counting.length - b.counting.length || a.order - b.order);
    take(fits[0], countingOf(fits[0], o.code) as Counting);
  }
}

/** A block evaluated alone (overlay, or no stated quantity): every completed counting member, one per choice set. */
function evaluateSolo(d: Draft, completed: ReadonlySet<string>): void {
  for (const c of d.counting) {
    if (completed.has(c.code) && !setConflict(d, c.code)) take(d, c);
  }
}

function readView(lv: LoadedView, intake: string, startOrder: number, out: {
  drafts: Draft[]; headings: Heading[]; placeholders: Placeholder[]; nonCourse: NonCourseItem[]; ignored: IgnoredGroup[];
}): number {
  const { view } = lv;
  const groups = view.groups.filter((g) => !g.intakes || g.intakes.includes(intake));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const children = new Map<string, GradGroup[]>();
  for (const g of groups) {
    if (g.parent && byId.has(g.parent)) {
      const l = children.get(g.parent) ?? [];
      l.push(g);
      children.set(g.parent, l);
    }
  }
  const pathOf = (g: GradGroup): string[] => {
    const names: string[] = [];
    for (let p = g.parent ? byId.get(g.parent) : undefined, n = 0; p && n < 10; p = p.parent ? byId.get(p.parent) : undefined, n++) names.unshift(p.name);
    return names;
  };
  let order = startOrder;
  for (const g of groups) {
    order++;
    if (g.role === 'alternative') {
      out.ignored.push({ id: g.id, viewId: view.id, name: g.name, reason: 'alternative' });
      continue;
    }
    // A component whose parent was dropped by the intake filter goes with it.
    if (g.parent && !byId.has(g.parent) && view.groups.some((x) => x.id === g.parent)) continue;
    // Optional-reading overlays with no quantity (CS Managing, Modes of Thinking) say nothing a student can act on.
    if (g.role === 'overlay' && /-optional$/.test(g.id) && !((g.cus ?? 0) > 0 || (g.minCourses ?? 0) > 0)) {
      out.ignored.push({ id: g.id, viewId: view.id, name: g.name, reason: 'meta' });
      continue;
    }
    const kids = children.get(g.id);
    if (kids?.length) {
      out.headings.push({
        id: g.id, viewId: view.id, name: g.name, headings: pathOf(g), cus: g.cus ?? null, counted: 0,
        cusLeft: g.cus === null || g.cus === undefined ? null : g.cus, childIds: kids.map((k) => k.id),
      });
      continue;
    }
    const members: GradMember[] = g.members.filter((m) => !m.intakes || m.intakes.includes(intake));
    const counting = members.filter((m) => m.cls !== 'hint');
    const named: Counting[] = [];
    const seen = new Set<string>();
    for (const m of counting) {
      if (m.code && !seen.has(m.code)) {
        seen.add(m.code);
        named.push({ code: m.code, title: m.title, cus: cusOf(m), cls: m.cls as 'rule' | 'tagged', mandatory: !!m.mandatory });
      }
    }
    const unnamed = counting.filter((m) => !m.code).map((m) => m.title);
    const hints: HintMember[] = members.filter((m) => m.cls === 'hint' && m.code).map((m) => ({ code: m.code as string, title: m.title, cus: cusOf(m) }));
    const hasNeed = (g.cus ?? 0) > 0 || (g.minCourses ?? 0) > 0;
    const second = lv.kind === 'second';
    const item = { id: g.id, viewId: view.id, name: g.name, headings: pathOf(g), cus: g.cus ?? null };

    if (g.type === 'non_course') {
      if (counting.length > 0) {
        /* a real list that the data types as non_course (second-major electives, or a basket with no quantity): fall through as a list */
      } else if (second && !hasNeed && counting.length === 0) {
        out.ignored.push({ id: g.id, viewId: view.id, name: g.name, reason: 'meta' });
        continue;
      } else {
        out.nonCourse.push(item);
        continue;
      }
    } else if (g.type !== 'free_elective' && members.length === 0) {
      if (g.role === 'additive') {
        out.placeholders.push({ id: g.id, viewId: view.id, name: g.name, cus: g.cus ?? null, needs: second ? 'second-major-list' : 'major-or-track' });
        continue;
      }
      if (g.role === 'component' && NON_COURSE_NAME.test(g.name)) {
        out.nonCourse.push(item);
        continue;
      }
      if (g.role === 'overlay' && !g.missingList && !hasNeed) {
        out.ignored.push({ id: g.id, viewId: view.id, name: g.name, reason: 'empty' });
        continue;
      }
    } else if (g.type !== 'free_elective' && g.role === 'overlay' && counting.length === 0 && !g.missingList && !hasNeed) {
      out.ignored.push({ id: g.id, viewId: view.id, name: g.name, reason: 'empty' });
      continue;
    }

    const free = g.type === 'free_elective';
    // Choice sets: indices refer to the unfiltered member list.
    const sets = new Map<string, string[]>();
    const setsOf = new Map<string, string[]>();
    for (const cs of g.choiceSets ?? []) {
      if (isPoolSet(cs.id)) continue;
      const codes = cs.members
        .map((i) => g.members[i])
        .filter((m): m is GradMember => !!m && m.cls !== 'hint' && !!m.code && (!m.intakes || m.intakes.includes(intake)))
        .map((m) => m.code as string);
      if (codes.length < 2) continue;
      sets.set(cs.id, codes);
      for (const c of codes) setsOf.set(c, [...(setsOf.get(c) ?? []), cs.id]);
    }
    const role = g.role as 'additive' | 'component' | 'overlay';
    const need = (g.cus ?? 0) > 0 ? (g.cus as number) : (g.minCourses ?? 0) > 0 ? (g.minCourses as number) : null;
    const unit: BlockUnit = (g.cus ?? 0) > 0 || free ? 'cu' : 'course';
    let pool = 'solo';
    if (free) pool = 'free';
    else if (need !== null) pool = second ? `second:${view.id}` : role === 'overlay' ? 'solo' : 'programme';
    out.drafts.push({
      g, lv, order, headings: pathOf(g), kind: free ? 'free' : 'list', role, unit, need,
      counting: named, hints, unnamed,
      listMissing: !free && (g.missingList || !!g.missingIntakes?.includes(intake) || counting.length === 0),
      sets, setsOf, pool, alloc: [], used: 0, setUsed: new Map(),
    });
  }
  return order;
}

/**
 * Open and finished blocks for the picked views. `views` carry their kind (degree, major, track, second). Rules:
 * - degree/major/track additive and component leaves share one pool: a completed course counts once there (most
 *   constrained first), leftovers fill free electives;
 * - overlays of those views are checked on their own, so a course can count for an overlay and for one additive block;
 * - each second-major view is a pool of its own; its overlay baskets are its blocks;
 * - alternative groups never count and are not returned as blocks; non-course rows go in `nonCourse`.
 */
// The dataset's choice_set means two things. Most are substitutions ("A or B": one course counts). Sets named for a
// track, an elective list or a CU minimum are pools, where several courses count, so they must not be treated as one-of.
export const isPoolSet = (id: string): boolean => /^track-|-electives$|-compulsory$|^at-least-|\s/.test(id);

export function deriveBlocks(rawViews: readonly LoadedView[], intake: string, completedCodes: Iterable<string>): DerivedBlocks {
  const views = applyTracks(rawViews, intake);
  const completed = new Set(completedCodes);
  const parts = { drafts: [] as Draft[], headings: [] as Heading[], placeholders: [] as Placeholder[], nonCourse: [] as NonCourseItem[], ignored: [] as IgnoredGroup[] };
  let order = 0;
  for (const lv of views) order = readView(lv, intake, order, parts);
  const { drafts } = parts;

  // Course CUs from any list that names it; unknown courses count 1.
  const cusByCode = new Map<string, number>();
  for (const d of drafts) for (const c of d.counting) if (!cusByCode.has(c.code)) cusByCode.set(c.code, c.cus);
  const cusFor = (code: string) => cusByCode.get(code) ?? 1;

  const pools = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.pool === 'solo' || d.pool === 'free') continue;
    pools.set(d.pool, [...(pools.get(d.pool) ?? []), d]);
  }
  for (const ds of pools.values()) allocate(ds, completed);
  for (const d of drafts) if (d.pool === 'solo' && d.kind === 'list') evaluateSolo(d, completed);

  // Free electives: completed courses that no additive/component block of the degree took.
  const taken = new Set((pools.get('programme') ?? []).flatMap((d) => d.alloc));
  const leftover = [...completed].filter((c) => !taken.has(c)).sort();
  let li = 0;
  for (const d of drafts.filter((x) => x.kind === 'free')) {
    while (li < leftover.length && (d.need === null || d.used < d.need - EPS)) {
      d.alloc.push(leftover[li]);
      d.used += cusFor(leftover[li]);
      li++;
    }
  }

  // Blocks
  const blocks: Block[] = drafts.map((d) => {
    const doneN = d.unit === 'cu' ? d.used : d.alloc.length;
    const done = d.need === null ? doneN : Math.min(doneN, d.need);
    const doneSet = new Set(d.alloc);
    const mandatoryLeft = d.counting.filter((c) => c.mandatory && !doneSet.has(c.code));
    const mandLeftN = d.unit === 'cu' ? mandatoryLeft.reduce((a, c) => a + c.cus, 0) : mandatoryLeft.length;
    let left: number | null = null;
    if (d.need !== null) left = Math.max(0, d.need - doneN, mandLeftN);
    const minCourses = d.g.minCourses ?? null;
    const coursesShort = d.unit === 'cu' && minCourses !== null ? Math.max(0, minCourses - d.alloc.length) : 0;
    if (left === 0 && coursesShort > 0) left = coursesShort;
    const complete = d.need === null
      ? d.kind === 'list' && d.alloc.length > 0
      : left === 0;
    const choiceSets: ChoiceSetState[] = [...d.sets].map(([id, codes]) => ({ id, codes, satisfiedBy: d.setUsed.get(id) ?? null }));
    const members: BlockMember[] = d.counting.map((c) => {
      const sats = (d.setsOf.get(c.code) ?? []).map((id) => d.setUsed.get(id));
      return {
        code: c.code, title: c.title, cus: c.cus, cls: c.cls, mandatory: c.mandatory,
        done: doneSet.has(c.code),
        setSatisfied: !doneSet.has(c.code) && sats.some((s) => s !== undefined),
      };
    });
    const usedElsewhere = d.pool === 'solo' ? [] : d.counting.filter((c) => completed.has(c.code) && !doneSet.has(c.code) && !setConflict(d, c.code)).map((c) => c.code);
    return {
      id: d.g.id, viewId: d.lv.view.id, viewKind: d.lv.kind, name: d.g.name, headings: d.headings, kind: d.kind, role: d.role,
      overlap: d.role === 'overlay' && d.lv.kind !== 'second',
      unit: d.unit, need: d.need, done, left, minCourses, complete,
      members, mandatoryLeft: mandatoryLeft.map((c) => c.code), doneCodes: [...d.alloc], usedElsewhere,
      unnamed: d.unnamed, hints: d.hints,
      mayCount: d.hints.filter((h) => completed.has(h.code) && !doneSet.has(h.code)).map((h) => h.code),
      choiceSets, listMissing: d.listMissing,
    };
  });

  // Parent CUs left = parent cus minus the CUs counted in the components below it (nested parents add up).
  const doneById = new Map(blocks.map((b) => [b.id + '@' + b.viewId, b.done]));
  const headById = new Map(parts.headings.map((h) => [h.id + '@' + h.viewId, h]));
  const countedOf = (h: Heading): number => h.childIds.reduce((a, cid) => {
    const key = cid + '@' + h.viewId;
    const sub = headById.get(key);
    return a + (sub ? countedOf(sub) : doneById.get(key) ?? 0);
  }, 0);
  for (const h of parts.headings) {
    h.counted = countedOf(h);
    h.cusLeft = h.cus === null ? null : Math.max(0, h.cus - h.counted);
  }

  // Placeholders: hidden when a selected major/track view (degree views) or a second-major list (second views) fills them.
  const hasMajorOrTrack = views.some((v) => v.kind === 'major' || v.kind === 'track');
  const secondHasLists = new Set(drafts.filter((d) => d.lv.kind === 'second' && d.kind === 'list' && d.counting.length > 0).map((d) => d.lv.view.id));
  const needsSelection = parts.placeholders.filter((p) =>
    p.needs === 'major-or-track' ? !hasMajorOrTrack : !secondHasLists.has(p.viewId));

  // Second majors: double counting against the first programme.
  const secondMajors: SecondMajorState[] = views.filter((v) => v.kind === 'second').map((lv) => {
    const own = pools.get(`second:${lv.view.id}`) ?? [];
    const codes = [...new Set(own.flatMap((d) => d.alloc))].sort();
    const sharedCodes = codes.filter((c) => taken.has(c));
    const sum = (cs: string[]) => cs.reduce((a, c) => a + cusFor(c), 0);
    const sharedCus = sum(sharedCodes);
    const notSharedCus = sum(codes.filter((c) => !taken.has(c)));
    const total = lv.view.totalCus > 0 ? lv.view.totalCus : own.reduce((a, d) => a + (d.need ?? 0), 0);
    const maxNotShared = Math.max(0, total - sharedCus);
    const min = lv.view.minNotShared ?? null;
    return {
      viewId: lv.view.id, name: lv.view.label, totalCus: total, minNotShared: min, sharedCus, sharedCodes, notSharedCus,
      maxNotShared, atRisk: min !== null && maxNotShared < min,
    };
  });

  return {
    open: blocks.filter((b) => !b.complete),
    finished: blocks.filter((b) => b.complete),
    headings: parts.headings,
    needsSelection,
    nonCourse: parts.nonCourse,
    secondMajors,
    ignored: parts.ignored,
  };
}
