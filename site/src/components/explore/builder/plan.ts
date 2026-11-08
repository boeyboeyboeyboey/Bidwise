// Chart builder drawing plan: which Plot marks and scale type each chart type uses, plus the labels and number formats of a spec. Pure and DOM-free
// (plot.ts turns a plan into Plot marks).
import { fieldById, fmtMinutes } from './fields';
import { AGG_LABEL, isRaw } from './controls';
import { coerceAgg } from './query';
import type { BuilderSpec, ChartType } from './spec';

export type Mk = 'bar' | 'stack' | 'line' | 'area' | 'dot' | 'box' | 'cell' | 'text' | 'tip' | 'table';
export type ScaleKind = 'band' | 'point' | 'linear';

export interface Plan {
  marks: Mk[];
  /** The x position scale: bars, boxes and cells use bands (a numeric x is then read as labelled steps), lines and dots a point or linear scale. */
  scale: ScaleKind;
  /** Bars (and boxes) of different colours sit side by side within each x. */
  grouped: boolean;
  stacked: boolean;
  /** Heatmap only: the second axis is the colour field, so there is nothing to draw without one. */
  needsColor: boolean;
}

const MARKS: Record<ChartType, Mk[]> = {
  bar: ['bar'],
  stackedBar: ['stack'],
  line: ['line', 'dot'],
  area: ['area', 'line', 'dot'],
  dot: ['dot'],
  scatter: ['dot'],
  box: ['box', 'tip'],
  heatmap: ['cell', 'text'],
  table: ['table'],
};

export function planFor(s: BuilderSpec): Plan {
  const numeric = fieldById(s.x)?.kind === 'number';
  const banded = s.chart === 'bar' || s.chart === 'stackedBar' || s.chart === 'box' || s.chart === 'heatmap';
  return {
    marks: MARKS[s.chart],
    scale: banded ? 'band' : numeric ? 'linear' : 'point',
    grouped: (s.chart === 'bar' || s.chart === 'box') && !!s.color,
    stacked: s.chart === 'stackedBar',
    needsColor: s.chart === 'heatmap' && !s.color,
  };
}

/** True when the value axis can be logarithmic and the spec asks for it. */
export const useLog = (s: BuilderSpec): boolean => s.log && s.chart !== 'stackedBar' && s.chart !== 'heatmap' && s.chart !== 'table';

// ---- Labels and number formats

export function xLabel(s: BuilderSpec): string {
  return fieldById(s.x)?.label ?? s.x;
}

/** Axis title of the value: "Median bid, median (e$)"; the row count is just "Rows". */
export function yLabel(s: BuilderSpec): string {
  if (s.y.field === 'count') return 'Rows';
  const f = fieldById(s.y.field);
  if (!f) return s.y.field;
  const withUnit = (base: string, unit: string) => (unit && !base.includes(`(${unit})`) ? `${base} (${unit})` : base);
  if (isRaw(s)) return withUnit(f.label, f.unit === 'none' ? '' : f.unit);
  const agg = coerceAgg(s.y.field, s.y.agg);
  const unit = agg === 'pctTrue' ? '%' : agg === 'count' ? '' : f.unit === 'none' ? '' : f.unit;
  const word = AGG_LABEL[agg].toLowerCase();
  return withUnit(f.label.toLowerCase().includes(word) ? f.label : `${f.label}, ${word}`, unit);
}

const round1 = (v: number) => String(Math.round(v * 10) / 10);

/** A value of the Y shelf as text: "e$12.50", "3.4", "62%", "08:15". */
export function fmtY(s: BuilderSpec, v: number): string {
  const f = fieldById(s.y.field);
  if (!f || s.y.field === 'count') return String(Math.round(v));
  const raw = isRaw(s);
  const agg = raw ? null : coerceAgg(s.y.field, s.y.agg);
  if (agg === 'pctTrue') return `${Math.round(v)}%`;
  if (agg === 'count') return String(Math.round(v));
  if (f.id === 'start') return fmtMinutes(Math.round(v));
  if (f.unit === 'e$') return `e$${v.toFixed(2)}`;
  if (f.unit === '%') return `${Math.round(v)}%`;
  return round1(v);
}

/** Axis tick text: like fmtY without the unit sign (the axis title carries it). */
export function fmtTick(s: BuilderSpec, v: number): string {
  const f = fieldById(s.y.field);
  const agg = isRaw(s) ? null : coerceAgg(s.y.field, s.y.agg);
  if (f?.id === 'start' && agg !== 'count' && agg !== 'pctTrue') return fmtMinutes(Math.round(v));
  return String(Math.round(v * 100) / 100);
}
