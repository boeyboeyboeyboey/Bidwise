import * as Plot from '@observablehq/plot';
import { fmtUnit, METRIC_META, type Plotted } from './model';
import type { ExploreState } from './state';

export interface Theme {
  text: string; muted: string; border: string; surface: string; font: string;
}

// Light theme only: ink, greys and muted hues. Literal colours so SVG/PNG exports resolve.
const LIGHT = ['#23262b', '#8a8f97', '#5c7c99', '#a8895a', '#b9bcc1', '#4a4f57', '#8b6a62'];
export const palette = () => LIGHT;
// Accent is reserved for the forecast, never a series colour.
export const ACCENT = '#2d6a5a';

const WIN_SHORT = (w: string) =>
  w.replace('Incoming Exchange Rnd', 'IE').replace('Incoming Freshmen Rnd', 'IF').replace('Round ', 'R').replace(/ Win(?:dow)? /, ' W');

/** Short axis label: "2025-26 Term 2" becomes "25/26 T2"; "2025-26 Term 2 · Round 1A Window 2" becomes "25/26 T2 · R1A W2". Other labels are unchanged. */
export function shortLabel(x: string): string {
  const [term, win] = x.split(' · ');
  const m = /^\d{2}(\d{2})-(\d{2}) Term (\w+)$/.exec(term);
  if (!m) return x;
  const t = `${m[1]}/${m[2]} T${m[3]}`;
  return win ? `${t} · ${WIN_SHORT(win)}` : t;
}

