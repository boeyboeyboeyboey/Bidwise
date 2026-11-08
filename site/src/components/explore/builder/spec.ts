// The chart builder's state: a chart type, an X and a Y field, and up to MAX_LINES lines (a course plus optional narrowing each), with defaults,
// validation and a compact versioned URL form. Pure and DOM-free. The URL shares the Past bids query string, so `v=build` picks the mode and every
// other key starts with `k`. Links from the older builder (kv=1) fall back to the defaults.
import { fieldById } from './fields';

export type ChartType = 'line' | 'bar' | 'scatter';
export const CHART_TYPES: ChartType[] = ['line', 'bar', 'scatter'];
export const CHART_LABEL: Record<ChartType, string> = { line: 'Line', bar: 'Bar', scatter: 'Scatter' };

/** X choices in menu order; Scatter takes only the numbers. */
export const X_IDS = ['term', 'window', 'termWindow', 'day', 'band', 'instructor', 'section', 'vacancy', 'median', 'min'];
/** Y choices in menu order. */
export const Y_IDS = ['median', 'min', 'before', 'after', 'fillPct', 'taken'];
/** The number X fields: the only X a Scatter can use. */
export const NUMBER_X_IDS = X_IDS.filter((id) => fieldById(id)?.kind === 'number');

/** Narrowing a line can take, in label order. */
export const NARROW_KEYS = ['day', 'band', 'section', 'instructor'] as const;
export type NarrowKey = (typeof NARROW_KEYS)[number];

export interface LineSpec {
  /** Course code as typed (upper case); '' for a line with no course yet. */
  course: string;
  day?: string;
  band?: string;
  section?: string;
  instructor?: string;
}

export const MAX_LINES = 8;

export interface BuilderSpec {
  chart: ChartType;
  x: string;
  y: string;
  lines: LineSpec[];
  /** Every term (about 12 MB) instead of the last four. */
  more: boolean;
}

export const SPEC_VERSION = '2';

export const emptyLine = (): LineSpec => ({ course: '' });

export const defaultSpec = (): BuilderSpec => ({ chart: 'line', x: 'term', y: 'median', lines: [emptyLine()], more: false });

const pick = <T extends string>(v: unknown, all: readonly T[]): T | undefined =>
  typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : undefined;

const text = (v: unknown, max = 80): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export function cleanLine(l: Partial<LineSpec> | undefined): LineSpec {
  const out: LineSpec = { course: (text(l?.course, 20) ?? '').toUpperCase() };
  for (const k of NARROW_KEYS) {
    const v = text(l?.[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** A valid spec from anything shaped like one: unknown values fall back to the defaults, Scatter gets a number on X, and there are one to MAX_LINES lines. Idempotent. */
export function normalizeSpec(input: Partial<BuilderSpec> | undefined): BuilderSpec {
  const d = defaultSpec();
  const s = input ?? {};
  const chart = pick(s.chart, CHART_TYPES) ?? d.chart;
  let x = pick(s.x, X_IDS) ?? d.x;
  if (chart === 'scatter' && !NUMBER_X_IDS.includes(x)) x = 'vacancy';
  const lines = (Array.isArray(s.lines) ? s.lines : []).slice(0, MAX_LINES).map(cleanLine);
  return { chart, x, y: pick(s.y, Y_IDS) ?? d.y, lines: lines.length ? lines : d.lines, more: s.more === true };
}

// ---- URL

// A line is written as `kl=COURSE:day:band:section:instructor` (lines with no course are left out); only `%` and `:` need escaping (the URL layer escapes the rest once).
const esc = (v: string) => v.replace(/[%:]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const lineToken = (l: LineSpec): string => [l.course, ...NARROW_KEYS.map((k) => l[k] ?? '')].map(esc).join(':');

function lineFromToken(t: string): LineSpec | null {
  const parts = t.split(':');
  if (parts.length !== 1 + NARROW_KEYS.length) return null;
  try {
    const [course, ...rest] = parts.map(decodeURIComponent);
    return cleanLine({ course, ...Object.fromEntries(NARROW_KEYS.map((k, i) => [k, rest[i]])) });
  } catch {
    return null;
  }
}

/** Query string for a spec (without a leading '?'); only values that differ from the defaults are written. */
export function encodeSpec(spec: Partial<BuilderSpec>): string {
  const s = normalizeSpec(spec);
  const d = defaultSpec();
  const p = new URLSearchParams({ v: 'build', kv: SPEC_VERSION });
  if (s.chart !== d.chart) p.set('kt', s.chart);
  if (s.x !== d.x) p.set('kx', s.x);
  if (s.y !== d.y) p.set('ky', s.y);
  if (s.more) p.set('km', '1');
  for (const l of s.lines) if (l.course) p.append('kl', lineToken(l));
  return p.toString();
}

/** The spec in a query string. A missing or unknown version gives the defaults; unknown or invalid values are ignored one by one. */
export function decodeSpec(search: string): BuilderSpec {
  const p = new URLSearchParams(search);
  if (p.get('kv') !== SPEC_VERSION) return defaultSpec();
  return normalizeSpec({
    chart: (p.get('kt') ?? undefined) as ChartType | undefined,
    x: p.get('kx') ?? undefined,
    y: p.get('ky') ?? undefined,
    more: p.get('km') === '1',
    lines: p.getAll('kl').map(lineFromToken).filter((l): l is LineSpec => l !== null),
  });
}
