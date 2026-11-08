// Chart builder query engine: filter -> group by x / colour / facet -> aggregate -> rows ready for Observable Plot. Pure and DOM-free.
//
// Rules
// - Filters combine with AND. `in` lists values as text (a bool is 'true' / 'false', a missing category is NONE); an empty or absent `in` does not restrict.
//   `min` / `max` (inclusive) apply to numbers and drop rows where the number is missing. A filter on an unknown field is ignored.
// - Categories: a missing value is its own group, NONE ("(none)"), ordered last. A number or bool used as colour / facet is grouped by its value.
// - Numeric x: plotted at its exact value, or in bins of width `bin` (x = bin start, x1 = bin end). Rows with a missing x number are left out (totals.droppedNullX).
// - Aggregates ignore missing values. `ny` is how many rows had a value, `n` how many rows are in the group. A group with no values at all has no
//   y, so it is left out of the result (totals.emptyGroups). `count` of the field 'count' is n; count of a field is ny. A bool counts as 1 / 0, so
//   sum is the number of true and pctTrue = 100 * mean. A category can only be counted; a number cannot use pctTrue (see coerceAgg).
// - Category cap: when x, colour or facet has more than its limit of groups, the groups with the most rows are kept (ties: natural order) and
//   the rest merge into OTHER ("Other"), which is aggregated like any group and ordered last. Not applied to x in raw mode.
// - Raw mode: one point per row {x, y, n: 1}, no aggregation; rows missing x (a number) or y are left out. Above `maxPoints`, every k-th row is kept (totals.sampled).
import { fieldById, type Field, type Value } from './fields';
import type { BrowseRow } from '../browse';

export type Agg = 'median' | 'mean' | 'min' | 'max' | 'sum' | 'count' | 'pctTrue';
export const AGGS: Agg[] = ['median', 'mean', 'min', 'max', 'sum', 'count', 'pctTrue'];
export type SortMode = 'x' | 'yAsc' | 'yDesc';
export const SORT_MODES: SortMode[] = ['x', 'yAsc', 'yDesc'];

export const NONE = '(none)';
export const OTHER = 'Other';
export const DEFAULT_LIMIT = 30;
export const DEFAULT_COLOR_LIMIT = 10;
export const DEFAULT_FACET_LIMIT = 12;
export const DEFAULT_MAX_POINTS = 20000;

export interface Filter {
  field: string;
  in?: string[];
  min?: number;
  max?: number;
}

export interface YSpec {
  /** A field id, or 'count' for the number of rows. */
  field: string;
  agg: Agg;
}

export interface QuerySpec {
  x: string;
  y: YSpec;
  color?: string;
  facet?: string;
  filters: Filter[];
  /** Bin width in the unit of a numeric x; ignored for other x. */
  bin?: number;
  raw?: boolean;
  /** Order of a category x (default 'x': natural). Numeric x is always ascending. */
  sort?: SortMode;
  /** Most x categories kept (default 30). */
  limit?: number;
  colorLimit?: number;
  facetLimit?: number;
  maxPoints?: number;
}

export interface QueryPoint {
  /** A category label (display text), or a number for a numeric x (bin start when binned). */
  x: string | number;
  /** Bin end, only when binned. */
  x1?: number;
  y: number;
  color?: string;
  facet?: string;
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
  groups: number;
  sampled: boolean;
  /** Groups merged into Other, per dimension (absent when nothing was merged). */
  capped: { x?: number; color?: number; facet?: number };
}

export interface QueryResult {
  points: QueryPoint[];
  /** Ordered labels (category) or ascending numbers (numeric x), Other last. */
  domains: { x: (string | number)[]; color: string[]; facet: string[] };
  totals: QueryTotals;
}

