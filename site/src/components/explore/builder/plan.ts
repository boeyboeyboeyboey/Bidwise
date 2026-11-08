// Chart builder labels and number formats for a spec. Pure and DOM-free.
import { fieldById } from './fields';
import { aggFor, isRawChart } from './lines';
import type { BuilderSpec } from './spec';

export const xLabel = (s: BuilderSpec): string => fieldById(s.x)?.label ?? s.x;

/** Axis title of the value: "Median bid (e$)", "Seats offered, mean", "% filled, mean" (just the field for a Scatter). */
export function yLabel(s: BuilderSpec): string {
  const f = fieldById(s.y);
  if (!f) return s.y;
  const unit = f.unit === 'e$' ? ' (e$)' : '';
  const how = isRawChart(s) || aggFor(s.y) === 'median' ? '' : ', mean';
  return `${f.label}${how}${unit}`;
}

const round1 = (v: number) => String(Math.round(v * 10) / 10);

/** A value of Y as text: "e$12.50", "3.4", "62%". */
export function fmtY(s: BuilderSpec, v: number): string {
  const u = fieldById(s.y)?.unit;
  return u === 'e$' ? `e$${v.toFixed(2)}` : u === '%' ? `${Math.round(v)}%` : round1(v);
}

/** Axis tick text: like fmtY without the unit sign (the axis title carries it). */
export const fmtTick = (v: number): string => String(Math.round(v * 100) / 100);
