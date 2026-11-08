// Chart builder renderer: a query result drawn with Observable Plot, following the plan in plan.ts. Table charts are drawn by the component.
import * as Plot from '@observablehq/plot';
import { palette, shortLabel, type Theme } from '../chart';
import { fieldById, type Field } from './fields';
import { OTHER, type QueryPoint, type QueryResult } from './query';
import { fmtTick, fmtY, planFor, useLog, xLabel, yLabel } from './plan';
import type { BuilderSpec } from './spec';

/** The explore palette plus three more muted hues for up to eleven colours; "Other" is a light grey. */
export const builderPalette = (): string[] => [...palette(), '#6f9a8c', '#b07a8f', '#7d7aa8'];
const OTHER_COLOR = '#d6d3cb';
const RAMP: [string, string] = ['#eef0f2', '#3d5a73'];

/** Colour of each value of the colour field, in domain order. */
export const colorOf = (domain: readonly string[]): ((c: string) => string) => {
  const pal = builderPalette();
  const idx = new Map(domain.filter((c) => c !== OTHER).map((c, i) => [c, i]));
  return (c) => (c === OTHER ? OTHER_COLOR : pal[(idx.get(c) ?? 0) % pal.length]);
};

export const heatRamp = RAMP;

interface Datum {
  /** Position on the category axis: a label (band, point scale) or a number (linear scale). */
  x: string | number;
  y: number;
  color: string;
  facet: string;
  tip: string;
}

/** Text of a point's x: a category as is, a number through its field's format, a bin as "a to b". */
export function xText(p: { x: string | number; x1?: number }, xf: Field | undefined): string {
  if (typeof p.x === 'string') return p.x;
  const f = xf?.fmt ?? String;
  return p.x1 === undefined ? f(p.x) : `${f(p.x)} to ${f(p.x1)}`;
}

export function tipText(spec: BuilderSpec, p: QueryPoint, xf: Field | undefined): string {
  const lines = [p.row ? `${p.row.code} ${p.row.section}` : '', `${xLabel(spec)}: ${xText(p, xf)}`, `${yLabel(spec)}: ${fmtY(spec, p.y)}`];
  if (p.color !== undefined) lines.push(`${fieldById(spec.color ?? '')?.label ?? 'Colour'}: ${p.color}`);
  if (p.facet !== undefined) lines.push(`${fieldById(spec.facet ?? '')?.label ?? 'Facet'}: ${p.facet}`);
  lines.push(`n = ${p.n}${p.ny !== p.n ? ` (${p.ny} with a value)` : ''}`);
  return lines.filter(Boolean).join('\n');
}

/** Height that fits the chart: more room for faceted charts, heatmap rows and long horizontal category lists. */
export function chartHeight(spec: BuilderSpec, r: QueryResult, base: number): number {
  const plan = planFor(spec);
  const nx = r.domains.x.length;
  const nc = Math.max(1, r.domains.color.length);
  const nf = Math.max(1, r.domains.facet.length);
  let h = base;
  if (spec.chart === 'heatmap') {
    const rows = spec.swap ? nx : nc;
    h = Math.max(base * 0.7, (rows * 28 + 40) * (spec.swap ? 1 : nf) + 70);
  } else {
    if (spec.swap && plan.scale !== 'linear') h = Math.max(base, (plan.grouped ? nx * nc * 16 : nx * 28) + 90);
    if (nf > 1 && !spec.swap) h += (nf - 1) * Math.max(140, base * 0.4);
  }
  return Math.round(Math.min(2400, h));
}

export interface Drawn {
  svg: SVGSVGElement;
  /** Points left off a log axis (a value of 0 or less). */
  hidden: number;
}

