// Chart builder query engine for one line: filter -> group by x -> aggregate -> points ready for Observable Plot. Pure and DOM-free.
// A line is one course narrowed by section, day, time of day or professor (lines.ts); the chart is one query per line, merged there.
//
// Rules
// - Filters combine with AND. `in` lists values as text (a missing category is NONE); an empty or absent `in` does not restrict.
//   A filter on an unknown field is ignored.
// - A missing category value is its own group (NONE, or the field's noneLabel), ordered last.
// - Numeric x: plotted at its exact value; rows with a missing x number are left out (totals.droppedNullX).
// - Aggregates ignore missing values. `ny` is how many rows had a value, `n` how many rows are in the group. A group with no values at all has
//   no y, so it is left out of the result (totals.emptyGroups).
// - Raw mode (scatter): one point per row {x, y, n: 1}, no aggregation; rows missing x (a number) or y are left out. Above `maxPoints`, every
//   k-th row is kept (totals.sampled).
import { fieldById, type Field, type Value } from './fields';
import type { BrowseRow } from '../browse';

export type Agg = 'median' | 'mean';

export const NONE = '(none)';
export const DEFAULT_MAX_POINTS = 20000;

export interface Filter {
  field: string;
  in?: string[];
}

export interface QuerySpec {
  x: string;
  /** A field id (a number). */
  y: string;
  agg: Agg;
  filters: Filter[];
  raw?: boolean;
  maxPoints?: number;
}

export interface QueryPoint {
  /** A category label (display text), or a number for a numeric x. */
  x: string | number;
  /** The category's raw value, for ordering across lines (absent for a numeric x). */
  xRaw?: Value;
  y: number;
  /** The line this point belongs to (set when lines are merged). */
  series?: string;
  n: number;
  /** Rows in the group that had a y value. */
  ny: number;
  /** The source row, raw mode only. */
  row?: BrowseRow;
}

export interface QueryTotals {
  rowsIn: number;
  rowsFiltered: number;
  /** Rows that ended up in a returned point. */
  rowsPlotted: number;
  droppedNullX: number;
  /** Raw mode: rows left out for a missing y. */
  droppedNullY: number;
  emptyGroups: number;
  sampled: boolean;
}

export interface QueryResult {
  points: QueryPoint[];
  /** Ordered labels (category) or ascending numbers (numeric x). */
  xDomain: (string | number)[];
  totals: QueryTotals;
}

