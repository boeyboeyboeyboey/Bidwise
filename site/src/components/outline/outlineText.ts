// Plain-text helpers for the course outline page. Pure and client-safe, so they stay out of the markup.
import type { OutlineFinal, OutlineGrade, OutlineMidterm, OutlineSection } from '../../lib/data/outlines';

/** Natural order for section codes: G2 before G10. */
export const compareSections = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** Sections other than `i` that use the same outline as section `i`. Empty for a section with no outline. */
export function sameOutline(sections: Pick<OutlineSection, 'section' | 'sha'>[], i: number): string[] {
  const sha = sections[i]?.sha;
  if (!sha) return [];
  return sections.filter((s, j) => j !== i && s.sha === sha).map((s) => s.section);
}

/** True when the sections point at more than one outline. */
export const outlinesDiffer = (sections: Pick<OutlineSection, 'sha'>[]): boolean =>
  new Set(sections.map((s) => s.sha).filter(Boolean)).size > 1;

/** "20%", "33.3%"; "–" when the weight is not stated. */
export const pct = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? `${+n.toFixed(1)}%` : '–');

/** Sum of the stated weights; null when none is stated. */
export function gradingTotal(grading: Pick<OutlineGrade, 'weight_pct'>[]): number | null {
  const w = grading.map((g) => g.weight_pct).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  return w.length ? Math.round(w.reduce((a, b) => a + b, 0) * 10) / 10 : null;
}

/** True when any component says whether it is a group or an individual one. */
export const hasGroupInfo = (grading: Pick<OutlineGrade, 'group'>[]): boolean => grading.some((g) => g.group !== null && g.group !== undefined);

/** "7" -> "Week 7", "1-2" -> "Weeks 1-2"; a label that already has words ("Recess Week", "Week 8") stays as printed. */
export function weekText(label: string | null | undefined): string {
  const t = (label ?? '').trim();
  if (!t) return '';
  if (/^\d+$/.test(t)) return `Week ${t}`;
  if (/^\d+\s*[-–,&]\s*\d+$/.test(t)) return `Weeks ${t}`;
  return t;
}

const BOOK: Record<string, string> = { closed: 'Closed book', open: 'Open book', 'semi-open': 'Semi-open book' };

/** The final exam's one-line facts, in a fixed order: weight, duration, book, online, take-home. */
export function finalLine(f: OutlineFinal): string {
  return [
    f.weight_pct !== null ? pct(f.weight_pct) : '',
    f.duration ?? '',
    f.book ? (BOOK[f.book.toLowerCase()] ?? f.book) : '',
    f.online ? 'Online' : '',
    f.take_home ? 'Take-home' : '',
  ].filter(Boolean).join(' · ');
}

/** "Week 7 · 20%"; null when the outline has no midterm. */
export function midtermLine(m: OutlineMidterm | null): string | null {
  if (!m || !m.exists) return null;
  return [weekText(m.week_label), m.weight_pct !== null ? pct(m.weight_pct) : ''].filter(Boolean).join(' · ') || 'Yes';
}

/** Recess and reading weeks are shown muted. */
export const isBreak = (kind: string): boolean => kind === 'recess' || kind === 'reading';

/** A file name safe for the download attribute. */
export const pdfName = (code: string, section: string): string => `${code}-${section}-outline.pdf`.replace(/[^A-Za-z0-9._-]+/g, '_');
