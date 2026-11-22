// Professor name helpers. Pure and client-safe (no server imports): used by course pages to link instructor names,
// and re-exported from ./professors for the server-side profile builder.
import { instructorKey, titleName } from './format';

const WORD_SPLIT = /\s+/;
const wordCount = (s: string): number => s.split(WORD_SPLIT).length;

/**
 * Comma parts of one chunk, merged left to right the way BOSS writes "SURNAME GIVEN, ENGLISHNAME". A one-word part
 * followed by another one-word part forms one person ("YU, SHIHAO"). Otherwise a one-word part joins the person
 * before it, or the part after it when nothing comes before. Parts of two or more words stay separate people.
 */
export function mergeCommaParts(chunk: string): string[] {
  const parts = chunk.split(',').map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (wordCount(p) !== 1) {
      out.push(p);
      continue;
    }
    const next = parts[i + 1];
    if (next !== undefined && wordCount(next) === 1) {
      out.push(`${p}, ${next}`);
      i++;
    } else if (out.length) {
      out[out.length - 1] += `, ${p}`;
    } else if (next !== undefined) {
      out.push(`${p}, ${next}`);
      i++;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Splits a raw BOSS instructor field into single names. Empty names and repeats (by profKey) are dropped. */
export function splitInstructors(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const t = name.trim();
    const k = instructorKey(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  // "S/O" and "D/O" (son/daughter of) are part of one name, not a separator.
  for (const chunk of raw.split(/(?<!\b[SD])\/(?!O\b)|&|;|\s+and\s+/i)) mergeCommaParts(chunk).forEach(add);
  return out;
}

/** Same normalisation as sameInstructor: capitals and letters only. */
export const profKey = (name: string): string => instructorKey(name);

/** Lowercase, non-alphanumerics to a single "-", trimmed of "-". */
export function profSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Profile link for one instructor name. Same trailing-slash form as the other site links (e.g. /course/<code>/history/). */
export function profHref(name: string): string {
  // Keys hold only A-Z and single spaces, so each slug is unique per key and assignSlugs never adds a suffix here.
  return `/prof/${profSlug(profKey(name)) || 'prof'}/`;
}

/** Each instructor on a raw BOSS field: the name as split, its display form (titleName) and its profile link. */
export function instructorLinks(raw: string | null | undefined): { name: string; display: string; href: string }[] {
  return splitInstructors(raw).map((name) => ({ name, display: titleName(name), href: profHref(name) }));
}
