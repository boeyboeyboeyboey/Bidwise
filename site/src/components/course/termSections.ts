// URL state of the "By term" block on /course/CODE/history/: ?term=<term as in Browse's data>&sec=<section>.
// Other params of the page (e.g. ?i=) are kept as they are.

/** The term and section named by the address; '' when absent. */
export function parseTermParams(search: string): { term: string; sec: string } {
  const p = new URLSearchParams(search);
  return { term: p.get('term')?.trim() ?? '', sec: p.get('sec')?.trim() ?? '' };
}

/** The wanted term when this course has data for it, else the newest term (`terms` is newest first); '' when there are none. */
export function pickTerm(terms: readonly string[], wanted: string): string {
  return terms.includes(wanted) ? wanted : (terms[0] ?? '');
}

/** The query string (with its "?", or '' when empty) after setting term and section; an empty value removes the param. */
export function withTermParams(search: string, term: string, sec: string): string {
  const p = new URLSearchParams(search);
  if (term) p.set('term', term); else p.delete('term');
  if (term && sec) p.set('sec', sec); else p.delete('sec');
  const s = p.toString().replace(/%2C/g, ',');
  return s ? `?${s}` : '';
}
