import type { APIRoute, GetStaticPaths } from 'astro';
import { gradreqViewIds, readGradreqText } from '../../../lib/gradreq/server';

// One static JSON per requirement view, fetched when a programme is picked.
export const getStaticPaths: GetStaticPaths = () => gradreqViewIds().map((view) => ({ params: { view } }));

export const GET: APIRoute = ({ params }) =>
  new Response(readGradreqText(params.view!), { headers: { 'Content-Type': 'application/json' } });
