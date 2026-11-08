export type Metric = 'median' | 'min' | 'offered' | 'left' | 'pfill';
export type Dim = 'none' | 'course' | 'section' | 'instructor' | 'day' | 'band' | 'term';
export type XField = 'tw' | 'term' | 'section' | 'instructor' | 'day' | 'band' | 'course';
export type Mark = 'auto' | 'line' | 'dot' | 'bar' | 'area' | 'box';

export const METRICS: Metric[] = ['median', 'min', 'offered', 'left', 'pfill'];
export const DIMS: Dim[] = ['none', 'course', 'section', 'instructor', 'day', 'band', 'term'];
export const XFIELDS: XField[] = ['tw', 'term', 'section', 'instructor', 'day', 'band', 'course'];
export const MARKS: Mark[] = ['auto', 'line', 'dot', 'bar', 'area', 'box'];

/** Compare courses (the chart), Browse all sections (the table) or Build a chart (the builder, loaded on demand). */
export type Mode = 'compare' | 'browse' | 'build';
export const MODES: Mode[] = ['compare', 'browse', 'build'];

export interface ExploreState {
  mode: Mode;
  /** course code -> selected section letters */
  sel: Record<string, string[]>;
  metric: Metric;
  layers: Metric[];
  x: XField;
  mark: Mark;
  log: boolean;
  /** Y axis starts at 0 (always true for bars, areas and non-e$ metrics). */
  zero: boolean;
  color: Dim;
  facet: Dim;
  t0: string;
  t1: string;
  w: string;
  filled: boolean;
  fc: boolean;
  band: boolean;
}

export const defaults = (): ExploreState => ({
  mode: 'compare', sel: {}, metric: 'median', layers: [], x: 'term', mark: 'auto', log: false, zero: false,
  color: 'course', facet: 'none', t0: '', t1: '', w: '', filled: false, fc: false, band: true,
});

const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T =>
  v && (all as readonly string[]).includes(v) ? (v as T) : d;

export function encode(st: ExploreState): string {
  const d = defaults();
  const p = new URLSearchParams();
  if (st.mode !== d.mode) p.set('v', st.mode);
  const codes = Object.keys(st.sel);
  if (codes.length) p.set('c', codes.join(','));
  if (st.metric !== d.metric) p.set('m', st.metric);
  if (st.layers.length) p.set('l', st.layers.join(','));
  if (st.x !== d.x) p.set('x', st.x);
  if (st.mark !== d.mark) p.set('mk', st.mark);
  if (st.log) p.set('log', '1');
  if (st.zero) p.set('z', '1');
  if (st.color !== d.color) p.set('cb', st.color);
  if (st.facet !== d.facet) p.set('fb', st.facet);
  if (st.t0) p.set('t0', st.t0);
  if (st.t1) p.set('t1', st.t1);
  if (st.w) p.set('w', st.w);
  if (st.filled) p.set('fo', '1');
  if (st.fc) p.set('fc', '1');
  if (!st.band) p.set('bd', '0');
  return p.toString();
}

/** A selected course with an empty section list means "all sections", filled in once its data loads. */
export function decode(search: string): ExploreState {
  const p = new URLSearchParams(search);
  const st = defaults();
  st.mode = pick(p.get('v'), MODES, st.mode);
  const subset = new Map<string, string[]>();
  for (const v of p.getAll('s')) {
    const [code, ...rest] = v.split('.');
    subset.set(code, rest);
  }
  for (const code of (p.get('c') ?? '').split(',')) {
    if (code) st.sel[code] = subset.get(code) ?? [];
  }
  st.metric = pick(p.get('m'), METRICS, st.metric);
  st.layers = (p.get('l') ?? '').split(',').filter((m): m is Metric => (METRICS as string[]).includes(m) && m !== st.metric);
  st.x = pick(p.get('x'), XFIELDS, st.x);
  st.mark = pick(p.get('mk'), MARKS, st.mark);
  st.log = p.get('log') === '1';
  st.zero = p.get('z') === '1';
  st.color = pick(p.get('cb'), DIMS, st.color);
  st.facet = pick(p.get('fb'), DIMS, st.facet);
  st.t0 = p.get('t0') ?? '';
  st.t1 = p.get('t1') ?? '';
  st.w = p.get('w') ?? '';
  st.filled = p.get('fo') === '1';
  st.fc = p.get('fc') === '1';
  st.band = p.get('bd') !== '0';
  return st;
}

/** Full encoding including section subsets (the `s` params). `all` maps course code -> every section code. */
export function encodeFull(st: ExploreState, all: Record<string, string[]>): string {
  const p = new URLSearchParams(encode(st));
  for (const [code, sel] of Object.entries(st.sel)) {
    if (sel.length && sel.length < (all[code]?.length ?? 0)) p.append('s', [code, ...sel].join('.'));
  }
  return p.toString();
}
