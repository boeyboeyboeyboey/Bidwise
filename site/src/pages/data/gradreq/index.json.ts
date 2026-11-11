import type { APIRoute } from 'astro';
import { readGradreqText } from '../../../lib/gradreq/server';

// Degree, major, track and second-major index for "I don't know what to take". Fetched on demand, never bundled.
export const GET: APIRoute = () =>
  new Response(readGradreqText('index'), { headers: { 'Content-Type': 'application/json' } });
