// Browser-side loaders. Per-course history is a static file at /data/courses/<code>.json
// (emitted at build by pages/data/courses/[code].json.ts), fetched on demand and cached.
import type { CourseData, CourseIndexEntry } from './types';

const courses = new Map<string, Promise<CourseData>>();
let indexP: Promise<CourseIndexEntry[]> | null = null;

export function fetchCourse(code: string): Promise<CourseData> {
  let p = courses.get(code);
  if (!p) {
    p = fetch(`/data/courses/${encodeURIComponent(code)}.json`).then((r) => {
      if (!r.ok) throw new Error(`course ${code}: ${r.status}`);
      return r.json() as Promise<CourseData>;
    });
    p.catch(() => courses.delete(code));
    courses.set(code, p);
  }
  return p;
}

export function fetchIndex(): Promise<CourseIndexEntry[]> {
  indexP ??= fetch('/data/index.json').then((r) => {
    if (!r.ok) throw new Error(`index: ${r.status}`);
    return r.json() as Promise<CourseIndexEntry[]>;
  });
  indexP.catch(() => (indexP = null));
  return indexP;
}
