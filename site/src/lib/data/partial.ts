// Partly released results: the notice text and which sections are still waiting.
import type { ResultsPartial } from './types';

const nf = new Intl.NumberFormat('en-SG');

/** One short line, e.g. "Round 1B Window 1 results: 3,900 of about 4,050 released so far. We'll update when the rest are out." */
export function partialNotice(p: ResultsPartial): string {
  const head = p.expected > 0
    ? `${p.window} results: ${nf.format(p.posted)} of about ${nf.format(p.expected)} released so far.`
    : `${p.window} results: only some released so far.`;
  return `${head} We'll update when the rest are out.`;
}

/**
 * True for a current-term section with no result row in the window that is still being released.
 * `latestWindow` is the newest window with results; `hasRow` says whether this section has a row in it.
 * Only call once the course's history has loaded (before that nothing is known).
 */
export function resultsPending(p: ResultsPartial | null | undefined, latestWindow: string, hasRow: boolean): boolean {
  return !!p && p.window === latestWindow && !hasRow;
}
