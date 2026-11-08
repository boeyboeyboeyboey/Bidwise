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
export const BANDS = ['morning', 'afternoon', 'evening'] as const;
export const BAND_LABEL = { morning: 'AM', afternoon: 'PM', evening: 'Eve' } as const;
export const GROUP_LETTERS = ['A', 'B', 'C', 'D'] as const;

export function bandOf(start: string): (typeof BANDS)[number] {
  const h = parseInt(start.slice(0, 2), 10);
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}
export const slotOf = (day: string, start: string) => `${day}-${bandOf(start)}`;
