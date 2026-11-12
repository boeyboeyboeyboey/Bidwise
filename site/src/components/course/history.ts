import type { HistoryRow } from '../../lib/data/types';
import { formatSlot } from '../../lib/format/slot';
import { sameInstructor } from '../../lib/data/format';

/** Round windows first in natural order (Round 1 Window 1 ... Round 2A Window 3), special intakes after. */
export function sortWindows(ws: Iterable<string>): string[] {
  const key = (w: string) => (w.startsWith('Round') ? 0 : 1);
  return [...new Set(ws)].sort((a, b) => key(a) - key(b) || a.localeCompare(b, undefined, { numeric: true }));
}

export function sortTerms(ts: Iterable<string>): string[] {
  return [...new Set(ts)].sort();
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export interface TermPoint {
  term: string;
  rows: HistoryRow[];
  /** Mean of the rows' medians / lowest winning bids; null when nobody won. */
  median: number | null;
  min: number | null;
}

export function byTerm(rows: HistoryRow[]): TermPoint[] {
  const m = new Map<string, HistoryRow[]>();
  for (const r of rows) (m.get(r.term) ?? m.set(r.term, []).get(r.term)!).push(r);
  return sortTerms(m.keys()).map((term) => {
    const rs = m.get(term)!;
    const med = rs.map((r) => r.medianCents).filter((c): c is number => c !== null);
    const mn = rs.map((r) => r.minCents).filter((c): c is number => c !== null);
    return { term, rows: rs, median: med.length ? mean(med) : null, min: mn.length ? mean(mn) : null };
  });
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
  rows: HistoryRow[];
  /** Median of the sections' median bids; null when no section had one (nobody won). */
  median: number | null;
  /** Lowest winning bid of any section in the window; null when nobody won. */
  min: number | null;
}

/** One point per window for one term, in window order. `instructor` keeps only that instructor's sections. */
export function byWindow(rows: HistoryRow[], term: string, instructor: string | null = null): WindowPoint[] {
  const m = new Map<string, HistoryRow[]>();
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
export function termWithResults(rows: HistoryRow[], currentTerm: string, instructor: string | null = null): string | null {
  const own = rows.filter((r) => (!instructor || sameInstructor(r.instructor, instructor)) && r.term <= currentTerm);
  const newest = (rs: HistoryRow[]) => sortTerms(rs.map((r) => r.term)).pop() ?? null;
  return newest(own.filter((r) => r.medianCents !== null || r.minCents !== null)) ?? newest(own);
}
