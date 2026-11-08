// "Start from" charts. A preset replaces the chart but keeps the current filters (terms, course).
import { defaultSpec, normalizeSpec, type BuilderSpec } from './spec';

export interface Preset {
  id: string;
  label: string;
  spec: BuilderSpec;
  /** The chart only makes sense for one course: the UI opens the course filter. */
  needsCourse?: boolean;
}

const mk = (p: Partial<BuilderSpec>): BuilderSpec => normalizeSpec({ ...defaultSpec(), ...p });

export const PRESETS: Preset[] = [
  { id: 'band', label: 'Median bid by time of day', spec: mk({ x: 'band', chart: 'bar' }) },
  { id: 'day', label: '% filled by day', spec: mk({ x: 'day', y: { field: 'filled', agg: 'pctTrue' }, chart: 'bar' }) },
  { id: 'round', label: 'Median bid by round', spec: mk({ x: 'round', chart: 'bar' }) },
  { id: 'instructor', label: 'Bids by instructor for one course', spec: mk({ x: 'instructor', sort: 'yDesc', chart: 'bar' }), needsCourse: true },
  { id: 'seats', label: 'Seats left vs median bid', spec: mk({ x: 'after', y: { field: 'median', agg: 'median' }, chart: 'scatter' }) },
];

/** The spec after applying a preset: its chart with the current filters. */
export const applyPreset = (current: BuilderSpec, preset: Preset): BuilderSpec => normalizeSpec({ ...preset.spec, filters: current.filters });
