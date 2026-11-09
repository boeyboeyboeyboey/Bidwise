import type { APIRoute } from 'astro';
import { browseSlugs, readBrowseManifestText, readBrowseTermText } from '../../lib/data/browseServer';
import { courseTerms, type BrowseManifest, type BrowseShard } from '../../components/explore/browse';

// Which terms have bid rows for each course (a few KB), so Browse can list a course's terms before loading any term file.
export const GET: APIRoute = () => {
  const man = JSON.parse(readBrowseManifestText()) as BrowseManifest;
  const shards = browseSlugs().map((s) => JSON.parse(readBrowseTermText(s)) as BrowseShard);
  return new Response(JSON.stringify(courseTerms(man, shards)), { headers: { 'Content-Type': 'application/json' } });
};
