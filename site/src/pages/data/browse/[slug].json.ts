import type { APIRoute, GetStaticPaths } from 'astro';
import { browseSlugs, readBrowseTermText } from '../../../lib/data/browseServer';

// One static JSON per term, fetched by Past bids > Browse on demand.
export const getStaticPaths: GetStaticPaths = () => browseSlugs().map((slug) => ({ params: { slug } }));

export const GET: APIRoute = ({ params }) =>
  new Response(readBrowseTermText(params.slug!), { headers: { 'Content-Type': 'application/json' } });
