import type { HistoryRow, HistoryRowLite } from '../../lib/data/types';
import { formatSlot } from '../../lib/format/slot';
import { sameInstructor } from '../../lib/data/format';

/** Round windows first in natural order (Round 1 Window 1 ... Round 2A Window 3), special intakes after. */
export function sortWindows(ws: Iterable<string>): string[] {
  const key = (w: string) => (w.startsWith('Round') ? 0 : 1);
  return [...new Set(ws)].sort((a, b) => key(a) - key(b) || a.localeCompare(b, undefined, { numeric: true }));
}

/** A history row where somebody won a seat: a lowest or median bid is present. */
export const hasBids = (r: HistoryRowLite): boolean => r.medianCents !== null || r.minCents !== null;

/** A window needs at least this many past results with bids before the past-results page opens on it. */
export const MIN_WINDOW_RESULTS = 3;

/**
 * The window the past-results page opens on: the latest window, at or before the current one in window order, where at least
 * MIN_WINDOW_RESULTS of `rows` (already filtered to the series on screen) have bids, so the page never opens on a chart with
 * one lonely point. '' means all windows, when no single window qualifies.
 */
export function defaultHistoryWindow(rows: HistoryRowLite[], currentWindow: string): string {
  const count = new Map<string, number>();
  for (const r of rows) if (hasBids(r)) count.set(r.window, (count.get(r.window) ?? 0) + 1);
  const order = sortWindows([...count.keys(), currentWindow]);
  const upTo = order.slice(0, order.indexOf(currentWindow) + 1);
  return upTo.reverse().find((w) => (count.get(w) ?? 0) >= MIN_WINDOW_RESULTS) ?? '';
}

export function sortTerms(ts: Iterable<string>): string[] {
  return [...new Set(ts)].sort();
}

/** What HistoryPanel needs to open on its default view before the course's full history has loaded. */
export interface HistorySeed {
  /** Only the rows of the default window (every window when `win` is ''). */
  rows: HistoryRowLite[];
  /** Every window in the full history, for the Window menu. */
  windows: string[];
  hasMine: boolean;
  scope: 'instructor' | 'course';
  win: string;
}

/** Embedding more than this many bytes of rows in the page costs more than it gains; the page then loads the history as before. */
const SEED_MAX_BYTES = 120_000;

/**
 * The default view of the past-results panel, worked out the same way the panel does it (same instructor when that
 * instructor has rows, else the whole course; then defaultHistoryWindow), carrying only the rows that view shows. Null when
 * the view needs too many rows to embed.
 */
export function historySeed(history: HistoryRow[], instructor: string | null, currentWindow: string): HistorySeed | null {
  const mine = (r: HistoryRowLite) => !!instructor && sameInstructor(r.instructor, instructor);
  const hasMine = history.some(mine);
  const scope = hasMine ? 'instructor' : 'course';
  const win = defaultHistoryWindow(scope === 'instructor' ? history.filter(mine) : history, currentWindow);
  const rows = history.filter((r) => !win || r.window === win).map((r): HistoryRowLite => ({
    term: r.term, window: r.window, section: r.section, instructor: r.instructor, days: r.days, start: r.start, end: r.end,
    medianCents: r.medianCents, minCents: r.minCents, vacancy: r.vacancy, after: r.after,
  }));
  if (JSON.stringify(rows).length > SEED_MAX_BYTES) return null;
  return { rows, windows: sortWindows(history.map((r) => r.window)), hasMine, scope, win };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface TermPoint {
  term: string;
  rows: HistoryRowLite[];
  /** Mean of the rows' medians / lowest winning bids; null when nobody won. */
  median: number | null;
  min: number | null;
}

export function byTerm(rows: HistoryRowLite[]): TermPoint[] {
  const m = new Map<string, HistoryRowLite[]>();
  for (const r of rows) (m.get(r.term) ?? m.set(r.term, []).get(r.term)!).push(r);
  return sortTerms(m.keys()).map((term) => {
    const rs = m.get(term)!;
    const med = rs.map((r) => r.medianCents).filter((c): c is number => c !== null);
    const mn = rs.map((r) => r.minCents).filter((c): c is number => c !== null);
    return { term, rows: rs, median: med.length ? mean(med) : null, min: mn.length ? mean(mn) : null };
  });
}

/** Share of a term band left empty on each side, so neighbouring terms' windows never touch. */
export const BAND_PAD = 0.15;

/** Width of one term band when `termCount` bands share the plot from `x0` to `x1`. */
export const bandWidth = (x0: number, x1: number, termCount: number): number => (x1 - x0) / Math.max(termCount, 1);

/**
 * X of window slot `slotIdx` inside term band `termIdx`. The band is split into `slotCount` equal slots after `pad` is cut off
 * each side, and the point sits at the slot's centre, so one slot sits at the band's centre.
 */
export function bandX(termIdx: number, termCount: number, slotIdx: number, slotCount: number, x0: number, x1: number, pad = BAND_PAD): number {
  const bw = bandWidth(x0, x1, termCount);
  const slotW = (bw * (1 - 2 * pad)) / Math.max(slotCount, 1);
  return x0 + termIdx * bw + bw * pad + (slotIdx + 0.5) * slotW;
}

/** Narrowest slot, in px, at which the dots of neighbouring windows still read as separate points. */
export const MIN_SLOT_PX = 8;

/** Whether a term can be drawn as a band of window slots: several slots, each at least MIN_SLOT_PX wide. Otherwise one point per term. */
export function useBands(plotWidth: number, termCount: number, slotCount: number): boolean {
  if (slotCount < 2 || termCount < 1) return false;
  return (bandWidth(0, plotWidth, termCount) * (1 - 2 * BAND_PAD)) / slotCount >= MIN_SLOT_PX;
}

/**
 * Indices of the term labels to draw when neighbouring label centres are `spacing` px apart: every k-th term for the smallest k
 * that leaves `gap` px between labels `labelWidth` px wide, counted back from the last term so it is always shown.
 */
export function labelIndices(count: number, spacing: number, labelWidth = 52, gap = 8): number[] {
  const k = spacing > 0 ? Math.max(1, Math.ceil((labelWidth + gap) / spacing)) : count;
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= k) out.unshift(i);
  return out;
}

