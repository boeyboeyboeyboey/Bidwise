export type SeatLevel = 'empty' | 'low' | 'some' | 'ok';

/** Ring level and fill (0 to 1) for the room your bidding group has: the seats left, minus the friends beyond the first. */
export function seatRing(left: number, group = 1): { level: SeatLevel; fill: number } {
  if (!Number.isFinite(left) || left <= 0) return { level: 'empty', fill: 0 };
  const room = left - (Math.max(1, Number.isFinite(group) ? group : 1) - 1);
  // Deliberately 'low', not 'empty', when the group outgrows the seats: the section still has seats (the planner shows its limit note).
  if (room <= 1) return { level: 'low', fill: 0.1 };
  if (room < 5) return { level: 'some', fill: room / 10 };
  return { level: 'ok', fill: Math.min(room, 10) / 10 };
}
