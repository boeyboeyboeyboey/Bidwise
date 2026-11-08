// Chart builder controls: how the shelves read and change a BuilderSpec. Pure and DOM-free; every change goes through normalizeSpec.
import { FIELDS, fieldById, type Field } from './fields';
import { allowedAggs, coerceAgg, type Agg } from './query';
import { chartNeedsRaw, normalizeSpec, type BuilderSpec, type ChartType } from './spec';

export const CHART_LABEL: Record<ChartType, string> = {
  bar: 'Bar', stackedBar: 'Stacked', line: 'Line', area: 'Area', dot: 'Dot', scatter: 'Scatter', box: 'Box', heatmap: 'Heatmap', table: 'Table',
};
export const AGG_LABEL: Record<Agg, string> = { median: 'Median', mean: 'Mean', min: 'Min', max: 'Max', sum: 'Sum', count: 'Count', pctTrue: '% true' };
export const SORT_LABEL = { x: 'X order', yAsc: 'Value, low to high', yDesc: 'Value, high to low' } as const;

/** Rows of every field a value can be taken from: the row count first, then numbers and flags (a category can only be counted, which the row count already does). */
export const Y_FIELDS: { id: string; label: string }[] = [
  { id: 'count', label: 'Rows' },
  ...FIELDS.filter((f) => f.kind !== 'category').map((f) => ({ id: f.id, label: f.label })),
];
export const AXIS_FIELDS: Field[] = FIELDS;

/** Download size of every term's data, in MB (the Browse shards together). */
export const ALL_TERMS_MB = 12;

export interface ControlState {
  aggs: Agg[];
  /** The aggregate select does nothing (raw rows, or only one aggregate fits). */
  aggLocked: boolean;
  binOn: boolean;
  sortOn: boolean;
  rawOn: boolean;
  rawChecked: boolean;
  logOn: boolean;
  logChecked: boolean;
  zeroOn: boolean;
  zeroChecked: boolean;
  swapOn: boolean;
  /** The Y shelf in raw mode cannot count rows. */
  yFields: { id: string; label: string }[];
  colorLabel: string;
  yShelfLabel: string;
  isRaw: boolean;
}

export const isRaw = (s: BuilderSpec): boolean => chartNeedsRaw(s.chart) === true || s.raw === true;

export function controlState(s: BuilderSpec): ControlState {
  const xf = fieldById(s.x);
  const raw = isRaw(s);
  const aggs = allowedAggs(s.y.field);
  const forcedZero = s.chart === 'bar' || s.chart === 'stackedBar' || s.chart === 'area';
  const logOn = s.chart !== 'stackedBar' && s.chart !== 'heatmap' && s.chart !== 'table';
  const table = s.chart === 'table';
  return {
    aggs,
    aggLocked: raw || aggs.length < 2,
    binOn: xf?.kind === 'number' && !raw,
    sortOn: xf?.kind === 'category' && !raw,
    rawOn: chartNeedsRaw(s.chart) === null,
    rawChecked: raw,
    logOn,
    logChecked: logOn && s.log,
    zeroOn: !forcedZero && !(logOn && s.log),
    zeroChecked: forcedZero || (s.zero && !(logOn && s.log)),
    swapOn: !table,
    yFields: raw ? Y_FIELDS.filter((f) => f.id !== 'count') : Y_FIELDS,
    colorLabel: s.chart === 'heatmap' ? 'Second axis' : 'Colour',
    yShelfLabel: s.chart === 'heatmap' ? 'Cell value' : 'Y',
    isRaw: raw,
  };
}

export function defaultAgg(yField: string): Agg {
  if (yField === 'count') return 'count';
  return fieldById(yField)?.kind === 'bool' ? 'pctTrue' : 'median';
}

const kindOf = (id: string) => (id === 'count' ? 'count' : fieldById(id)?.kind);

/** A raw spec cannot count rows: fall back to the median bid. */
function fixRaw(s: BuilderSpec): BuilderSpec {
  if (isRaw(s) && s.y.field === 'count') return normalizeSpec({ ...s, y: { field: 'median', agg: 'median' } });
  return s;
}