export interface TimelineCell {
  term: string;
  termIdx: number;
  window: string;
  slotIdx: number;
  rows: HistoryRowLite[];
  /** Mean of the rows' medians / lowest winning bids, as for a term point; null when nobody won. */
  median: number | null;
  min: number | null;
}

/**
 * Every (term, window) with rows, in time order: term order, then slot order. `slots` is every window present in `rows` in
 * `sortWindows` order, so a window has the same slot in every term and a missing one leaves its slot empty.
 */
export function windowTimeline(rows: HistoryRowLite[]): { terms: string[]; slots: string[]; cells: TimelineCell[] } {
  const terms = sortTerms(rows.map((r) => r.term));
  const slots = sortWindows(rows.map((r) => r.window));
  const cells: TimelineCell[] = [];
  terms.forEach((term, termIdx) => {
    slots.forEach((window, slotIdx) => {
      const rs = rows.filter((r) => r.term === term && r.window === window);
      if (!rs.length) return;
      const { median, min } = byTerm(rs)[0];
      cells.push({ term, termIdx, window, slotIdx, rows: rs, median, min });
    });
  });
  return { terms, slots, cells };
}

/** "Mon" / "MON; THU" -> "Mon, Thu". Still used by the planner for single meeting days. */
export const dayText = (d: string): string =>
  d.split(/[\s;,]+/).filter(Boolean).map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(', ');

/** A history row's day and time as text ("Mon, Thu 08:15–09:45"), or "Time not set". Rows join days as "MON; THU". */
export const timeText = (days: string, start: string, end: string): string => formatSlot({ days, start, end }) || 'Time not set';

/** Axis label for a window: "Round 1 Window 1" -> "Rnd 1", "Round 2 Window 2" -> "Rnd 2 W2", "Round 1A Window 2" -> "1A W2", "Incoming Exchange Rnd 1C Win 2" -> "IE 1C W2". Anything else is unchanged. */
export function shortWindow(w: string): string {
  const m = /^Round (\w+) Window (\d+)$/.exec(w);
  if (m) return /^\d+$/.test(m[1]) ? `Rnd ${m[1]}${m[2] === '1' ? '' : ` W${m[2]}`}` : `${m[1]} W${m[2]}`;
  const i = /^Incoming (Exchange|Freshmen) Rnd (\w+) Win (\d+)$/.exec(w);
  if (i) return `${i[1] === 'Exchange' ? 'IE' : 'IF'} ${i[2]} W${i[3]}`;
  return w;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export interface WindowPoint {
  window: string;
  rows: HistoryRowLite[];
  /** Median of the sections' median bids; null when no section had one (nobody won). */
  median: number | null;
  /** Lowest winning bid of any section in the window; null when nobody won. */
  min: number | null;
}

/** One point per window for one term, in window order. `instructor` keeps only that instructor's sections. */
export function byWindow(rows: HistoryRowLite[], term: string, instructor: string | null = null): WindowPoint[] {
  const m = new Map<string, HistoryRowLite[]>();
  for (const r of rows) {
    if (r.term !== term || (instructor && !sameInstructor(r.instructor, instructor))) continue;
    (m.get(r.window) ?? m.set(r.window, []).get(r.window)!).push(r);
  }
  return sortWindows(m.keys()).map((window) => {
    const rs = m.get(window)!;
    const med = rs.map((r) => r.medianCents).filter((c): c is number => c !== null);
    const mn = rs.map((r) => r.minCents).filter((c): c is number => c !== null);
    return { window, rows: rs, median: med.length ? median(med) : null, min: mn.length ? Math.min(...mn) : null };
  });
}

/**
 * The newest term, up to the current one, with at least one winning bid for this filter; failing that, the newest with any rows
 * (so a current term where nobody has won yet gives way to an earlier one with prices). Null when there are none.
 */
export function termWithResults(rows: HistoryRowLite[], currentTerm: string, instructor: string | null = null): string | null {
  const own = rows.filter((r) => (!instructor || sameInstructor(r.instructor, instructor)) && r.term <= currentTerm);
  const newest = (rs: HistoryRowLite[]) => sortTerms(rs.map((r) => r.term)).pop() ?? null;
  return newest(own.filter((r) => r.medianCents !== null || r.minCents !== null)) ?? newest(own);
}
