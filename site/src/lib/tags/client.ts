// Browser-side loader of /data/gradreq/tags.json (pages/data/gradreq/tags.json.ts), fetched once and cached.
// Any failure gives null, so callers simply show no tags.
import type { TagsFile } from './types';

let p: Promise<TagsFile | null> | null = null;

export function fetchTags(): Promise<TagsFile | null> {
  p ??= fetch('/data/gradreq/tags.json')
    .then((r) => (r.ok ? (r.json() as Promise<TagsFile>) : null))
    .catch(() => null)
    .then((d) => {
      if (!d) p = null; // retry next time
      return d;
    });
  return p;
}
