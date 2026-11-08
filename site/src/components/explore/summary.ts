import { sortWindows } from '../course/history';
import type { Row } from './rows';

/** How many of the most recent bidding windows the summary looks at. */
export const SUMMARY_WINDOWS = 6;

const eD = (x: number): string => `e$${x.toFixed(2)}`;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One plain line per course: did it fill after recent windows, and what the winning bids were last term. */
export function bidSummary(rows: Row[], codes: string[]): string[] {
  return codes.map((code) => {
    const mine = rows.filter((r) => r.course === code);
    // Only windows where the chosen sections had seats to give out.
    const open = mine.filter((r) => r.seatsOffered > 0);
    if (open.length === 0) return `${code}: no past bidding data for this selection.`;

    // Windows in time order: by term, then by window within the term.
    const termsOrdered = [...new Set(open.map((r) => r.term))].sort();
    const windows: { term: string; window: string; full: boolean }[] = [];
    for (const term of termsOrdered) {
      const inTerm = open.filter((r) => r.term === term);
      for (const window of sortWindows(inTerm.map((r) => r.window))) {
        windows.push({ term, window, full: inTerm.some((r) => r.window === window && r.filled) });
      }
    }
    const recent = windows.slice(-SUMMARY_WINDOWS);
    const full = recent.filter((w) => w.full).length;
    const several = new Set(open.map((r) => r.section)).size > 1;
    const who = several ? 'at least one section was full' : 'it was full';
    const span = recent.length === SUMMARY_WINDOWS ? `the last ${recent.length} windows` : `the ${recent.length} window${recent.length === 1 ? '' : 's'} on record`;
    const fills = full === 0
      ? `no section was full after the window in ${span}`
      : `${who} after the window in ${full} of ${span}`;

    const lastTerm = termsOrdered[termsOrdered.length - 1];
    const bids = mine.filter((r) => r.term === lastTerm && r.medianE !== null).map((r) => r.medianE as number);
    const bid = bids.length ? `median winning bid ${eD(median(bids))} in ${lastTerm}` : `no winning bids recorded in ${lastTerm}`;
    return `${code}: ${fills}; ${bid}.`;
  });
}
