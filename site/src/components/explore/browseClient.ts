// Browser-side loaders for Browse: the manifest at /data/browse.json and one file per term at /data/browse/<term>.json
// (emitted at build by pages/data/browse*.json.ts), plus /data/browse-terms.json (which terms have rows for each course).
// Each is fetched once, only when asked for.
import { decodeShard, type BrowseManifest, type BrowseRow, type BrowseShard, type CourseTerms } from './browse';

let manifestP: Promise<BrowseManifest> | null = null;
const terms = new Map<string, Promise<BrowseRow[]>>();

export function fetchManifest(): Promise<BrowseManifest> {
  const p = (manifestP ??= fetch('/data/browse.json').then((r) => {
    if (!r.ok) throw new Error(`browse manifest: ${r.status}`);
    return r.json() as Promise<BrowseManifest>;
  }));
  p.catch(() => (manifestP = null));
  return p;
}

export function fetchTerm(man: BrowseManifest, term: string): Promise<BrowseRow[]> {
  let p = terms.get(term);
  if (!p) {
    const entry = man.terms.find((t) => t.term === term);
    if (!entry) return Promise.resolve([]);
    p = fetch(`/data/${entry.file}`).then((r) => {
      if (!r.ok) throw new Error(`browse ${term}: ${r.status}`);
      return r.json() as Promise<BrowseShard>;
    }).then((s) => decodeShard(man, s));
    p.catch(() => terms.delete(term));
    terms.set(term, p);
  }
  return p;
}

let courseTermsP: Promise<CourseTerms> | null = null;

export function fetchCourseTerms(): Promise<CourseTerms> {
  const p = (courseTermsP ??= fetch('/data/browse-terms.json').then((r) => {
    if (!r.ok) throw new Error(`browse terms: ${r.status}`);
    return r.json() as Promise<CourseTerms>;
  }));
  p.catch(() => (courseTermsP = null));
  return p;
}
