// The chart builder's full state: the query (query.ts) plus how to draw it, with defaults, validation and a compact versioned URL form.
// Pure and DOM-free. The URL shares the Past bids query string, so `v=build` picks the mode and every other key starts with `k`
// (the Compare and Browse modes use other keys).
//
// How the UI should read a spec: `x` is the category or number on the horizontal axis (vertical when `swap`), `y` the aggregated value.
// `color` splits series (stackedBar stacks them, line/area/dot/bar draw one per colour). `facet` makes small multiples.
// heatmap: x by `color` as the second axis, the cell colour is y. box and scatter plot raw rows (`raw` is forced on); table lists the aggregated rows.
import { fieldById, isFieldId } from './fields';
import { AGGS, coerceAgg, DEFAULT_COLOR_LIMIT, DEFAULT_FACET_LIMIT, DEFAULT_LIMIT, SORT_MODES, type Agg, type Filter, type QuerySpec, type SortMode } from './query';

export type ChartType = 'bar' | 'stackedBar' | 'line' | 'area' | 'dot' | 'scatter' | 'box' | 'heatmap' | 'table';
export const CHART_TYPES: ChartType[] = ['bar', 'stackedBar', 'line', 'area', 'dot', 'scatter', 'box', 'heatmap', 'table'];

export interface BuilderSpec extends QuerySpec {
  chart: ChartType;
  /** Log scale on the value axis. */
  log: boolean;
  /** Start the value axis at zero. */
  zero: boolean;
  /** Put x on the vertical axis. */
  swap: boolean;
}

export const SPEC_VERSION = '1';

/** Chart types that need one point per row (raw is forced on) and those that need aggregation (raw is forced off). dot and table take either. */
export const chartNeedsRaw = (c: ChartType): boolean | null => (c === 'scatter' || c === 'box' ? true : c === 'dot' || c === 'table' ? null : false);

export const defaultSpec = (): BuilderSpec => ({
  x: 'window',
  y: { field: 'median', agg: 'median' },
  filters: [],
  chart: 'bar',
  log: false,
  zero: true,
  swap: false,
});

const pick = <T extends string>(v: unknown, all: readonly T[]): T | undefined =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : undefined;

const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined);

function cleanFilter(f: Partial<Filter> | undefined): Filter | null {
  if (!f || typeof f.field !== 'string' || !isFieldId(f.field)) return null;
  const out: Filter = { field: f.field };
  if (Array.isArray(f.in)) {
    const vals = [...new Set(f.in.filter((v): v is string => typeof v === 'string' && v !== ''))];
    if (vals.length) out.in = vals;
  }
  if (typeof f.min === 'number' && Number.isFinite(f.min)) out.min = f.min;
  if (typeof f.max === 'number' && Number.isFinite(f.max)) out.max = f.max;
  return out.in || out.min !== undefined || out.max !== undefined ? out : null;
}

/** A valid spec from anything shaped like one: unknown fields, agg values and chart types fall back to the defaults, empty filters are dropped, and
 *  raw / bin / agg are made consistent with the chart and fields. Idempotent. */
export function normalizeSpec(input: Partial<BuilderSpec> | undefined): BuilderSpec {
  const d = defaultSpec();
  const s = input ?? {};
  const field = (v: unknown) => (typeof v === 'string' && isFieldId(v) ? v : undefined);
  const x = field(s.x) ?? d.x;
  const yField = typeof s.y?.field === 'string' && (s.y.field === 'count' || isFieldId(s.y.field)) ? s.y.field : d.y.field;
  const yAgg = coerceAgg(yField, pick(s.y?.agg, AGGS) ?? (yField === d.y.field ? d.y.agg : 'median'));
  const chart = pick(s.chart, CHART_TYPES) ?? d.chart;
  const forced = chartNeedsRaw(chart);
  const out: BuilderSpec = {
    x,
    y: { field: yField, agg: yAgg },
    filters: (s.filters ?? []).map(cleanFilter).filter((f): f is Filter => f !== null),
    chart,
    log: s.log === true,
    zero: s.zero === undefined ? d.zero : s.zero === true,
    swap: s.swap === true,
  };
  const color = field(s.color);
  const facet = field(s.facet);
  if (color) out.color = color;
  if (facet) out.facet = facet;
  if (typeof s.bin === 'number' && Number.isFinite(s.bin) && s.bin > 0 && fieldById(x)?.kind === 'number') out.bin = s.bin;
  const raw = forced ?? s.raw === true;
  if (raw) out.raw = true;
  const sort = pick(s.sort, SORT_MODES);
  if (sort && sort !== 'x') out.sort = sort;
  if (posInt(s.limit) && s.limit !== DEFAULT_LIMIT) out.limit = s.limit;
  if (posInt(s.colorLimit) && s.colorLimit !== DEFAULT_COLOR_LIMIT) out.colorLimit = s.colorLimit;
  if (posInt(s.facetLimit) && s.facetLimit !== DEFAULT_FACET_LIMIT) out.facetLimit = s.facetLimit;
  return out;
}