export const emptyTotals = (): QueryTotals => ({ rowsIn: 0, rowsFiltered: 0, rowsPlotted: 0, droppedNullX: 0, droppedNullY: 0, emptyGroups: 0, sampled: false });

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(vals: number[], agg: Agg): number | null {
  if (!vals.length) return null;
  return agg === 'median' ? median(vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** A value as filter text. */
const asText = (v: Value): string => (v === null ? NONE : String(v));

export function applyFilters(rows: readonly BrowseRow[], filters: readonly Filter[]): BrowseRow[] {
  const fs: { f: Field; set: Set<string> }[] = [];
  for (const flt of filters) {
    const f = fieldById(flt.field);
    if (f && flt.in && flt.in.length) fs.push({ f, set: new Set(flt.in) });
  }
  return fs.length ? rows.filter((r) => fs.every(({ f, set }) => set.has(asText(f.get(r))))) : [...rows];
}

/** Orders x labels of a category field by the field's natural order, a missing value last. */
export function sortXLabels(f: Field, labels: Map<string, Value>): string[] {
  return [...labels.keys()].sort((a, b) => {
    const va = labels.get(a) ?? null;
    const vb = labels.get(b) ?? null;
    if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
    return va === null || vb === null ? 0 : f.compare(va, vb);
  });
}

export function runQuery(rows: readonly BrowseRow[], spec: QuerySpec): QueryResult {
  const filtered = applyFilters(rows, spec.filters);
  const totals: QueryTotals = { ...emptyTotals(), rowsIn: rows.length, rowsFiltered: filtered.length };
  const empty: QueryResult = { points: [], xDomain: [], totals };
  const xf = fieldById(spec.x);
  const yf = fieldById(spec.y);
  if (!xf || !yf || yf.kind !== 'number') return empty;

  const numericX = xf.kind === 'number';
  const plottable = numericX ? filtered.filter((r) => xf.get(r) !== null) : filtered;
  totals.droppedNullX = filtered.length - plottable.length;
  const none = xf.noneLabel ?? NONE;
  const xRaws = new Map<string, Value>();
  const xOf = (r: BrowseRow): string | number => {
    const v = xf.get(r);
    if (numericX) return v as number;
    if (v === null) { xRaws.set(none, null); return none; }
    const s = xf.fmt(v);
    xRaws.set(s, v);
    return s;
  };
  const rawOf = (x: string | number): Value | undefined => (numericX ? undefined : (xRaws.get(x as string) ?? null));
  const yOf = (r: BrowseRow): number | null => {
    const v = yf.get(r);
    return typeof v === 'number' ? v : null;
  };
  const domain = (used: Set<string | number>): (string | number)[] =>
    numericX ? [...used].sort((a, b) => (a as number) - (b as number)) : sortXLabels(xf, new Map([...used].map((x) => [x as string, xRaws.get(x as string) ?? null])));

  if (spec.raw) {
    const cap = spec.maxPoints ?? DEFAULT_MAX_POINTS;
    const stride = plottable.length > cap ? Math.ceil(plottable.length / cap) : 1;
    totals.sampled = stride > 1;
    const points: QueryPoint[] = [];
    const used = new Set<string | number>();
    for (let i = 0; i < plottable.length; i += stride) {
      const r = plottable[i];
      const y = yOf(r);
      if (y === null) { totals.droppedNullY++; continue; }
      const x = xOf(r);
      used.add(x);
      points.push({ x, xRaw: rawOf(x), y, n: 1, ny: 1, row: r });
    }
    totals.rowsPlotted = points.length;
    return { points, xDomain: domain(used), totals };
  }

  const groups = new Map<string | number, { n: number; vals: number[] }>();
  for (const r of plottable) {
    const x = xOf(r);
    let g = groups.get(x);
    if (!g) groups.set(x, (g = { n: 0, vals: [] }));
    g.n++;
    const y = yOf(r);
    if (y !== null) g.vals.push(y);
  }
  const points: QueryPoint[] = [];
  const used = new Set<string | number>();
  for (const [x, g] of groups) {
    const y = aggregate(g.vals, spec.agg);
    if (y === null) { totals.emptyGroups++; continue; }
    used.add(x);
    points.push({ x, xRaw: rawOf(x), y, n: g.n, ny: g.vals.length });
    totals.rowsPlotted += g.n;
  }
  const order = domain(used);
  const rank = new Map(order.map((x, i) => [x, i]));
  points.sort((a, b) => (rank.get(a.x) ?? 0) - (rank.get(b.x) ?? 0));
  return { points, xDomain: order, totals };
}

// ---- Choices for the UI

export interface ValueChoice {
  /** The text a filter's `in` takes. */
  value: string;
  /** What to show. */
  label: string;
  n: number;
}

/** Distinct values of a field in natural order, with row counts, as filter choices (a missing value is NONE, last). */
export function valueChoices(rows: readonly BrowseRow[], fieldId: string): ValueChoice[] {
  const f = fieldById(fieldId);
  if (!f) return [];
  const m = new Map<string, { v: Value; n: number }>();
  for (const r of rows) {
    const v = f.get(r);
    const k = asText(v);
    const e = m.get(k);
    if (e) e.n++;
    else m.set(k, { v, n: 1 });
  }
  return [...m]
    .sort(([ka, a], [kb, b]) => {
      if ((a.v === null) !== (b.v === null)) return a.v === null ? 1 : -1;
      return a.v === null || b.v === null ? 0 : f.compare(a.v, b.v) || ka.localeCompare(kb);
    })
    .map(([value, e]) => ({ value, label: e.v === null ? (f.noneLabel ?? NONE) : f.fmt(e.v), n: e.n }));
}
