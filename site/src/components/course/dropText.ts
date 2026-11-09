// "Seat may open" line for a full section. Pure, so it is unit tested (dropText.test.ts).
import type { DropChance } from '../../lib/data/types';

/** Nearest 5%, never 0% or 100%: the figure is an estimate from past terms, not a promise. */
export function dropPct(p: number): string {
  const r = Math.round((p * 100) / 5) * 5;
  if (r < 5) return '<5%';
  if (r > 95) return '>95%';
  return `${r}%`;
}

const roundOf = (w: string): string => /^Round (\w+) Window/.exec(w)?.[1] ?? w;

export interface DropLine {
  /** One line, e.g. "Seat may open: ~15% by Round 1B Window 2, ~60% by Round 2 Window 1". */
  text: string;
  /** Paragraphs for the InfoTip. */
  tip: string[];
}

/**
 * Next window, plus the first window of the next round (where most seats come back), when that is a different round.
 * Null when there is no estimate.
 */
export function dropLine(d: DropChance | null | undefined, code: string): DropLine | null {
  const steps = d?.steps ?? [];
  if (!steps.length) return null;
  const first = steps[0];
  const nextRound = steps.find((s) => roundOf(s.w) !== roundOf(first.w));
  const shown = nextRound ? [first, nextRound] : [first];
  const text = `Seat may open: ${shown.map((s) => `${s.p < 0.025 || s.p > 0.975 ? '' : '~'}${dropPct(s.p)} by ${s.w}`).join(', ')}`;
  const subject = code.replace(/\d.*$/, '');
  const where = first.l === 'c' ? ` ${code}` : first.l === 's' ? ` ${subject}` : '';
  return {
    text,
    tip: [
      `Based on ${first.n} past cases of a full${where} section, counting how often a seat was offered again later in the term.`,
      `Chance of a seat by each window: ${steps.map((s) => `${s.w} ${dropPct(s.p)}`).join(', ')}.`,
      'Only an estimate from earlier terms. A seat that opens can be taken straight away.',
    ],
  };
}
