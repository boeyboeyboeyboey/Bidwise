// Chart builder data: the Browse manifest plus only the term shards the chart needs, decoded to rows and cached in memory.
// Uses the same URLs and caches as Browse (/data/browse.json, /data/browse/<term>.json), so a term loaded by one mode is free in the other.
import type { BrowseManifest, BrowseRow } from '../browse';
import { fetchManifest, fetchTerm } from '../browseClient';

export const loadManifest = (): Promise<BrowseManifest> => fetchManifest();

/** Terms that have rows, oldest first. */
export const availableTerms = (man: BrowseManifest): string[] => man.terms.filter((t) => t.rows > 0).map((t) => t.term);

/** The default shows the last RECENT_TERMS terms of a regular size (the small Term 3A and 3B are left out); every term is about 12 MB, so it is opt-in. */
export const RECENT_TERMS = 4;
const REGULAR_TERM_ROWS = 1000;

/** Terms to chart, oldest first: the last RECENT_TERMS regular terms, or every term with rows when `more` is set. */
export function termsFor(man: BrowseManifest, more: boolean): string[] {
  if (more) return availableTerms(man);
  return man.terms.filter((t) => t.rows >= REGULAR_TERM_ROWS).slice(-RECENT_TERMS).map((t) => t.term);
}

/** Rows of the given terms, concatenated in manifest (chronological) order. Each term is fetched once per page load. */
export async function loadRows(man: BrowseManifest, terms: readonly string[]): Promise<BrowseRow[]> {
  const order = availableTerms(man).filter((t) => terms.includes(t));
  const parts = await Promise.all(order.map((t) => fetchTerm(man, t)));
  return parts.flat();
}
