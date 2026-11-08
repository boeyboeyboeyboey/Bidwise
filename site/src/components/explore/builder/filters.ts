// Filter chips: how the builder's filter list reads and changes a BuilderSpec. Pure and DOM-free.
// The term filter belongs to the Terms control (controls.ts), so it is not listed here.
import { FIELDS, fieldById, type Field } from './fields';
import { normalizeSpec, type BuilderSpec } from './spec';
import { NONE, type Filter } from './query';

/** Fields a chip can filter on. */
export const FILTER_FIELDS: Field[] = FIELDS.filter((f) => f.id !== 'term');

/** The chips: every filter except the term one. */
export const chipFilters = (s: BuilderSpec): Filter[] => s.filters.filter((f) => f.field !== 'term');

export const filterFor = (s: BuilderSpec, field: string): Filter | undefined => s.filters.find((f) => f.field === field);

/** Replaces the field's filter in place (a new one goes last), or removes it. */
const withFilter = (s: BuilderSpec, field: string, next: Filter | null): BuilderSpec => {
  const has = s.filters.some((f) => f.field === field);
  const filters = next
    ? has ? s.filters.map((f) => (f.field === field ? next : f)) : [...s.filters, next]
    : s.filters.filter((f) => f.field !== field);
  return normalizeSpec({ ...s, filters });
};

/** Category or bool values; an empty list removes the filter. */
export const setFilterValues = (s: BuilderSpec, field: string, values: readonly string[]): BuilderSpec =>
  withFilter(s, field, values.length ? { field, in: [...values] } : null);

export function toggleFilterValue(s: BuilderSpec, field: string, value: string): BuilderSpec {
  const cur = filterFor(s, field)?.in ?? [];
  return setFilterValues(s, field, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
}

/** Number range from the two input texts; an empty or invalid text leaves that end open, and both open removes the filter. */
export function setFilterRange(s: BuilderSpec, field: string, min: string, max: string): BuilderSpec {
  const num = (t: string) => (t.trim() !== '' && Number.isFinite(Number(t)) ? Number(t) : undefined);
  const lo = num(min);
  const hi = num(max);
  const f: Filter = { field };
  if (lo !== undefined) f.min = lo;
  if (hi !== undefined) f.max = hi;
  return withFilter(s, field, lo === undefined && hi === undefined ? null : f);
}

export const removeFilter = (s: BuilderSpec, field: string): BuilderSpec => withFilter(s, field, null);

/** A value of a bool filter as shown ("true" is Yes). */
const BOOL_TEXT: Record<string, string> = { true: 'Yes', false: 'No' };

/** Chip text: "Course: 3", "Course: ACCT101" for one value, "Median bid 20–80", "Median bid ≥ 20". */
export function filterSummary(f: Filter): string {
  const field = fieldById(f.field);
  const label = field?.label ?? f.field;
  if (f.in && f.in.length) {
    if (field?.kind === 'bool') return `${label}: ${f.in.map((v) => BOOL_TEXT[v] ?? v).join(', ')}`;
    return `${label}: ${f.in.length === 1 ? (f.in[0] === NONE ? (field?.noneLabel ?? NONE) : f.in[0]) : f.in.length}`;
  }
  const fmt = (v: number) => (field?.kind === 'number' && field.id === 'start' ? field.fmt(v) : String(v));
  if (f.min !== undefined && f.max !== undefined) return `${label} ${fmt(f.min)}–${fmt(f.max)}`;
  if (f.min !== undefined) return `${label} ≥ ${fmt(f.min)}`;
  if (f.max !== undefined) return `${label} ≤ ${fmt(f.max)}`;
  return label;
}

/** Choices matching a search text (code or label, case-insensitive), selected values first, at most `cap`. */
export function searchChoices<T extends { value: string; label: string }>(choices: readonly T[], query: string, selected: readonly string[], cap = 60): { shown: T[]; total: number } {
  const q = query.trim().toLowerCase();
  const sel = new Set(selected);
  const hits = q ? choices.filter((c) => c.label.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)) : [...choices];
  const ordered = [...hits.filter((c) => sel.has(c.value)), ...hits.filter((c) => !sel.has(c.value))];
  return { shown: ordered.slice(0, cap), total: hits.length };
}
