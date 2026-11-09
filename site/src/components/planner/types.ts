import type { Role } from '../../lib/sim/planner';

export interface PlanRowState {
  id: string;
  course: string;
  sectionId: string;
  group: number;
  role: Role;
  oneOf: string;
}

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export const GROUP_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** A start time as "08:15" (zero-padded); '' when it is not a time. */
export function startText(start: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((start ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}
/** An avoid-times slot: a day and the start time of a meeting ("Mon-08:15"). */
export const slotOf = (day: string, start: string) => `${day}-${startText(start)}`;
/** True for a slot written by slotOf; old "Mon-morning" entries are not. */
export const isSlot = (x: string): boolean => /^(Mon|Tue|Wed|Thu|Fri)-([01]\d|2[0-3]):[0-5]\d$/.test(x);