export function render(p: Plotted, st: ExploreState, theme: Theme, width: number, baseHeight = 300): SVGSVGElement {
  const colors = palette();
  const color = { domain: p.series, range: p.series.map((_, i) => colors[i % colors.length]) };
  const faceted = st.facet !== 'none' && p.facets.length > 1;
  const log = st.log && !p.secondary;
  const fs = width < 560 ? 13 : 14;
  const longest = Math.max(0, ...p.xs.map((x) => shortLabel(x).length));
  const charW = fs * 0.58;
  // Rotate only when the short labels would not fit side by side.
  const rot = p.xs.length > 2 && (longest * charW + 12) * p.xs.length > width - 70;
  // A label rotated 45 degrees needs about 0.71 x its width of room below the axis; size it to the longest label.
  const rotMargin = rot ? Math.round(longest * charW * 0.71) + 20 : 0;
  const marginLeft = rot ? Math.max(56, Math.round(longest * charW * 0.71) + 8) : 56;
  const marginRight = p.secondary ? 56 : 28;
  const step = (width - marginLeft - marginRight) / Math.max(1, p.xs.length);
  // Label every point when they sit far enough apart and there is a single line; otherwise only the latest value of each line.
  const labelAll = step >= 52 && p.series.length === 1 && !faceted && !p.secondary;
  const height = baseHeight + (faceted ? 60 * (p.facets.length - 1) : 0) + (rot ? rotMargin - 24 : 0);
  const bar = p.mark === 'bar';
  const common = faceted ? { fy: 'facet' } : {};
  const rows = log ? p.rows.filter((r) => r.ys > 0) : p.rows;
  const marks: Plot.Markish[] = [];

  for (const layer of p.layers) {
    const d = rows.filter((r) => r.layer === layer);
    if (!d.length) continue;
    const dash = METRIC_META[layer].unit === p.primary ? undefined : '5 3';
    const base = { ...common, stroke: 'series' as const };
    const xy = bar ? { x: 'series', fx: 'x' } : { x: 'x' };
    if (p.mark === 'line') {
      marks.push(Plot.line(d, { ...base, ...xy, y: 'ys', strokeWidth: 2, strokeDasharray: dash }));
      marks.push(Plot.dot(d, { ...base, ...xy, y: 'ys', r: 3.5, fill: 'series', tip: true, title: tipOf }));
      marks.push(valueLabels(d, p, labelAll, common, theme, fs));
    } else if (p.mark === 'dot') {
      marks.push(Plot.dot(d, { ...base, ...xy, y: 'ys', r: 4.5, fill: 'series', fillOpacity: 1, tip: true, title: tipOf }));
      marks.push(valueLabels(d, p, labelAll, common, theme, fs));
    } else if (p.mark === 'area') {
      marks.push(Plot.areaY(d, { ...common, ...xy, y1: log ? 0.01 : 0, y2: 'ys', fill: 'series', fillOpacity: 0.12 }));
      marks.push(Plot.line(d, { ...base, ...xy, y: 'ys', strokeWidth: 2, strokeDasharray: dash }));
      marks.push(Plot.dot(d, { ...base, ...xy, y: 'ys', r: 3, fill: 'series', tip: true, title: tipOf }));
      marks.push(valueLabels(d, p, labelAll, common, theme, fs));
    } else if (p.mark === 'bar') {
      marks.push(Plot.barY(d, { ...common, ...xy, y1: log ? 0.01 : 0, y2: 'ys', fill: 'series', fillOpacity: dash ? 0.5 : 0.9, tip: true, title: tipOf }));
    } else {
      marks.push(Plot.boxY(d, { ...common, x: 'x', y: 'ys', stroke: 'series' }));
    }
  }

  if (p.fc.length) {
    const fcX = p.xs[p.xs.length - 1];
    const lineLike = p.mark === 'line' || p.mark === 'area';
    // Draw each series on its own small x offset so several sections never sit on top of each other.
    const names = [...new Set(p.fc.map((r) => r.series))];
    const step = Math.min(14, Math.max(6, Math.floor(width / (p.xs.length * (names.length + 1)))));
    names.forEach((name, i) => {
      const dx = Math.round((i - (names.length - 1) / 2) * step);
      const f = p.fc.filter((r) => r.series === name);
      const sc = p.series.length === 1 ? { stroke: ACCENT } : { stroke: 'series' as const };
      // dashed hand-off from the last real point to the forecast median
      if (lineLike) {
        const links = f.flatMap((r) => {
          const prev = rows
            .filter((q) => q.series === r.series && q.layer === r.layer && q.facet === r.facet && q.x !== fcX)
            .sort((a, b) => p.xs.indexOf(a.x) - p.xs.indexOf(b.x))
            .at(-1);
          return prev ? [{ facet: r.facet, x1: prev.x, y1: prev.ys, x2: fcX, y2: r.p50s, series: r.series }] : [];
        });
        if (links.length) marks.push(Plot.link(links, { ...common, x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2', ...sc, strokeWidth: 1.5, strokeDasharray: '4 3', strokeOpacity: 0.8 }));
      }
      const spread = f.filter((r) => r.hi > r.lo);
      if (st.band && spread.length) {
        marks.push(Plot.ruleX(spread, { ...common, x: 'x', y1: 'los', y2: 'his', ...sc, strokeWidth: 2, dx }));
        marks.push(Plot.dot(spread, { ...common, x: 'x', y: 'los', ...sc, fill: theme.surface, strokeWidth: 1.5, r: 3, dx }));
        marks.push(Plot.dot(spread, { ...common, x: 'x', y: 'his', ...sc, fill: theme.surface, strokeWidth: 1.5, r: 3, dx }));
      }
      marks.push(Plot.dot(f, {
        ...common, x: 'x', y: 'p50s', ...sc, fill: p.series.length === 1 ? ACCENT : 'series', fillOpacity: 1, strokeWidth: 2, symbol: 'diamond', r: 7, dx,
        tip: true,
        title: (r: (typeof f)[number]) => `${r.series} forecast\n${fmtUnit(METRIC_META[r.layer].unit, r.p50)}${r.hi > r.lo ? ` (likely range ${fmtUnit(METRIC_META[r.layer].unit, r.lo)} to ${fmtUnit(METRIC_META[r.layer].unit, r.hi)})` : ''}`,
      }));
    });
  }

  if (p.secondary) {
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => f * p.yMax);
    marks.push(Plot.axisY({ anchor: 'right', ticks, tickFormat: (v: number) => fmtUnit(p.secondary!, v / p.k), label: axisLabel(p, p.secondary), color: theme.muted } as never));
  }

  const xDomain = bar ? undefined : p.xs;
  const svg = Plot.plot({
    width,
    height,
    marginTop: faceted ? 32 : 36,
    marginBottom: rot ? rotMargin : bar && p.xs.length > 3 ? 76 : 40,
    marginLeft,
    marginRight,
    style: {
      background: 'transparent', color: theme.muted, fontFamily: theme.font, fontSize: `${fs}px`,
      fontVariantNumeric: 'tabular-nums', overflow: 'visible',
    },
    x: bar ? { label: null, axis: null } : { type: p.mark === 'box' ? 'band' : 'point', domain: xDomain, label: null, tickRotate: rot ? -45 : 0, tickFormat: shortLabel, padding: 0.5 },
    fx: bar ? { label: null, domain: p.xs, tickRotate: rot ? -45 : 0, tickFormat: shortLabel } : undefined,
    y: {
      type: log ? 'log' : 'linear', labelAnchor: 'top', labelArrow: 'none', nice: true,
      label: axisLabel(p, p.primary),
      ticks: 6,
      tickFormat: (v: number) => fmtUnit(p.primary, v),
      domain: p.secondary && !log ? [0, p.yMax * 1.05] : undefined,
      zero: bar || p.mark === 'area' || p.primary !== 'e$' || (st.zero && !log) || undefined,
    },
    fy: faceted ? { label: null, domain: p.facets } : undefined,
    color: { ...color, legend: false },
    marks: [Plot.gridY({ stroke: theme.border, strokeOpacity: 1 }), ...marks],
  } as Plot.PlotOptions) as unknown as SVGSVGElement;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${p.layers.map((m) => METRIC_META[m].label).join(', ')} chart, ${p.series.length} series`);
  return svg;
}

/** Axis title with its unit; a label that already ends in the unit (e.g. "Seats taken (%)") isn't given it twice. */
function axisLabel(p: Plotted, unit: string): string {
  const l = labelOf(p, unit);
  return l.endsWith(`(${unit})`) ? l : `${l} (${unit})`;
}

function labelOf(p: Plotted, unit: string): string {
  return p.layers.filter((m) => METRIC_META[m].unit === unit).map((m) => METRIC_META[m].label).join(' / ');
}

function tipOf(r: { series: string; x: string; y: number; unit: 'e$' | 'seats' | '%'; layer: string }): string {
  return `${r.series}\n${r.x}\n${fmtUnit(r.unit, r.y)}`;
}

/** The value written next to each point (or only the latest one per line when points are crowded). */
function valueLabels(d: Plotted['rows'], p: Plotted, all: boolean, common: object, theme: Theme, fs: number) {
  let data = d;
  if (!all) {
    const last = new Map<string, number>();
    for (const r of d) {
      const k = `${r.series}|${r.facet}`;
      last.set(k, Math.max(last.get(k) ?? -1, p.xs.indexOf(r.x)));
    }
    data = d.filter((r) => p.xs.indexOf(r.x) === last.get(`${r.series}|${r.facet}`));
  }
  return Plot.text(data, {
    ...common, x: 'x', y: 'ys', text: (r: (typeof d)[number]) => fmtUnit(r.unit, r.y),
    dy: -13, textAnchor: all ? 'middle' : 'end', dx: all ? 0 : 6, fill: theme.text, fontSize: fs, fontWeight: 600, stroke: theme.surface, strokeWidth: 4,
  });
}
