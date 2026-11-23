import type { APIRoute } from 'astro';
import { readGradreqText } from '../../../lib/gradreq/server';

// SMU course catalogue tags -> site course codes (lib/tags/types.ts). Fetched on demand, never bundled.
export const GET: APIRoute = () =>
  new Response(readGradreqText('tags'), { headers: { 'Content-Type': 'application/json' } });
