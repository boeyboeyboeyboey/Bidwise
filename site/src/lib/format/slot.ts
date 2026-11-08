/** Day and time of a section, as text: "Mon 12:00–15:15", "Mon, Thu 12:00–15:15". */

/** A live section meeting (Section.meetings). TBA meetings have day 'TBA' and null times. */
export interface SlotMeeting {
  day?: string | null;
  start?: string | null;
  end?: string | null;
}

/** A history row (HistoryRow, browse rows): meetings joined as "MON; THU", "08:15; 08:15", "09:00; 09:45", index-aligned. */
export interface SlotRow {
  days?: string | null;
  start?: string | null;
  end?: string | null;
}

export type SlotInput = readonly SlotMeeting[] | SlotRow | SlotMeeting | null | undefined;

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SEPARATOR = /\s*[;,]\s*/;

const dayOf = (d: string | null | undefined): number => {
  const i = DAYS.findIndex((x) => x.toLowerCase() === (d ?? '').trim().slice(0, 3).toLowerCase());
  return i;
};

const timeOf = (t: string | null | undefined): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec((t ?? '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};

function meetingsOf(input: SlotInput): SlotMeeting[] {
  if (!input) return [];
  if (Array.isArray(input)) return input as SlotMeeting[];
  const o = input as SlotRow & SlotMeeting;
  if (typeof o.days === 'string') {
    const days = o.days.split(SEPARATOR);
    const starts = (o.start ?? '').split(SEPARATOR);
    const ends = (o.end ?? '').split(SEPARATOR);
    // A single time shared by every day, or one per day; anything else is not trusted.
    const at = (xs: string[], i: number) => (xs.length === days.length ? xs[i] : xs.length === 1 ? xs[0] : '');
    return days.map((day, i) => ({ day, start: at(starts, i), end: at(ends, i) }));
  }
  return [o];
}

/**
 * "Mon 12:00–15:15"; meetings sharing a time are joined by day ("Mon, Thu 12:00–15:15"), meetings at different times
 * are separated by " · " ("Mon 08:15–09:00 · Thu 08:15–09:45"). Days come out in week order, once each.
 * Accepts a Section's meetings, or a history row's days/start/end. Returns '' when no meeting has a known day and a start time
 * (TBA, empty, malformed), so callers choose their own fallback such as "Time not set".
 */
export function formatSlot(input: SlotInput): string {
  const groups = new Map<string, Set<number>>();
  for (const m of meetingsOf(input)) {
    const d = dayOf(m.day);
    const start = timeOf(m.start);
    if (d < 0 || !start) continue;
    const end = timeOf(m.end);
    const key = end ? `${start}–${end}` : start;
    (groups.get(key) ?? groups.set(key, new Set()).get(key)!).add(d);
  }
  return [...groups]
    .map(([range, days]) => ({ range, days: [...days].sort((a, b) => a - b) }))
    .sort((a, b) => a.days[0] - b.days[0] || a.range.localeCompare(b.range))
    .map(({ range, days }) => `${days.map((d) => DAYS[d]).join(', ')} ${range}`)
    .join(' · ');
}
