import { describe, expect, it } from 'vitest';
import { dayText, timeText } from './history';

describe('timeText', () => {
  it('reads a two-day history row, which used to come out as "Mon;, Thu"', () => {
    expect(timeText('MON; THU', '08:15; 08:15', '09:45; 09:45')).toBe('Mon, Thu 08:15–09:45');
  });
  it('keeps different times per day apart', () => {
    expect(timeText('MON; THU', '08:15; 09:00', '09:00; 09:45')).toBe('Mon 08:15–09:00 · Thu 09:00–09:45');
  });
  it('falls back when there is no time', () => {
    expect(timeText('TBA', '', '')).toBe('Time not set');
    expect(timeText('', '', '')).toBe('Time not set');
  });
});

describe('dayText', () => {
  it('splits on semicolons as well as commas and spaces', () => {
    expect(dayText('MON; THU')).toBe('Mon, Thu');
    expect(dayText('MON,THU')).toBe('Mon, Thu');
    expect(dayText('TUE')).toBe('Tue');
  });
});
