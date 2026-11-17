// Browser-side loader of /data/gradreq/course-requisites.json (pages/data/gradreq/course-requisites.json.ts),
// fetched once and cached. Any failure gives null, so the course view simply shows no requisites.
import type { RequisitesFile } from './types';

let p: Promise<RequisitesFile | null> | null = null;

export function fetchRequisites(): Promise<RequisitesFile | null> {
  p ??= fetch('/data/gradreq/course-requisites.json')
    .then((r) => (r.ok ? (r.json() as Promise<RequisitesFile>) : null))
    .catch(() => null)
    .then((d) => {
      if (!d) p = null; // retry on the next course opened
      return d;
    });
  return p;
}