// ---- URL

// Filters are written as `kq=field:a|b:min:max`. Only `%`, `:` and `|` are escaped (the URL layer escapes the rest once), and a term is
// shortened to a code ("2025-26 Term 1" is 2526T1). Links from before the change use `kw=field:a,b:min:max` (values escaped twice, full term
// names); they still decode.
const esc = (v: string) => v.replace(/[%:|]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const TERM_FULL = /^20(\d\d)-(\d\d) Term (\w+)$/;
const TERM_CODE = /^(\d\d)(\d\d)T(\w+)$/;
/** "2025-26 Term 1" to "2526T1"; anything else is unchanged. */
export const shortTerm = (t: string): string => t.replace(TERM_FULL, '$1$2T$3');
/** The inverse of shortTerm; a full name or any other text is unchanged. */
export const longTerm = (t: string): string => t.replace(TERM_CODE, '20$1-$2 Term $3');

const filterToken = (f: Filter): string =>
  [f.field, (f.in ?? []).map((v) => esc(f.field === 'term' ? shortTerm(v) : v)).join('|'), f.min === undefined ? '' : String(f.min), f.max === undefined ? '' : String(f.max)].join(':');

function filterFromToken(t: string, sep: string): Filter | null {
  const parts = t.split(':');
  if (parts.length !== 4) return null;
  const [field, list, min, max] = parts;
  const f: Partial<Filter> = { field };
  if (list) {
    try {
      f.in = list.split(sep).map((v) => (field === 'term' ? longTerm(decodeURIComponent(v)) : decodeURIComponent(v)));
    } catch {
      return null;
    }
  }
  if (min !== '' && Number.isFinite(Number(min))) f.min = Number(min);
  if (max !== '' && Number.isFinite(Number(max))) f.max = Number(max);
  return cleanFilter(f);
}

/** Query string for a spec (without a leading '?'); only values that differ from the defaults are written. */
export function encodeSpec(spec: Partial<BuilderSpec>): string {
  const s = normalizeSpec(spec);
  const d = defaultSpec();
  const p = new URLSearchParams({ v: 'build', kv: SPEC_VERSION });
  if (s.x !== d.x) p.set('kx', s.x);
  if (s.y.field !== d.y.field) p.set('ky', s.y.field);
  if (s.y.agg !== d.y.agg) p.set('ka', s.y.agg);
  if (s.color) p.set('kc', s.color);
  if (s.facet) p.set('kf', s.facet);
  if (s.bin !== undefined) p.set('kb', String(s.bin));
  if (s.chart !== d.chart) p.set('kt', s.chart);
  if (s.log) p.set('kl', '1');
  if (!s.zero) p.set('kz', '0');
  if (s.swap) p.set('ks', '1');
  if (s.raw && chartNeedsRaw(s.chart) === null) p.set('kr', '1');
  if (s.sort) p.set('ko', s.sort);
  if (s.limit !== undefined) p.set('kn', String(s.limit));
  if (s.colorLimit !== undefined) p.set('kcn', String(s.colorLimit));
  if (s.facetLimit !== undefined) p.set('kfn', String(s.facetLimit));
  for (const f of s.filters) p.append('kq', filterToken(f));
  return p.toString();
}

/** The spec in a query string. A missing or unknown version gives the defaults; unknown or invalid values are ignored one by one. */
export function decodeSpec(search: string): BuilderSpec {
  const p = new URLSearchParams(search);
  if (p.get('kv') !== SPEC_VERSION) return defaultSpec();
  const num = (k: string) => {
    const v = p.get(k);
    return v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;
  };
  const raw: Partial<BuilderSpec> = {
    x: p.get('kx') ?? undefined,
    y: { field: p.get('ky') ?? defaultSpec().y.field, agg: (p.get('ka') ?? defaultSpec().y.agg) as Agg },
    color: p.get('kc') ?? undefined,
    facet: p.get('kf') ?? undefined,
    bin: num('kb'),
    chart: (p.get('kt') ?? undefined) as ChartType | undefined,
    log: p.get('kl') === '1',
    zero: p.get('kz') !== '0',
    swap: p.get('ks') === '1',
    raw: p.get('kr') === '1',
    sort: (p.get('ko') ?? undefined) as SortMode | undefined,
    limit: num('kn'),
    colorLimit: num('kcn'),
    facetLimit: num('kfn'),
    filters: [...p.getAll('kw').map((t) => filterFromToken(t, ',')), ...p.getAll('kq').map((t) => filterFromToken(t, '|'))].filter((f): f is Filter => f !== null),
  };
  return normalizeSpec(raw);
}
