import type { APIRoute } from 'astro';
import { getCourseIndex } from '../../lib/data';
import { latestScan } from '../../lib/data/seats';
import { getCourse } from '../../lib/data/server';
import { buildRows, type ClassesPayload } from '../../components/classes/logic';

// This term's sections as compact rows for the class search page. Reads only fields already in the course files.
export const GET: APIRoute = () => {
  const courses = getCourseIndex()
    .filter((c) => c.offeredNow)
    .map((c) => getCourse(c.code))
    .filter((c): c is NonNullable<typeof c> => !!c);
  const payload: ClassesPayload = { scannedAt: latestScan(courses.flatMap((c) => c.sectionsNow)), rows: buildRows(courses) };
  return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
};
