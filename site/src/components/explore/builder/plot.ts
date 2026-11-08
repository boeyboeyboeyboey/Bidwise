// Chart builder renderer: merged lines drawn with Observable Plot as a line, bar or scatter chart. One colour per line (lines.ts).
import * as Plot from '@observablehq/plot';
import { shortLabel, type Theme } from '../chart';
import { fieldById, type Field } from './fields';
import type { LinesResult } from './lines';
import type { QueryPoint } from './query';
import { fmtTick, fmtY, xLabel, yLabel } from './plan';
import type { BuilderSpec } from './spec';

interface Datum {
  /** Position on the x axis: a label (band, point scale) or a number (linear scale). */
  x: string | number;
  y: number;
  series: string;
  tip: string;
}

/** Text of a point's x: a category as is, a number through its field's format. */
export const xText = (p: { x: string | number }, xf: Field | undefined): string => (typeof p.x === 'string' ? p.x : (xf?.fmt ?? String)(p.x));

export function tipText(spec: BuilderSpec, p: QueryPoint, xf: Field | undefined): string {
  const lines = [
    p.series ?? '',
    p.row ? `${p.row.term} ${p.row.code} ${p.row.section}` : '',
    `${xLabel(spec)}: ${xText(p, xf)}`,
    `${yLabel(spec)}: ${fmtY(spec, p.y)}`,
  ];
  if (!p.row) lines.push(`n = ${p.n}${p.ny !== p.n ? ` (${p.ny} with a value)` : ''}`);
  return lines.filter(Boolean).join('\n');
}

export function drawChart(spec: BuilderSpec, r: LinesResult, theme: Theme, width: number, height: number): SVGSVGElement {
  const xf = fieldById(spec.x);
  const bar = spec.chart === 'bar';
  const linear = xf?.kind === 'number' && !bar;
  const fs = width < 560 ? 13 : 14;
  const charW = fs * 0.58;
  const data: Datum[] = r.points.map((p) => ({ x: linear ? (p.x as number) : xText(p, xf), y: p.y, series: p.series ?? '', tip: tipText(spec, p, xf) }));
  const xs = linear ? [] : [...new Set(r.xDomain.map((x) => xText({ x }, xf)))];
  const grouped = bar && r.series.length > 1;

  // Category labels: rotate when they do not fit side by side, thin them out when there are very many.
  const longest = Math.max(0, ...xs.map((x) => shortLabel(x).length));
  const crowded = xs.length > 1 && (longest * charW + 12) * xs.length > width - 90;
  const rot = crowded && xs.length <= 40;
  const skip = xs.length > 40 ? Math.ceil(xs.length / Math.max(6, Math.floor((width - 90) / 56))) : 1;
  const catTick = (d: string, i: number) => (i % skip === 0 ? shortLabel(d) : '');
  const rotMargin = rot ? Math.round(longest * charW * 0.71) + 20 : 0;
  const marginLeft = rot ? Math.max(64, Math.round(longest * charW * 0.71) + 8) : 64;

  const xScale = linear
    ? { type: 'linear', nice: true, grid: true, label: xLabel(spec), labelArrow: 'none', tickFormat: xf ? (v: number) => xf.fmt(v) : undefined }
    : grouped
      ? { type: 'band', domain: r.series, axis: null, padding: 0.1 }
      : { type: bar ? 'band' : 'point', domain: xs, label: xLabel(spec), labelArrow: 'none', tickFormat: catTick, tickRotate: rot ? -45 : 0, padding: bar ? 0.15 : 0.5 };
  const color = (d: Datum) => r.colors.get(d.series) ?? '#23262b';
  const tipped = { tip: true, title: 'tip' };
  const marks: Plot.Markish[] = [];
  if (bar) {
    marks.push(Plot.barY(data, { ...(grouped ? { fx: 'x', x: 'series' } : { x: 'x' }), y: 'y', fill: color, ...tipped } as never));
  } else if (spec.chart === 'line') {
    marks.push(Plot.line(data, { x: 'x', y: 'y', z: 'series', stroke: color, strokeWidth: 2 } as never));
    marks.push(Plot.dot(data, { x: 'x', y: 'y', fill: color, stroke: color, r: 3.5, ...tipped } as never));
  } else {
    marks.push(Plot.dot(data, { x: 'x', y: 'y', fill: color, stroke: color, r: 3, fillOpacity: 0.55, strokeOpacity: 0.55, ...tipped } as never));
  }

  return Plot.plot({
    width, height,
    marginTop: 32,
    marginBottom: rot ? rotMargin + 24 : 52,
    marginLeft,
    marginRight: 24,
    style: { background: 'transparent', color: theme.muted, fontFamily: theme.font, fontSize: `${fs}px`, fontVariantNumeric: 'tabular-nums', overflow: 'visible' },
    x: xScale,
    y: { type: 'linear', nice: true, grid: true, zero: true, label: yLabel(spec), labelArrow: 'none', ticks: 6, tickFormat: fmtTick },
    ...(grouped ? { fx: { domain: xs, label: xLabel(spec), labelArrow: 'none', tickFormat: catTick, tickRotate: rot ? -45 : 0, padding: 0.15 } } : {}),
    marks,
  } as Plot.PlotOptions) as unknown as SVGSVGElement;
}
