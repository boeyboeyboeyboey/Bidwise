// Chart builder data: the Browse manifest plus only the term shards a spec needs, decoded to rows and cached in memory.
// Uses the same URLs and caches as Browse (/data/browse.json, /data/browse/<term>.json), so a term loaded by one mode is free in the other.
import { termsToLoad, type BrowseManifest, type BrowseRow } from '../browse';
import { fetchManifest, fetchTerm } from '../browseClient';
import type { Filter } from './query';

export const loadManifest = (): Promise<BrowseManifest> => fetchManifest();

/** Terms that have rows, oldest first. */
export const availableTerms = (man: BrowseManifest): string[] => man.terms.filter((t) => t.rows > 0).map((t) => t.term);

/**
 * The terms a spec's filters ask for, oldest first: the `in` list of a filter on `term` (unknown terms dropped); with no such filter, the latest
 * term with results, or every term when `noFilter` is 'all'. Loading all terms is about 12 MB of JSON, so the UI should choose it deliberately.
 */
export function termsForFilters(man: BrowseManifest, filters: readonly Filter[], noFilter: 'latest' | 'all' = 'latest'): string[] {
  const all = availableTerms(man);
  const f = filters.find((x) => x.field === 'term' && x.in && x.in.length);
  if (f) {
    const want = new Set(f.in);
    return all.filter((t) => want.has(t));
  }
  return noFilter === 'all' ? all : termsToLoad(man, '');
}

/** Rows of the given terms, concatenated in manifest (chronological) order. Each term is fetched once per page load. */
export async function loadRows(man: BrowseManifest, terms: readonly string[]): Promise<BrowseRow[]> {
  const order = availableTerms(man).filter((t) => terms.includes(t));
  const parts = await Promise.all(order.map((t) => fetchTerm(man, t)));
  return parts.flat();
}

/** Manifest and rows for a spec's filters in one call. */
export async function loadForFilters(filters: readonly Filter[], noFilter: 'latest' | 'all' = 'latest'): Promise<{ manifest: BrowseManifest; terms: string[]; rows: BrowseRow[] }> {
  const manifest = await loadManifest();
  const terms = termsForFilters(manifest, filters, noFilter);
  return { manifest, terms, rows: await loadRows(manifest, terms) };
}
