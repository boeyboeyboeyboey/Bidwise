// Catalogue tag search for the site search box: finds requirement baskets (grad reqs, core areas, tracks)
// by name or nickname. Pure: the component and the index page both import it, and it reads no files.
import type { Tag, TagKind } from '../tags/types';

/** [id, name, kind, number of site courses carrying the tag] */
export type TagEntry = [id: string, name: string, kind: TagKind, n: number];

/** Owner-approved nicknames (24 Nov). Keys are matched as words: case and punctuation don't matter. */
export const TAG_ALIASES: Readonly<Record<string, string>> = {
  TSS: 'Communities - Technology, Science and Society',
  CMW: 'Communities - Cultures of the Modern World',
  'SG Asia': 'Grad Req - SG & Asia Studies (Intake 2024 onwards)',
  SGAS: 'Grad Req - SG & Asia Studies (Intake 2024 onwards)',
  'SG & Asia': 'Grad Req - SG & Asia Studies (Intake 2024 onwards)',
  'Singapore Asia': 'Grad Req - SG & Asia Studies (Intake 2024 onwards)',
  DDA: 'Grad Req - Dig Tech/Data Ana (Intake 2024 onwards)',
  'dig tech': 'Grad Req - Dig Tech/Data Ana (Intake 2024 onwards)',
  'digital tech': 'Grad Req - Dig Tech/Data Ana (Intake 2024 onwards)',
};

/** Lowercase letters and digits, split on everything else: "SG & Asia" -> ["sg", "asia"]. */
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const key = (s: string): string => words(s).join(' ');

const ALIAS_TARGET_BY_KEY = new Map(Object.entries(TAG_ALIASES).map(([alias, name]) => [key(alias), key(name)]));

/** Gradreq and core baskets come before areas and tracks. */
const KIND_RANK: Record<TagKind, number> = { gradreq: 0, core: 0, area: 1, track: 1 };

/** Course-code-looking queries ("ACCT101", "cs-102") belong to course search, so they find no tags. */
const CODE_LIKE = /^[a-z]{2,6}[-.]?\d/i;

export function tagEntries(tags: readonly Tag[]): TagEntry[] {
  return tags.map((t) => [t.id, t.name, t.kind, t.codes.length]);
}

/**
 * Tags matching the query, best first, at most `limit`. An exact nickname comes first. Then every typed word must
 * start a word of the tag name. Ties go to gradreq/core, then shorter names. Queries under 2 characters find nothing.
 */
export function searchTags(entries: readonly TagEntry[], query: string, limit: number): TagEntry[] {
  const q = query.trim();
  if (q.length < 2 || CODE_LIKE.test(q)) return [];
  const qWords = words(q);
  if (!qWords.length) return [];

  const targetKey = ALIAS_TARGET_BY_KEY.get(qWords.join(' '));
  const aliased = targetKey ? entries.find((e) => key(e[1]) === targetKey) : undefined;

  const prefixHits = entries
    .filter((e) => e !== aliased && qWords.every((w) => words(e[1]).some((t) => t.startsWith(w))))
    .sort((a, b) => KIND_RANK[a[2]] - KIND_RANK[b[2]] || a[1].length - b[1].length || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

  return [...(aliased ? [aliased] : []), ...prefixHits].slice(0, limit);
}
