// Build-time only (reads the course files from disk). Never import from a client island.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import highlights from '../../data/real/highlights.json';
import { getCourseIndex } from './index';
import { topFreed, type FreedRow } from './seatDeltas';
import type { CourseData, ForecastHighlights, WindowHighlights } from './types';

// Astro builds run from site/; import.meta.url points at a bundled chunk, so resolve from cwd.
const DIR = join(process.cwd(), 'src/data/real/courses');

export function readCourseText(code: string): string {
  return readFileSync(join(DIR, `${code}.json`), 'utf8');
}

export function getCourse(code: string): CourseData | undefined {
  try {
    return JSON.parse(readCourseText(code)) as CourseData;
  } catch {
    return undefined;
  }
}

/**
 * Forecast lists for every forecast window, simulated by model/build_site_data.py. Null when empty.
 * The open window's lists are also spread onto the top level (mostContested, easy) because the
 * planner page reads `mostContested` from here.
 */
export function getForecastHighlights(): (ForecastHighlights & WindowHighlights) | null {
  const h = highlights as ForecastHighlights;
  if (!Object.keys(h.byWindow).length) return null;
  return { ...h, ...(h.byWindow[h.window] ?? { mostContested: [], easy: [] }) };
}

/** Sections whose available seats grew most since the window opened (sections with live seat data only), for the home page. */
export function getFreedSeats(limit = 8): FreedRow[] {
  const items = getCourseIndex()
    .filter((c) => c.offeredNow)
    .flatMap((c) => (getCourse(c.code)?.sectionsNow ?? []).map((s) => ({ code: c.code, section: s.section, instructor: s.instructor, classNumber: s.classNumber, live: s.live })));
  return topFreed(items, limit);
}
