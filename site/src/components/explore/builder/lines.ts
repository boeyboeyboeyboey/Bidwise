// Lines: each is a course plus optional narrowing, drawn as its own series. Maps a line to filters, names it, runs the query per line and merges
// the results into one. Pure and DOM-free.
import type { BrowseRow } from '../browse';
import { fieldById, type Value } from './fields';
import { emptyTotals, runQuery, sortXLabels, NONE, type Agg, type Filter, type QueryPoint, type QueryResult, type QuerySpec } from './query';
import { NARROW_KEYS, type BuilderSpec, type LineSpec, type NarrowKey } from './spec';

/** Line colours in order of the line, kept apart from each other (ink, blue-grey, tan, rose-brown, green, pink, violet, grey). */
export const LINE_COLORS = ['#23262b', '#5c7c99', '#a8895a', '#8b6a62', '#6f9a8c', '#b07a8f', '#7d7aa8', '#8a8f97'];
export const lineColor = (i: number): string => LINE_COLORS[i % LINE_COLORS.length];

/** A line is plotted once it has a course. */
export const hasCourse = (l: LineSpec): boolean => l.course !== '';

/** The filters of a line: its course, then each narrowing it sets. */
export function lineFilters(l: LineSpec): Filter[] {
  const out: Filter[] = [{ field: 'course', in: [l.course] }];
  for (const k of NARROW_KEYS) if (l[k]) out.push({ field: k, in: [l[k] as string] });
  return out;
}

/** The text of a narrowing value in a label ("(none)" of a missing time reads "No time set"). */
const valueText = (k: NarrowKey, v: string): string => (v === NONE ? (fieldById(k)?.noneLabel ?? NONE) : v);

/** "IS214", "IS214 · Mon", "IS214 · Mon · Morning · G1 · ANN LEE": the course, then the narrowing in day, time, section, professor order. */
export function lineLabel(l: LineSpec): string {
  return [l.course || 'New line', ...NARROW_KEYS.filter((k) => l[k]).map((k) => valueText(k, l[k] as string))].join(' · ');
}

/** Labels of all lines; a repeated label gets " (2)", " (3)" so every line is told apart. */
export function lineLabels(lines: readonly LineSpec[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = lineLabel(l);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Bids are summarised by their median, seats and percentages by their mean. */
export const aggFor = (y: string): Agg => (fieldById(y)?.unit === 'e$' ? 'median' : 'mean');

export const isRawChart = (s: BuilderSpec): boolean => s.chart === 'scatter';

/** The query of one line. */
export const queryFor = (s: BuilderSpec, l: LineSpec): QuerySpec => ({ x: s.x, y: s.y, agg: aggFor(s.y), raw: isRawChart(s), filters: lineFilters(l) });

export interface LinesResult extends QueryResult {
  /** Labels of the lines that have points, in line order. */
  series: string[];
  /** Colour of each series label. */
  colors: Map<string, string>;
}

/** Runs each line's query on the rows and merges: points carry the line's label as `series`, x labels are ordered by the X field across all lines. Lines with no course are skipped. */
export function runLines(rows: readonly BrowseRow[], s: BuilderSpec): LinesResult {
  const labels = lineLabels(s.lines);
  const totals = emptyTotals();
  const points: QueryPoint[] = [];
  const series: string[] = [];
  const colors = new Map<string, string>();
  const raws = new Map<string, Value>();
  const nums = new Set<number>();
  s.lines.forEach((l, i) => {
    if (!hasCourse(l)) return;
    const r = runQuery(rows, queryFor(s, l));
    colors.set(labels[i], lineColor(i));
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
      if (k === 'sampled') totals.sampled ||= r.totals.sampled;
      else totals[k] += r.totals[k];
    }
    if (!r.points.length) return;
    series.push(labels[i]);
    for (const p of r.points) {
      points.push({ ...p, series: labels[i] });
      if (typeof p.x === 'number') nums.add(p.x);
      else raws.set(p.x, p.xRaw ?? null);
    }
  });
  totals.rowsIn = rows.length;
  const xf = fieldById(s.x);
  const xDomain: (string | number)[] = nums.size ? [...nums].sort((a, b) => a - b) : xf ? sortXLabels(xf, raws) : [];
  const rank = new Map(xDomain.map((x, i) => [x, i]));
  const lineRank = new Map(series.map((n, i) => [n, i]));
  points.sort((a, b) => (lineRank.get(a.series ?? '') ?? 0) - (lineRank.get(b.series ?? '') ?? 0) || (rank.get(a.x) ?? 0) - (rank.get(b.x) ?? 0));
  return { points, xDomain, totals, series, colors };
}
