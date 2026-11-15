import type { HistoryRow } from './data/types';
import { sortWindows } from '../components/course/history';

/** Build-time facts about a course's past results, for the page's meta description and Dataset JSON-LD. */
export interface CourseFacts {
  /** Terms with at least one winning bid. */
  terms: string[];
  /** The window the figures below come from: Round 1 Window 1 if the course has bids there, else the earliest window with bids. */
  window: string;
  /** Latest term with bids in that window. */
  term: string;
  /** Median of the sections' median winning bids, in cents. */
  medianCents: number;
  /** Lowest winning bid among sections that filled in that window, in cents; null when none filled (an unfilled section's minimum is only the lowest bidder). */
  lowestCents: number | null;
}

const FIRST_WINDOW = 'Round 1 Window 1';
/** A filled section, as model/build_site_data.py counts it: seats offered, none left after the window was processed. */
const filled = (r: HistoryRow) => r.vacancy > 0 && r.after === 0;
const hasBid = (r: HistoryRow) => r.medianCents !== null || r.minCents !== null;
const eS = (cents: number) => `e$${(cents / 100).toFixed(2)}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Null when the course has no past result with a winning bid. */
export function courseFacts(history: HistoryRow[]): CourseFacts | null {
  const rows = history.filter(hasBid);
  if (!rows.length) return null;
  const terms = [...new Set(rows.map((r) => r.term))].sort();
  const windows = new Set(rows.map((r) => r.window));
  const window = windows.has(FIRST_WINDOW) ? FIRST_WINDOW : sortWindows(windows)[0];
  const inWindow = rows.filter((r) => r.window === window);
  const term = [...new Set(inWindow.map((r) => r.term))].sort().pop()!;
  const picked = inWindow.filter((r) => r.term === term);
  const medians = picked.map((r) => r.medianCents).filter((c): c is number => c !== null);
  const mins = picked.filter(filled).map((r) => r.minCents).filter((c): c is number => c !== null);
  // A row with a lowest bid but no median is rare; fall back to the lowest bids so the median stays a real number.
  const medianCents = medians.length ? median(medians) : median(picked.map((r) => r.minCents).filter((c): c is number => c !== null));
  const lowestCents = mins.length ? Math.min(...mins) : null;
  return { terms, window, term, medianCents, lowestCents };
}

export const DESCRIPTION_MAX = 160;
const TITLE_FLOOR = 24;

function fit(title: string, build: (t: string) => string): string | null {
  for (let len = title.length; len >= Math.min(TITLE_FLOOR, title.length); len--) {
    const t = len < title.length ? `${title.slice(0, len - 1).trimEnd()}…` : title;
    const out = build(t);
    if (out.length <= DESCRIPTION_MAX) return out;
  }
  return null;
}

/**
 * Meta description with real numbers when the course has results. When it is too long, the sections clause (course page
 * only) goes first, then the title is shortened; with no results, or no fit, it falls back to the plain sentence.
 */
export function courseDescription(
  code: string, title: string, facts: CourseFacts | null, kind: 'course' | 'history', sectionsNow = 0,
): string {
  const head = (t: string) => (t ? `${code} ${t}` : code);
  const plain = (t: string) => (kind === 'course'
    ? `${head(t)}: past BOSS bid results by window and a forecast of the bid each section needs.`
    : `${head(t)}: past BOSS clearing bids for every window and term.`);
  if (facts) {
    const n = facts.terms.length;
    // The median covers every section, the lowest only filled ones, so the lowest can exceed it; then it would read as a contradiction.
    const low = facts.lowestCents !== null && facts.lowestCents <= facts.medianCents ? `, lowest winning ${eS(facts.lowestCents)}` : '';
    const body = (t: string, sec: string) =>
      `${head(t)}: past BOSS bids over ${n} ${n === 1 ? 'term' : 'terms'}; ${facts.window}, ${facts.term}: median ${eS(facts.medianCents)}${low}.${sec}`;
    const sec = kind === 'course' && sectionsNow > 0 ? ` ${sectionsNow} ${sectionsNow === 1 ? 'section' : 'sections'} this term.` : '';
    const whole = (sc: string) => (`${body(title, sc)}`.length <= DESCRIPTION_MAX ? body(title, sc) : null);
    const out = (sec && whole(sec)) || whole('') || (sec && fit(title, (t) => body(t, sec))) || fit(title, (t) => body(t, ''));
    if (out) return out;
  }
  return fit(title, plain) ?? plain(title);
}

/** schema.org Dataset for a course with past results; no provider or affiliation. */
export function courseDataset(code: string, title: string, description: string, url: string, facts: CourseFacts, siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${title ? `${code} ${title}` : code}: past BOSS bid results`,
    description,
    url,
    creator: { '@type': 'Organization', name: 'Bidwise', url: siteUrl },
    isAccessibleForFree: true,
    keywords: ['SMU BOSS', code, 'bid results', 'course bidding'],
  };
}
