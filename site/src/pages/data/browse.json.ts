import type { APIRoute } from 'astro';
import { readBrowseManifestText } from '../../lib/data/browseServer';

export const GET: APIRoute = () =>
  new Response(readBrowseManifestText(), { headers: { 'Content-Type': 'application/json' } });
