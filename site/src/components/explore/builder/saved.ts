// Named charts in localStorage ('bidwise.charts'): newest first, at most MAX_SAVED, every read and write guarded. No cookies.
import { normalizeSpec, type BuilderSpec } from './spec';

export const SAVED_KEY = 'bidwise.charts';
export const MAX_SAVED = 20;

export interface SavedChart {
  name: string;
  spec: BuilderSpec;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSaved(store: Store | null = defaultStore()): SavedChart[] {
  try {
    const raw = store?.getItem(SAVED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const out: SavedChart[] = [];
    for (const e of list) {
      if (e && typeof e.name === 'string' && e.name.trim() && e.spec && typeof e.spec === 'object' && Array.isArray(e.spec.lines)) out.push({ name: e.name.trim().slice(0, 60), spec: normalizeSpec(e.spec) });
    }
    return out.slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

function write(list: SavedChart[], store: Store | null): boolean {
  try {
    if (!store) return false;
    store.setItem(SAVED_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export type SaveResult = { ok: true; list: SavedChart[] } | { ok: false; reason: 'name' | 'full' | 'storage'; list: SavedChart[] };

/** Saves under a name (the same name is replaced). Refuses an empty name and a 21st chart; reports a failed write. */
export function saveChart(name: string, spec: BuilderSpec, store: Store | null = defaultStore()): SaveResult {
  const list = loadSaved(store);
  const n = name.trim().slice(0, 60);
  if (!n) return { ok: false, reason: 'name', list };
  const rest = list.filter((c) => c.name !== n);
  if (rest.length >= MAX_SAVED) return { ok: false, reason: 'full', list };
  const next = [{ name: n, spec: normalizeSpec(spec) }, ...rest];
  return write(next, store) ? { ok: true, list: next } : { ok: false, reason: 'storage', list };
}

export function deleteChart(name: string, store: Store | null = defaultStore()): SavedChart[] {
  const next = loadSaved(store).filter((c) => c.name !== name);
  write(next, store);
  return next;
}
