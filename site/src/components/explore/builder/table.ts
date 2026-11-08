// The merged result as a table (shown for screen readers) and as CSV. CSV is the plotted points only, never source rows.
import { fieldById } from './fields';
import { fmtY, xLabel, yLabel } from './plan';
import { xText } from './plot';
import { isRawChart } from './lines';
import type { QueryResult } from './query';
import type { BuilderSpec } from './spec';

export interface ResultTable {
  heads: string[];
  body: string[][];
  /** Rows left out by `cap`. */
  more: number;
  /** How many trailing columns are numbers. */
  nNum: number;
}

export function resultTable(spec: BuilderSpec, result: QueryResult, cap = Infinity): ResultTable {
  const raw = isRawChart(spec);
  const xf = fieldById(spec.x);
  const heads = ['Line', ...(raw ? ['Section'] : []), xLabel(spec), yLabel(spec), ...(raw ? [] : ['n'])];
  const body = result.points.slice(0, cap).map((p) => [
    p.series ?? '',
    ...(raw ? [p.row ? `${p.row.term} ${p.row.code} ${p.row.section}` : ''] : []),
    xText(p, xf),
    fmtY(spec, p.y),
    ...(raw ? [] : [String(p.n)]),
  ]);
  return { heads, body, more: result.points.length - body.length, nNum: raw ? 2 : 3 };
}

/** One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
export function csvCell(v: string): string {
  const t = /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV is for the aggregated charts (Line, Bar); a Scatter plots one point per section, so it has none. */
export const csvAllowed = (spec: BuilderSpec): boolean => !isRawChart(spec);

/** CSV of the plotted points (every one, not the capped table): line, x, value, n. Empty for a Scatter. */
export function resultCsv(spec: BuilderSpec, result: QueryResult): string {
  if (!csvAllowed(spec)) return '';
  const t = resultTable(spec, result);
  return [t.heads, ...t.body].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
