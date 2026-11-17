import type { APIRoute } from 'astro';
import { readRequisites } from '../../../lib/requisites/server';

// For Browse's course view (lib/requisites/client.ts). No data file: an empty set, so pages show no block.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(readRequisites() ?? { asOf: '', courses: {}, names: {} }), {
    headers: { 'Content-Type': 'application/json' },
  });
