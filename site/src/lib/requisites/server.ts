// Build-time read of src/data/real/gradreq/course-requisites.json. Used only by pages/course/[code].astro;
// never import it from client code. A missing or malformed file gives null, so the page builds without the block.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RequisitesFile } from './types';

// Astro builds run from site/; import.meta.url points at a bundled chunk, so resolve from cwd.
const FILE = join(process.cwd(), 'src/data/real/gradreq/course-requisites.json');

let cached: RequisitesFile | null | undefined;

export function readRequisites(): RequisitesFile | null {
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<RequisitesFile> | null;
    const ok = j && typeof j === 'object' && typeof j.asOf === 'string' && j.courses && typeof j.courses === 'object' && !Array.isArray(j.courses);
    if (ok) cached = { asOf: j.asOf!, courses: j.courses!, names: j.names && typeof j.names === 'object' ? j.names : {} };
  } catch {
    cached = null;
  }
  return cached;
}
