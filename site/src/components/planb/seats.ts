import type { SectionOption } from '../../lib/gradreq';

/** "12" for a scanned section, "~3" when the figure is an estimate from the previous window. */
export const seatText = (s: Pick<SectionOption, 'seatsLeft' | 'seatSource'>): string => `${s.seatSource === 'approx' ? '~' : ''}${s.seatsLeft}`;
