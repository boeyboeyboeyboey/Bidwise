import type { APIRoute, GetStaticPaths } from 'astro';
import { getCourseIndex } from '../../../lib/data';
import { readCourseText } from '../../../lib/data/server';

// One static JSON per course, fetched by the course page and Past data on demand.
export const getStaticPaths: GetStaticPaths = () => getCourseIndex().map((c) => ({ params: { code: c.code } }));

export const GET: APIRoute = ({ params }) =>
  new Response(readCourseText(params.code!), { headers: { 'Content-Type': 'application/json' } });
