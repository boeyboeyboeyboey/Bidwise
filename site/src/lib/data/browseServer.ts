// Build-time only: the browse manifest and term files written by model/build_site_data.py. Never import from a client island.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/data/real');

export function readBrowseManifestText(): string {
  return readFileSync(join(DIR, 'browse.json'), 'utf8');
}

/** Slugs such as "2025-26-term-2" (the file names under browse/). */
export function browseSlugs(): string[] {
  const man = JSON.parse(readBrowseManifestText()) as { terms: { file: string }[] };
  return man.terms.map((t) => t.file.replace(/^browse\//, '').replace(/\.json$/, ''));
}

export function readBrowseTermText(slug: string): string {
  return readFileSync(join(DIR, 'browse', `${slug}.json`), 'utf8');
}