export function setX(s: BuilderSpec, x: string): BuilderSpec {
  return normalizeSpec({ ...s, x, bin: fieldById(x)?.kind === 'number' && x === s.x ? s.bin : undefined });
}

/** Changes the value field; the aggregate stays when the new field takes it and is of the same kind, otherwise it resets to that field's usual one. */
export function setY(s: BuilderSpec, field: string): BuilderSpec {
  const keep = kindOf(field) === kindOf(s.y.field) && allowedAggs(field).includes(s.y.agg);
  return fixRaw(normalizeSpec({ ...s, y: { field, agg: keep ? s.y.agg : defaultAgg(field) } }));
}

export const setAgg = (s: BuilderSpec, agg: Agg): BuilderSpec => normalizeSpec({ ...s, y: { field: s.y.field, agg: coerceAgg(s.y.field, agg) } });

/** A heatmap needs a second axis, so one is chosen when there is none (round, or time of day when x is the round). */
export function setChart(s: BuilderSpec, chart: ChartType): BuilderSpec {
  const color = chart === 'heatmap' && !s.color ? (s.x === 'round' ? 'band' : 'round') : s.color;
  return fixRaw(normalizeSpec({ ...s, chart, color, raw: chartNeedsRaw(chart) === null ? s.raw : undefined }));
}

export const setRaw = (s: BuilderSpec, raw: boolean): BuilderSpec => fixRaw(normalizeSpec({ ...s, raw }));

/** An empty value clears the field. */
export const setOptional = (s: BuilderSpec, key: 'color' | 'facet', v: string): BuilderSpec => normalizeSpec({ ...s, [key]: v || undefined });

/** Bin width from text; empty, zero or invalid means no bins. */
export function setBin(s: BuilderSpec, text: string): BuilderSpec {
  const n = Number(text);
  return normalizeSpec({ ...s, bin: text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined });
}

export const setSwap = (s: BuilderSpec): BuilderSpec => normalizeSpec({ ...s, swap: !s.swap });

// ---- Terms. No term filter means the latest term only; a term filter names the terms to include.

/** Terms the spec reads: the `in` list of its term filter (known terms only), else the latest. `all` is oldest first. */
export function effectiveTerms(s: BuilderSpec, all: readonly string[]): string[] {
  const f = s.filters.find((x) => x.field === 'term' && x.in && x.in.length);
  if (f) {
    const want = new Set(f.in);
    return all.filter((t) => want.has(t));
  }
  const last = all[all.length - 1];
  return last ? [last] : [];
}

function withTerms(s: BuilderSpec, terms: readonly string[], all: readonly string[]): BuilderSpec {
  const latest = all[all.length - 1];
  const rest = s.filters.filter((f) => f.field !== 'term');
  const only = terms.length === 1 && terms[0] === latest;
  return normalizeSpec({ ...s, filters: only || !terms.length ? rest : [...rest, { field: 'term', in: all.filter((t) => terms.includes(t)) }] });
}

/** Adds or removes a term; the last remaining term cannot be removed. */
export function toggleTerm(s: BuilderSpec, term: string, all: readonly string[]): BuilderSpec {
  const cur = effectiveTerms(s, all);
  const next = cur.includes(term) ? cur.filter((t) => t !== term) : [...cur, term];
  return next.length ? withTerms(s, next, all) : s;
}

export const setAllTerms = (s: BuilderSpec, all: readonly string[]): BuilderSpec => withTerms(s, all, all);
export const setLatestTerm = (s: BuilderSpec, all: readonly string[]): BuilderSpec => withTerms(s, all.slice(-1), all);
export const allTermsOn = (s: BuilderSpec, all: readonly string[]): boolean => all.length > 1 && effectiveTerms(s, all).length === all.length;

/** MB to download for the terms, from each term's share of the rows. */
export function termsSizeMb(terms: readonly { term: string; rows: number }[], picked: readonly string[]): number {
  const total = terms.reduce((n, t) => n + t.rows, 0);
  if (!total) return 0;
  const part = terms.filter((t) => picked.includes(t.term)).reduce((n, t) => n + t.rows, 0);
  return (ALL_TERMS_MB * part) / total;
}
