import type { Section } from '../../lib/data/types';
import { seatsLeftNow } from '../../lib/data/seats';

/** Sections with seats first, then section codes in natural order (G1, G2, ... G10). */
export function orderSections<T extends Pick<Section, 'seatsLeft' | 'section' | 'live'>>(sections: readonly T[]): T[] {
  return [...sections].sort(
    (a, b) => Number(seatsLeftNow(b) > 0) - Number(seatsLeftNow(a) > 0) || a.section.localeCompare(b.section, undefined, { numeric: true }),
  );
}

/** A row's suggested bid (cents) and the chance of a seat at that bid, for one person. */
export interface RowBid {
  cents: number;
  p: number;
}
