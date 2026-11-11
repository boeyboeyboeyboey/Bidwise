// Pure helpers for the home page's "I don't know what to take": option lists for the selects, grouping and wording
// of result blocks, and the saved-on-this-device record. No DOM, no fetch.
import { findDegree } from '../../lib/gradreq';
import type { Block, Candidate, CandidateResult, GradIndex, IndexDegree, IndexTrack, Intake, LoadedView, Selection } from '../../lib/gradreq';

export interface Option { value: string; label: string }

export const STORE_KEY = 'bidwise.take';
export const DEFAULT_BID_EUROS = '30';
const MAX_BID_CENTS = 100_000;

/** The intakes the degree has a view for, in the index's order. */
export function intakesFor(index: GradIndex, degree: IndexDegree | null): Intake[] {
  return degree ? index.intakes.filter((i) => degree.views[i]) : [];
}

export const majorOptions = (degree: IndexDegree | null, intake: Intake): Option[] =>
  (degree?.majors ?? []).filter((m) => m.views[intake]).map((m) => ({ value: m.id, label: m.name }));

/** Tracks under the chosen major plus the degree's own, as pickViews resolves them. */
export function trackOptions(degree: IndexDegree | null, major: string, intake: Intake): Option[] {
  const pool: IndexTrack[] = [...(degree?.majors?.find((m) => m.id === major)?.tracks ?? []), ...(degree?.tracks ?? [])];
  return pool.filter((t) => t.views[intake]).map((t) => ({ value: t.id, label: t.name }));
}

const SEP = '|';
const VIEW_SEP = '@';
export const secondValue = (id: string, variant?: string): string => (variant ? `${id}${SEP}${variant}` : id);
const viewValue = (id: string, viewId: string): string => `${id}${VIEW_SEP}${viewId}`;
export function splitSecond(value: string): { id: string; variant?: string; view?: string } {
  const at = value.indexOf(VIEW_SEP);
  if (at >= 0) return { id: value.slice(0, at), view: value.slice(at + 1) };
  const i = value.indexOf(SEP);
  return i < 0 ? { id: value } : { id: value.slice(0, i), variant: value.slice(i + 1) };
}

/**
 * Programme names of sibling second majors, which the data only carries inside the view id
 * (p4-soss-ga-bsc-cs-ay2022). A programme not listed here is named by the id token that tells it from its siblings.
 */
export const SIBLING_NAMES: Readonly<Record<string, string>> = {
  ga: 'Global Asia',
  pppm: 'Public Policy and Public Management',
  ada: 'Accounting Data and Analytics',
  ff: 'Financial Forensics',
  ssoc: 'Sustainable Societies',
};
const NOT_A_NAME = new Set(['is', 'smt', 'cs', 'bsc', 'mjr', 'se', 'wsdeg', 'c', 'and', 'l']);
/** Known programme name, else the upper-cased id token that tells this entry from its siblings ("SSOC"). */
function siblingName(viewId: string, all: readonly string[]): string {
  const tokens = viewId.split('-');
  const known = tokens.map((t) => SIBLING_NAMES[t]).find(Boolean);
  if (known) return known;
  const sets = all.map((x) => new Set(x.split('-')));
  const own = tokens.find((t) => !NOT_A_NAME.has(t) && !/^(p4|ay\d+)$/.test(t) && sets.some((o) => !o.has(t)));
  return own ? own.toUpperCase() : viewId;
}

/**
 * Second majors of the home degree that have a view for the intake.
 * - One entry: listed once.
 * - Several entries that differ only by variant (IS / SMT): one option per variant.
 * - Sibling programmes (two entries share a variant, e.g. Global Asia and Public Policy under one degree): one option
 *   per entry, named by its programme, so exactly one view is ever loaded.
 */
export function secondOptions(index: GradIndex, degreeId: string, intake: Intake): Option[] {
  const degree = findDegree(index, degreeId);
  const out: Option[] = [];
  for (const sm of degree?.secondMajors ?? []) {
    const entries = sm.views[intake] ?? [];
    if (!entries.length || sm.name.startsWith('Other ')) continue;
    const variants = entries.map((e) => e.variant ?? '');
    if (entries.length === 1) {
      out.push({ value: secondValue(sm.id), label: sm.name });
    } else if (new Set(variants).size === entries.length) {
      for (const e of entries) out.push({ value: secondValue(sm.id, e.variant), label: e.variant ? `${sm.name} (${e.variant})` : sm.name });
    } else {
      const ids = entries.map((e) => e.id);
      entries.forEach((e) => {
        const prog = siblingName(e.id, ids);
        out.push({ value: viewValue(sm.id, e.id), label: `${sm.name}: ${prog}${e.variant ? ` (${e.variant})` : ''}` });
      });
    }
  }
  return out;
}

