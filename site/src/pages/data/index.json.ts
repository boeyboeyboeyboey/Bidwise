import type { APIRoute } from 'astro';
import { getCourseIndex } from '../../lib/data';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getCourseIndex()), { headers: { 'Content-Type': 'application/json' } });
