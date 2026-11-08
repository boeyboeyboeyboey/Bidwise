import { band, type Row } from './rows';
import type { Dim, ExploreState, Metric, XField } from './state';

export type Unit = 'e$' | 'seats' | '%';

export const METRIC_META: Record<Metric, { label: string; unit: Unit; get: (r: Row) => number | null }> = {
  median: { label: 'Median bid', unit: 'e$', get: (r) => r.medianE },
  min: { label: 'Lowest winning bid', unit: 'e$', get: (r) => r.minE },
  offered: { label: 'Section seats', unit: 'seats', get: (r) => r.seatsOffered },
  left: { label: 'Seats left', unit: 'seats', get: (r) => r.seatsLeft },
  pfill: { label: 'Seats taken (%)', unit: '%', get: (r) => (r.filled ? 100 : 0) },
};

export const DIM_LABEL: Record<Dim, string> = {
  none: 'None', course: 'Course', section: 'Section', instructor: 'Instructor',
  day: 'Day', band: 'Timeslot', term: 'Term',
};
export const X_LABEL: Record<XField, string> = {
  tw: 'Term × window', term: 'Term', section: 'Section', instructor: 'Instructor',
  day: 'Day', band: 'Timeslot', course: 'Course',
};

export interface Fc {
  course: string; section: string; instructor: string; day: string; start: string;
  p10E: number; p50E: number; p90E: number; pFillPct: number;
}

export interface PlotRow {
  x: string;
  series: string;
  facet: string;
  layer: Metric;
  unit: Unit;
  y: number;
  /** y mapped onto the primary axis (differs from y on the secondary axis layer) */
  ys: number;
  n: number;
}
export interface FcRow {
  x: string; series: string; facet: string; layer: Metric;
  p50: number; lo: number; hi: number; p50s: number; los: number; his: number;
}
export interface Plotted {
  rows: PlotRow[];
  fc: FcRow[];
  series: string[];
  facets: string[];
  xs: string[];
  layers: Metric[];
  primary: Unit;
  secondary: Unit | null;
  /** primary-units per secondary-unit */
  k: number;
  mark: 'line' | 'dot' | 'bar' | 'area' | 'box';
  yMax: number;
}

type Keyed = { course: string; section: string; instructor: string; day: string; start: string; term?: string };

export function dimOf(r: Keyed, d: Dim): string {
  switch (d) {
    case 'none': return '';
    case 'course': return r.course;
    case 'section': return `${r.course} ${r.section}`;
    case 'instructor': return r.instructor;
    case 'day': return r.day;
    case 'band': return band(r.start);
    case 'term': return r.term ?? '';
  }
}

const xOf = (r: Row, x: XField): string =>
  x === 'tw' ? `${r.term} · ${r.window}` : x === 'term' ? r.term : dimOf(r, x);

/** Axis category of the forecast point: short, so it never overprints the last real term. */
export const FORECAST_X = 'Forecast';

export function fcX(x: XField, term: string, windowLabel: string): string | null {
  void term; void windowLabel;
  return x === 'tw' || x === 'term' ? FORECAST_X : null;
}

export const isTime = (x: XField) => x === 'tw' || x === 'term';
export const fcMetrics: Metric[] = ['median', 'pfill'];

export function filterRows(st: ExploreState, rows: Row[]): Row[] {
  return rows.filter((r) => {
    const sel = st.sel[r.course];
    if (!sel || !sel.includes(r.section)) return false;
    if (st.t0 && r.term < st.t0) return false;
    if (st.t1 && r.term > st.t1) return false;
    if (st.w && r.window !== st.w) return false;
    if (st.filled && !r.filled) return false;
    return true;
  });
}

