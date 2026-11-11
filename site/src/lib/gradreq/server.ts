// Build-time reads of src/data/real/gradreq/. Used only by the static endpoints in pages/data/gradreq/;
// never import it from client code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GradIndex } from './types';

// Astro builds run from site/; import.meta.url points at a bundled chunk, so resolve from cwd.
const DIR = join(process.cwd(), 'src/data/real/gradreq');

export function readGradreqText(name: string): string {
  return readFileSync(join(DIR, `${name}.json`), 'utf8');
}

/** Ids of every requirement view the index points at (degrees, majors, tracks and second majors). */
export function gradreqViewIds(): string[] {
  const index = JSON.parse(readGradreqText('index')) as GradIndex;
  const ids = new Set<string>();
  const addMap = (m: Record<string, string>) => Object.values(m).forEach((id) => ids.add(id));
  for (const s of index.schools) {
    for (const d of s.degrees) {
      addMap(d.views);
      for (const t of d.tracks ?? []) addMap(t.views);
      for (const m of d.majors ?? []) {
        addMap(m.views);
        for (const t of m.tracks ?? []) addMap(t.views);
      }
      for (const sm of d.secondMajors ?? []) for (const es of Object.values(sm.views)) es.forEach((e) => ids.add(e.id));
    }
  }
  return [...ids];
}