/** Aggregates a field supports: a category can only be counted, a number cannot take pctTrue, a bool takes pctTrue, sum (the count of true), mean and count. 'count' (rows) takes count only. */
export function allowedAggs(yField: string): Agg[] {
  if (yField === 'count') return ['count'];
  const f = fieldById(yField);
  if (!f) return [];
  if (f.kind === 'category') return ['count'];
  if (f.kind === 'number') return AGGS.filter((a) => a !== 'pctTrue');
  return ['pctTrue', 'sum', 'count', 'mean'];
}

/** The aggregate to use: `agg` if the field supports it, else the field's first allowed one (median for a number). */
export function coerceAgg(yField: string, agg: Agg): Agg {
  const ok = allowedAggs(yField);
  if (ok.includes(agg)) return agg;
  const f = fieldById(yField);
  return f?.kind === 'number' ? 'median' : (ok[0] ?? 'count');
}

// ---- Helpers

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aggregate(vals: number[], agg: Agg): number | null {
  if (!vals.length) return null;
  switch (agg) {
    case 'median': return median(vals);
    case 'mean': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min': return vals.reduce((a, b) => Math.min(a, b), Infinity);
    case 'max': return vals.reduce((a, b) => Math.max(a, b), -Infinity);
    case 'sum': return vals.reduce((a, b) => a + b, 0);
    case 'count': return vals.length;
    case 'pctTrue': return (100 * vals.reduce((a, b) => a + b, 0)) / vals.length;
  }
}

/** A value as filter text. */
const asText = (v: Value): string => (v === null ? NONE : String(v));

const numOf = (v: Value): number | null => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : null);

interface ActiveFilter {
  f: Field;
  flt: Filter;
  set: Set<string> | null;
}

function rowMatches(r: BrowseRow, fs: ActiveFilter[]): boolean {
  for (const { f, flt, set } of fs) {
    const v = f.get(r);
    if (set && !set.has(asText(v))) return false;
    if (flt.min !== undefined || flt.max !== undefined) {
      const x = numOf(v);
      if (x === null) return false;
      if (flt.min !== undefined && x < flt.min) return false;
      if (flt.max !== undefined && x > flt.max) return false;
    }
  }
  return true;
}

export function applyFilters(rows: readonly BrowseRow[], filters: readonly Filter[]): BrowseRow[] {
  const fs: ActiveFilter[] = [];
  for (const flt of filters) {
    const f = fieldById(flt.field);
    if (f) fs.push({ f, flt, set: flt.in && flt.in.length ? new Set(flt.in) : null });
  }
  return fs.length ? rows.filter((r) => rowMatches(r, fs)) : [...rows];
}

/** A grouping dimension: maps a row to a text key (display label) and remembers one raw value per key for ordering. */
class Dim {
  readonly raw = new Map<string, Value>();
  readonly counts = new Map<string, number>();
  private keep: Set<string> | null = null;
  merged = 0;
  constructor(readonly f: Field | undefined) {}

  /** Text of a missing value: the field's noneLabel, else NONE. */
  get none(): string {
    return this.f?.noneLabel ?? NONE;
  }

  /** Label of a row's value; undefined when there is no such dimension. */
  label(r: BrowseRow): string | undefined {
    if (!this.f) return undefined;
    const v = this.f.get(r);
    if (v === null) return this.none;
    const s = this.f.fmt(v);
    if (!this.raw.has(s)) this.raw.set(s, v);
    return s;
  }

  count(r: BrowseRow): void {
    const l = this.label(r);
    if (l !== undefined) this.counts.set(l, (this.counts.get(l) ?? 0) + 1);
  }

  compare = (a: string, b: string): number => {
    if (!this.f) return 0;
    const rank = (s: string) => (s === OTHER ? 2 : s === this.none ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a)) return 0;
    return this.f.compare(this.raw.get(a) as Value, this.raw.get(b) as Value);
  };

  /** Keep the `limit` labels with the most rows; the rest become Other. */
  cap(limit: number): void {
    if (this.counts.size <= limit) return;
    const top = [...this.counts].sort((a, b) => b[1] - a[1] || this.compare(a[0], b[0])).slice(0, limit).map((e) => e[0]);
    this.keep = new Set(top);
    this.merged = this.counts.size - limit;
  }

  key(r: BrowseRow): string | undefined {
    const l = this.label(r);
    return l === undefined || !this.keep || this.keep.has(l) ? l : OTHER;
  }

  domain(used: Set<string>): string[] {
    return [...used].sort(this.compare);
  }
}

