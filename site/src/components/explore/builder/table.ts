// The aggregated result as a table (shown in the table view and for screen readers) and as CSV. Never raw rows beyond what is plotted.
import { fieldById } from './fields';
import { isRaw } from './controls';
import { fmtY, xLabel, yLabel } from './plan';
import { xText } from './plot';
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
  const raw = isRaw(spec);
  const xf = fieldById(spec.x);
  const heads = [
    ...(raw ? ['Section'] : []),
    xLabel(spec),
    ...(spec.color ? [fieldById(spec.color)?.label ?? 'Colour'] : []),
    ...(spec.facet ? [fieldById(spec.facet)?.label ?? 'Facet'] : []),
    yLabel(spec),
    ...(raw ? [] : ['n']),
  ];
  const body = result.points.slice(0, cap).map((p) => [
    ...(raw ? [p.row ? `${p.row.code} ${p.row.section}` : ''] : []),
    xText(p, xf),
    ...(spec.color ? [p.color ?? ''] : []),
    ...(spec.facet ? [p.facet ?? ''] : []),
    fmtY(spec, p.y),
    ...(raw ? [] : [String(p.n)]),
  ]);
  return { heads, body, more: result.points.length - body.length, nNum: raw ? 1 : 2 };
}

/** One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula is prefixed with an apostrophe. */
export function csvCell(v: string): string {
  const t = /^[=+\-@\t\r]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV is aggregated only: a raw chart (one point per section) has none. */
export const csvAllowed = (spec: BuilderSpec): boolean => !isRaw(spec);

/** CSV of the plotted points (every one, not the capped table). Empty for a raw chart. */
export function resultCsv(spec: BuilderSpec, result: QueryResult): string {
  if (!csvAllowed(spec)) return '';
  const t = resultTable(spec, result);
  return [t.heads, ...t.body].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