/** The Selection pickViews takes, from the form's string values. */
export function toSelection(f: { degree: string; intake: string; major: string; track: string; second: string }): Selection {
  const sel: Selection = { degree: f.degree, intake: f.intake };
  if (f.major) sel.major = f.major;
  if (f.track) sel.track = f.track;
  if (f.second) {
    const s = splitSecond(f.second);
    sel.secondMajor = s.id;
    if (s.variant) sel.secondVariant = s.variant;
    if (s.view) sel.secondView = s.view;
  }
  return sel;
}

// ---------------------------------------------------------------- results

export interface BlockGroup { key: string; label: string; blocks: Block[] }

/** Blocks under their parent headings, in first-seen order. A block with no parent heading goes under its view's name. */
export function groupBlocks(blocks: readonly Block[], viewLabel: (viewId: string) => string): BlockGroup[] {
  const groups = new Map<string, BlockGroup>();
  for (const b of blocks) {
    const key = `${b.viewId}\u0000${b.headings.join('\u0000')}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label: b.headings.length ? b.headings.join(' › ') : viewLabel(b.viewId), blocks: [] }));
    g.blocks.push(b);
  }
  return [...groups.values()];
}

/** "6 CUs left", "2 courses left", or '' when the data states no quantity. */
export function leftText(b: Pick<Block, 'left' | 'unit'>): string {
  if (b.left === null) return '';
  const n = Math.round(b.left * 100) / 100;
  return b.unit === 'cu' ? `${n} ${n === 1 ? 'CU' : 'CUs'} left` : `${n} ${n === 1 ? 'course' : 'courses'} left`;
}

/** Courses that can be bid for now, apart from the ones whose every section is full. */
export function splitCandidates(r: CandidateResult): { open: Candidate[]; fullCount: number } {
  const open = r.candidates.filter((c) => c.sections.length > 0);
  return { open, fullCount: r.candidates.length - open.length };
}

/**
 * The block's raw group has pool sets named for a track (`track-*`): several courses count, but all from one track.
 * deriveBlocks leaves pool sets out of Block.choiceSets, so this reads the loaded view.
 */
export function isTrackBlock(b: Pick<Block, 'id' | 'viewId'>, views: readonly LoadedView[]): boolean {
  const g = views.find((v) => v.view.id === b.viewId)?.view.groups.find((x) => x.id === b.id);
  return !!g?.choiceSets?.some((s) => s.id.startsWith('track-'));
}

/** The section a row shows: the best chance, or for "Cheapest" the lowest bid. */
export function shownSection(c: Candidate, sort: 'chance' | 'cheapest') {
  if (sort === 'cheapest') {
    const priced = c.sections.filter((s) => s.bidCents !== null);
    if (priced.length) return priced.reduce((a, s) => ((s.bidCents as number) < (a.bidCents as number) ? s : a));
  }
  return c.sections[0];
}

// ---------------------------------------------------------------- inputs

/** Euros typed into the bid box -> cents, or null when it is not a usable amount (0 to 1000, at most 2 decimals). */
export function parseBidCents(text: string): number | null {
  const t = text.trim().replace(/^e?\$\s*/i, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents > 0 && cents <= MAX_BID_CENTS ? cents : null;
}

export interface Saved {
  school: string; degree: string; intake: string; major: string; track: string; second: string;
  completed: string[]; bid: string; sort: 'chance' | 'cheapest';
}

export const emptySaved = (): Saved => ({
  school: '', degree: '', intake: '', major: '', track: '', second: '', completed: [], bid: DEFAULT_BID_EUROS, sort: 'chance',
});

/** Reads the stored text defensively: anything unexpected falls back to the default for that field. */
export function parseSaved(raw: string | null): Saved {
  const out = emptySaved();
  if (!raw) return out;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!o || typeof o !== 'object') return out;
  const r = o as Record<string, unknown>;
  for (const k of ['school', 'degree', 'intake', 'major', 'track', 'second'] as const) if (typeof r[k] === 'string') out[k] = r[k] as string;
  if (Array.isArray(r.completed)) out.completed = [...new Set(r.completed.filter((c): c is string => typeof c === 'string' && c.length < 20))].slice(0, 300);
  if (typeof r.bid === 'string' && parseBidCents(r.bid) !== null) out.bid = r.bid;
  if (r.sort === 'cheapest') out.sort = 'cheapest';
  return out;
}

export const percent = (x: number): string => `${Math.round(x * 100)}%`;