interface Group {
  x: string | number;
  x1?: number;
  color?: string;
  facet?: string;
  n: number;
  vals: number[];
}

const binStart = (v: number, bin: number) => Number((Math.floor(v / bin + 1e-9) * bin).toFixed(10));

export function runQuery(rows: readonly BrowseRow[], spec: QuerySpec): QueryResult {
  const filtered = applyFilters(rows, spec.filters ?? []);
  const totals: QueryTotals = {
    rowsIn: rows.length, rowsFiltered: filtered.length, rowsPlotted: 0, droppedNullX: 0, droppedNullY: 0, emptyGroups: 0, groups: 0, sampled: false, capped: {},
  };
  const empty: QueryResult = { points: [], domains: { x: [], color: [], facet: [] }, totals };
  const xf = fieldById(spec.x);
  const raw = !!spec.raw;
  const yIsCount = spec.y.field === 'count';
  const yf = yIsCount ? undefined : fieldById(spec.y.field);
  if (!xf || (!yIsCount && !yf) || (raw && yIsCount)) return empty;

  const numericX = xf.kind === 'number';
  const bin = numericX && spec.bin && spec.bin > 0 ? spec.bin : 0;
  const xDim = new Dim(numericX ? undefined : xf);
  const cDim = new Dim(spec.color ? fieldById(spec.color) : undefined);
  const fDim = new Dim(spec.facet ? fieldById(spec.facet) : undefined);

  // Caps are decided on the rows that can be plotted, so a dropped null x does not take a slot.
  const plottable = numericX ? filtered.filter((r) => xf.get(r) !== null) : filtered;
  totals.droppedNullX = filtered.length - plottable.length;
  for (const r of plottable) {
    if (!raw) xDim.count(r);
    cDim.count(r);
    fDim.count(r);
  }
  if (!raw) xDim.cap(spec.limit ?? DEFAULT_LIMIT);
  cDim.cap(spec.colorLimit ?? DEFAULT_COLOR_LIMIT);
  fDim.cap(spec.facetLimit ?? DEFAULT_FACET_LIMIT);
  if (xDim.merged) totals.capped.x = xDim.merged;
  if (cDim.merged) totals.capped.color = cDim.merged;
  if (fDim.merged) totals.capped.facet = fDim.merged;

  const usedC = new Set<string>();
  const usedF = new Set<string>();
  const usedX = new Set<string>();
  const usedNum = new Set<number>();
  const xValue = (r: BrowseRow): string | number =>
    numericX ? (bin ? binStart(xf.get(r) as number, bin) : (xf.get(r) as number)) : (xDim.key(r) as string);

  // ---- Raw: one point per row
  if (raw) {
    const cap = spec.maxPoints ?? DEFAULT_MAX_POINTS;
    const stride = plottable.length > cap ? Math.ceil(plottable.length / cap) : 1;
    totals.sampled = stride > 1;
    const points: QueryPoint[] = [];
    for (let i = 0; i < plottable.length; i += stride) {
      const r = plottable[i];
      const y = numOf(yf!.get(r));
      if (y === null) { totals.droppedNullY++; continue; }
      const x = xValue(r);
      const p: QueryPoint = { x, y, n: 1, ny: 1, row: r };
      if (bin) p.x1 = (x as number) + bin;
      const c = cDim.key(r);
      const f = fDim.key(r);
      if (c !== undefined) { p.color = c; usedC.add(c); }
      if (f !== undefined) { p.facet = f; usedF.add(f); }
      if (numericX) usedNum.add(x as number); else usedX.add(x as string);
      points.push(p);
    }
    totals.rowsPlotted = points.length;
    totals.groups = points.length;
    return {
      points,
      domains: { x: numericX ? [...usedNum].sort((a, b) => a - b) : xDim.domain(usedX), color: cDim.domain(usedC), facet: fDim.domain(usedF) },
      totals,
    };
  }

  // ---- Aggregated
  const agg = coerceAgg(spec.y.field, spec.y.agg);
  const yOf = (r: BrowseRow): number | null => {
    if (yIsCount) return 1;
    const v = yf!.get(r);
    return yf!.kind === 'category' ? (v === null ? null : 1) : numOf(v);
  };
  const groups = new Map<string, Group>();
  const perX = new Map<string | number, { vals: number[]; n: number }>();
  for (const r of plottable) {
    const x = xValue(r);
    const c = cDim.key(r);
    const f = fDim.key(r);
    const k = `${f ?? ''}\u0000${c ?? ''}\u0000${typeof x}${x}`;
    let g = groups.get(k);
    if (!g) {
      g = { x, color: c, facet: f, n: 0, vals: [] };
      if (bin) g.x1 = (x as number) + bin;
      groups.set(k, g);
    }
    g.n++;
    let px = perX.get(x);
    if (!px) perX.set(x, (px = { vals: [], n: 0 }));
    px.n++;
    const y = yOf(r);
    if (y !== null) {
      g.vals.push(y);
      px.vals.push(y);
    }
  }

  const points: QueryPoint[] = [];
  for (const g of groups.values()) {
    const y = yIsCount ? g.n : aggregate(g.vals, agg);
    if (y === null) { totals.emptyGroups++; continue; }
    const p: QueryPoint = { x: g.x, y, n: g.n, ny: yIsCount ? g.n : g.vals.length };
    if (g.x1 !== undefined) p.x1 = g.x1;
    if (g.color !== undefined) { p.color = g.color; usedC.add(g.color); }
    if (g.facet !== undefined) { p.facet = g.facet; usedF.add(g.facet); }
    if (numericX) usedNum.add(g.x as number); else usedX.add(g.x as string);
    points.push(p);
    totals.rowsPlotted += g.n;
  }
  totals.groups = points.length;

  // x order: numeric ascending; category natural, or by the aggregate over all colours.
  let xDomain: (string | number)[];
  let xRank: (x: string | number) => number;
  if (numericX) {
    xDomain = [...usedNum].sort((a, b) => a - b);
    xRank = (x) => x as number;
  } else {
    let order = xDim.domain(usedX);
    if (spec.sort === 'yAsc' || spec.sort === 'yDesc') {
      const total = new Map<string, number>();
      for (const x of order) {
        const e = perX.get(x);
        total.set(x, yIsCount ? (e?.n ?? 0) : aggregate(e?.vals ?? [], agg) ?? -Infinity);
      }
      const d = spec.sort === 'yAsc' ? 1 : -1;
      const pinned = (s: string) => s === OTHER || s === xDim.none;
      order = [...order].sort((a, b) => (pinned(a) || pinned(b) ? xDim.compare(a, b) : (total.get(a)! - total.get(b)!) * d || xDim.compare(a, b)));
    }
    const pos = new Map(order.map((x, i) => [x, i]));
    xDomain = order;
    xRank = (x) => pos.get(x as string) ?? 0;
  }
  points.sort((a, b) => fDim.compare(a.facet ?? '', b.facet ?? '') || cDim.compare(a.color ?? '', b.color ?? '') || xRank(a.x) - xRank(b.x));
  return { points, domains: { x: xDomain, color: cDim.domain(usedC), facet: fDim.domain(usedF) }, totals };
}

// ---- Choices for the UI

export interface ValueChoice {
  /** The text a filter's `in` takes. */
  value: string;
  /** What to show. */
  label: string;
  n: number;
}

/** Distinct values of a field in natural order, with row counts, as filter choices (bool: 'true' / 'false'; missing: NONE, last). */
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