const sortKey = (s: string) => s;
function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function compute(
  st: ExploreState,
  rows: Row[],
  fcs: Fc[],
  windowTerm: string,
  windowLabel: string,
): Plotted {
  const data = filterRows(st, rows);
  const layers = [st.metric, ...st.layers.filter((m) => m !== st.metric)];
  const primary = METRIC_META[layers[0]].unit;
  const secondary = layers.map((m) => METRIC_META[m].unit).find((u) => u !== primary) ?? null;
  const usable = layers.filter((m) => [primary, secondary].includes(METRIC_META[m].unit));
  const multi = usable.length > 1;
  const mark = st.mark === 'auto' ? (isTime(st.x) ? 'line' : 'bar') : st.mark;
  const sLabel = (r: Keyed, m: Metric) =>
    [dimOf(r, st.color), multi ? METRIC_META[m].label : ''].filter(Boolean).join(' · ') || METRIC_META[m].label;

  type Acc = { x: string; series: string; facet: string; layer: Metric; sum: number; n: number; list: number[] };
  const map = new Map<string, Acc>();
  const out: PlotRow[] = [];
  for (const m of usable) {
    const meta = METRIC_META[m];
    for (const r of data) {
      const series = sLabel(r, m);
      const facet = dimOf(r, st.facet);
      const x = xOf(r, st.x);
      const v = meta.get(r);
      if (v === null) continue;
      if (mark === 'box') {
        out.push({ x, series, facet, layer: m, unit: meta.unit, y: v, ys: v, n: 1 });
        continue;
      }
      const key = `${m}|${series}|${facet}|${x}`;
      const a = map.get(key) ?? { x, series, facet, layer: m, sum: 0, n: 0, list: [] };
      a.sum += v; a.n++; a.list.push(v);
      map.set(key, a);
    }
  }
  for (const a of map.values()) {
    // Bids: median across the grouped sections, so one outlier section does not move the course line.
    const unit = METRIC_META[a.layer].unit;
    const y = unit === 'e$' ? median(a.list) : a.sum / a.n;
    out.push({ x: a.x, series: a.series, facet: a.facet, layer: a.layer, unit: METRIC_META[a.layer].unit, y, ys: y, n: a.n });
  }

  // forecast overlay
  const fcRows: FcRow[] = [];
  const fx = st.fc && mark !== 'bar' && mark !== 'box' ? fcX(st.x, windowTerm, windowLabel) : null;
  if (fx) {
    const g = new Map<string, FcRow & { n: number }>();
    for (const m of usable.filter((m) => fcMetrics.includes(m))) {
      for (const f of fcs) {
        const sel = st.sel[f.course];
        if (!sel?.includes(f.section)) continue;
        const series = sLabel(f, m);
        const facet = dimOf(f, st.facet);
        const key = `${m}|${series}|${facet}`;
        const p50 = m === 'median' ? f.p50E : f.pFillPct;
        const lo = m === 'median' ? f.p10E : f.pFillPct;
        const hi = m === 'median' ? f.p90E : f.pFillPct;
        const e = g.get(key);
        if (e) { e.p50 += p50; e.lo += lo; e.hi += hi; e.n++; }
        else g.set(key, { x: fx, series, facet, layer: m, p50, lo, hi, p50s: 0, los: 0, his: 0, n: 1 });
      }
    }
    for (const e of g.values()) {
      fcRows.push({ ...e, p50: e.p50 / e.n, lo: e.lo / e.n, hi: e.hi / e.n });
    }
  }

  // x ordering
  const xset = [...new Set(out.map((r) => r.x))];
  if (isTime(st.x)) xset.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  else xset.sort();
  const xs = fx && fcRows.length ? [...xset, fx] : xset;

  // dual axis scaling
  const maxOf = (u: Unit) =>
    Math.max(0, ...out.filter((r) => r.unit === u).map((r) => r.y), ...fcRows.filter((r) => METRIC_META[r.layer].unit === u).map((r) => r.hi));
  const pMax = maxOf(primary) || 1;
  const k = secondary ? pMax / (maxOf(secondary) || 1) : 1;
  const scale = (u: Unit) => (u === primary ? 1 : k);
  for (const r of out) r.ys = r.y * scale(r.unit);
  for (const r of fcRows) {
    const s = scale(METRIC_META[r.layer].unit);
    r.p50s = r.p50 * s; r.los = r.lo * s; r.his = r.hi * s;
  }

  const series = [...new Set([...out.map((r) => r.series), ...fcRows.map((r) => r.series)])].sort();
  const facets = [...new Set(out.map((r) => r.facet))].sort();
  const yMax = Math.max(pMax, ...fcRows.map((r) => r.his), ...out.map((r) => r.ys));
  return { rows: out, fc: fcRows, series, facets, xs, layers: usable, primary, secondary, k, mark, yMax };
}

export function fmtUnit(u: Unit, v: number): string {
  if (u === 'e$') return v.toFixed(2);
  if (u === '%') return `${Math.round(v)}%`;
  return String(Math.round(v * 100) / 100);
}
