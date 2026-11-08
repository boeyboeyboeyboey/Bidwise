import type { HistoryRow } from '../../lib/data/types';
import { formatSlot } from '../../lib/format/slot';

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
