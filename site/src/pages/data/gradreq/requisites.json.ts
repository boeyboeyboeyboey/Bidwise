import type { APIRoute } from 'astro';
import { readGradreqText } from '../../../lib/gradreq/server';

export const GET: APIRoute = () =>
  new Response(readGradreqText('requisites'), { headers: { 'Content-Type': 'application/json' } });