export function drawChart(spec: BuilderSpec, r: QueryResult, theme: Theme, width: number, height: number): Drawn {
  const plan = planFor(spec);
  const xf = fieldById(spec.x);
  const log = useLog(spec);
  const swap = spec.swap;
  const heat = spec.chart === 'heatmap';
  const fs = width < 560 ? 13 : 14;
  const charW = fs * 0.58;
  const hasColor = r.domains.color.length > 0 && !!spec.color;
  const faceted = r.domains.facet.length > 1;
  const linear = plan.scale === 'linear';
  const colorFn = colorOf(r.domains.color);

  const pts = log ? r.points.filter((p) => p.y > 0) : r.points;
  const hidden = r.points.length - pts.length;
  const data: Datum[] = pts.map((p) => ({
    x: linear ? (p.x as number) : xText(p, xf),
    y: p.y,
    color: p.color ?? '',
    facet: p.facet ?? '',
    tip: tipText(spec, p, xf),
  }));
  const binEnd = new Map<string | number, number | undefined>();
  for (const p of r.points) if (!binEnd.has(p.x)) binEnd.set(p.x, p.x1);
  const xs = linear ? [] : [...new Set(r.domains.x.map((x) => xText({ x, x1: binEnd.get(x) }, xf)))];

  // Category labels: rotate when they do not fit side by side, thin them out when there are very many.
  const longest = Math.max(0, ...xs.map((x) => shortLabel(x).length));
  const crowded = !swap && xs.length > 1 && (longest * charW + 12) * xs.length > width - 90;
  const rot = crowded && xs.length <= 40;
  const skip = !swap && xs.length > 40 ? Math.ceil(xs.length / Math.max(6, Math.floor((width - 90) / 56))) : 1;
  const catTick = (d: string, i: number) => (i % skip === 0 ? shortLabel(d) : '');
  const rotMargin = rot ? Math.round(longest * charW * 0.71) + 20 : 0;
  const marginLeft = swap ? Math.min(180, Math.max(56, Math.round(longest * charW) + 14)) : rot ? Math.max(64, Math.round(longest * charW * 0.71) + 8) : 64;
  const facetW = Math.min(150, Math.max(...r.domains.facet.map((f) => shortLabel(f).length), 0) * charW + 12);

  // Axes. `pos` is the channel of the category (or numeric x) axis, `val` that of the value axis.
  const pos = swap ? 'y' : 'x';
  const val = swap ? 'x' : 'y';
  const grp = swap ? 'fy' : 'fx';
  const fct = swap ? 'fx' : 'fy';
  const forcedZero = spec.chart === 'bar' || spec.chart === 'stackedBar' || spec.chart === 'area';
  const minPos = Math.min(...data.map((d) => d.y).filter((v) => v > 0));
  const floor = log ? (Number.isFinite(minPos) ? 10 ** Math.floor(Math.log10(minPos)) : 0.1) : 0;
  const valScale = {
    type: log ? 'log' : 'linear', nice: true, grid: true, label: yLabel(spec), labelArrow: 'none',
    ticks: swap ? Math.max(3, Math.floor(width / 90)) : 6,
    tickFormat: (v: number) => fmtTick(spec, v),
    zero: forcedZero || (spec.zero && !log) || undefined,
    domain: log ? [floor, Math.max(floor * 10, ...data.map((d) => d.y))] : undefined,
  };
  let startTicks: number[] | undefined;
  if (linear && xf?.id === 'start' && data.length) {
    const xv = data.map((d) => d.x as number);
    startTicks = [];
    for (let t = Math.ceil(Math.min(...xv) / 60) * 60; t <= Math.max(...xv); t += 60) startTicks.push(t);
  }
  const catScale = linear
    ? { type: 'linear', nice: true, grid: true, label: xLabel(spec), labelArrow: 'none', ticks: startTicks, tickFormat: xf ? (v: number) => xf.fmt(v) : undefined }
    : plan.grouped
      ? { type: 'band', domain: r.domains.color, axis: null, padding: 0.1 }
      : { type: plan.scale, domain: xs, label: xLabel(spec), labelArrow: 'none', tickFormat: catTick, tickRotate: rot ? -45 : 0, padding: plan.scale === 'point' ? 0.5 : 0.15 };

  const single = builderPalette()[0];
  const fill = hasColor ? { fill: 'color' } : { fill: single };
  const stroke = hasColor ? { stroke: 'color' } : { stroke: single };
  const common: Record<string, unknown> = faceted ? { [fct]: 'facet' } : {};
  const tipped = { tip: true, title: 'tip' };
  const base = log ? floor : 0;
  // Grouped marks put the x label on the group (facet) axis and the colour on the position axis.
  const at: Record<string, unknown> = plan.grouped ? { [grp]: 'x', [pos]: 'color' } : { [pos]: 'x' };
  const mk: Plot.Markish[] = [];

  for (const m of plan.marks) {
    if (m === 'bar') {
      mk.push((swap ? Plot.barX : Plot.barY)(data, { ...common, ...at, [`${val}1`]: base, [`${val}2`]: 'y', ...fill, ...tipped } as never));
    } else if (m === 'stack') {
      mk.push((swap ? Plot.barX : Plot.barY)(data, { ...common, [pos]: 'x', [val]: 'y', ...fill, ...tipped } as never));
    } else if (m === 'line') {
      mk.push(Plot.line(data, { ...common, [pos]: 'x', [val]: 'y', ...stroke, strokeWidth: 2 } as never));
    } else if (m === 'area') {
      mk.push((swap ? Plot.areaX : Plot.areaY)(data, { ...common, [pos]: 'x', [`${val}1`]: base, [`${val}2`]: 'y', ...fill, fillOpacity: 0.14 } as never));
    } else if (m === 'dot') {
      const raw = spec.chart === 'scatter' || spec.raw === true;
      const o = raw ? 0.55 : 1;
      mk.push(Plot.dot(data, { ...common, [pos]: 'x', [val]: 'y', ...fill, ...stroke, r: raw ? 3 : spec.chart === 'dot' ? 4.5 : 3.5, fillOpacity: o, strokeOpacity: o, ...tipped } as never));
    } else if (m === 'box') {
      mk.push((swap ? Plot.boxX : Plot.boxY)(data, { ...common, ...at, [val]: 'y', ...stroke, ...fill, fillOpacity: 0.18 } as never));
    } else if (m === 'tip') {
      mk.push(Plot.tip(data, Plot.pointer({ ...common, ...at, [val]: 'y', title: 'tip' } as never)));
    } else if (m === 'cell') {
      mk.push(Plot.cell(data, { ...common, [pos]: 'x', [val]: 'color', fill: 'y', inset: 0.5, ...tipped } as never));
    } else if (m === 'text') {
      const ys = data.map((d) => d.y);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const nCols = swap ? Math.max(1, r.domains.color.length) : Math.max(1, xs.length);
      const nRows = swap ? Math.max(1, xs.length) : Math.max(1, r.domains.color.length);
      const cellW = (width - marginLeft - 30) / nCols / (faceted && swap ? r.domains.facet.length : 1);
      const cellH = (height - 90) / nRows / (faceted && !swap ? r.domains.facet.length : 1);
      if (cellW >= 38 && cellH >= 20) {
        mk.push(Plot.text(data, {
          ...common, [pos]: 'x', [val]: 'color', text: (d: Datum) => fmtTick(spec, d.y), fontSize: fs - 1,
          fill: (d: Datum) => (hi > lo && (d.y - lo) / (hi - lo) > 0.55 ? '#ffffff' : theme.text),
        } as never));
      }
    }
  }

  const heatVal = { type: 'band', domain: r.domains.color, label: fieldById(spec.color ?? '')?.label ?? null, labelArrow: 'none', tickFormat: shortLabel, padding: 0.05 };
  const svg = Plot.plot({
    width, height,
    marginTop: swap && faceted ? 48 : 32,
    marginBottom: swap ? 48 : rot ? rotMargin + 24 : 52,
    marginLeft,
    marginRight: faceted && !swap ? facetW + 16 : 24,
    style: { background: 'transparent', color: theme.muted, fontFamily: theme.font, fontSize: `${fs}px`, fontVariantNumeric: 'tabular-nums', overflow: 'visible' },
    [pos]: heat ? { ...catScale, padding: 0.05 } : catScale,
    [val]: heat ? heatVal : valScale,
    ...(plan.grouped ? { [grp]: { domain: xs, label: xLabel(spec), labelArrow: 'none', tickFormat: catTick, tickRotate: rot ? -45 : 0, padding: 0.15 } } : {}),
    ...(faceted ? { [fct]: { domain: r.domains.facet, label: null, tickFormat: shortLabel } } : {}),
    color: heat ? { type: 'linear', range: RAMP, interpolate: 'rgb' } : { domain: r.domains.color, range: r.domains.color.map(colorFn), legend: false },
    marks: mk,
  } as Plot.PlotOptions) as unknown as SVGSVGElement;
  return { svg, hidden };
}
