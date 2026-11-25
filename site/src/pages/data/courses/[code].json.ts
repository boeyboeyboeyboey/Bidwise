import type { APIRoute, GetStaticPaths } from 'astro';
import { getCourseIndex } from '../../../lib/data';
import { readCourseText } from '../../../lib/data/server';
import { coarsenCourse } from '../../../lib/data/scanTime';
import type { CourseData } from '../../../lib/data';

// One static JSON per course, fetched by the course page and Past data on demand.
export const getStaticPaths: GetStaticPaths = () => getCourseIndex().map((c) => ({ params: { code: c.code } }));

// Seat update times are cut to the day, so the file is re-serialised rather than copied. A broken file fails the build.
export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(coarsenCourse(JSON.parse(readCourseText(params.code!)) as CourseData)), { headers: { 'Content-Type': 'application/json' } });
