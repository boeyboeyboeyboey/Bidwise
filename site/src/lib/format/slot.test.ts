import { describe, expect, it } from 'vitest';
import { formatSlot } from './slot';

const m = (day: string, start: string | null, end: string | null) => ({ day, start, end, venue: null });

describe('formatSlot', () => {
  it('formats one meeting', () => {
    expect(formatSlot([m('MON', '12:00', '15:15')])).toBe('Mon 12:00–15:15');
  });
  it('joins days that share a time, in week order', () => {
    expect(formatSlot([m('THU', '12:00', '15:15'), m('MON', '12:00', '15:15')])).toBe('Mon, Thu 12:00–15:15');
  });
  it('keeps different times apart', () => {
    expect(formatSlot([m('MON', '08:15', '09:00'), m('THU', '08:15', '09:45')])).toBe('Mon 08:15–09:00 · Thu 08:15–09:45');
  });
  it('returns an empty string for TBA, empty and missing data', () => {
    expect(formatSlot([m('TBA', null, null)])).toBe('');
    expect(formatSlot([])).toBe('');
    expect(formatSlot(null)).toBe('');
    expect(formatSlot(undefined)).toBe('');
    expect(formatSlot({ days: '', start: '', end: '' })).toBe('');
    expect(formatSlot({ days: 'TBA', start: 'TBA', end: 'TBA' })).toBe('');
    expect(formatSlot([m('MON', null, null)])).toBe('');
  });
  it('skips a TBA meeting beside a real one', () => {
    expect(formatSlot([m('TBA', null, null), m('TUE', '15:30', '18:45')])).toBe('Tue 15:30–18:45');
  });
  it('reads a history row with one meeting', () => {
    expect(formatSlot({ days: 'WED', start: '19:00', end: '22:15' })).toBe('Wed 19:00–22:15');
  });
  it('reads a history row with index-aligned lists', () => {
    expect(formatSlot({ days: 'MON; THU', start: '08:15; 08:15', end: '09:00; 09:45' })).toBe('Mon 08:15–09:00 · Thu 08:15–09:45');
    expect(formatSlot({ days: 'THU; TUE', start: '12:00; 12:00', end: '15:15; 15:15' })).toBe('Tue, Thu 12:00–15:15');
  });
  it('collapses a repeated day with the same time', () => {
    expect(formatSlot({ days: 'MON; MON', start: '09:00; 09:00', end: '10:00; 10:00' })).toBe('Mon 09:00–10:00');
  });
  it('ignores a history row whose time lists do not line up with its days', () => {
    expect(formatSlot({ days: 'MON; THU', start: '09:00; 10:00; 11:00', end: '10:00' })).toBe('');
  });
  it('accepts full day names, any case, and unpadded hours', () => {
    expect(formatSlot([m('Monday', '9:00', '12:15')])).toBe('Mon 09:00–12:15');
  });
  it('shows the start alone when the end is missing', () => {
    expect(formatSlot([m('FRI', '09:00', null)])).toBe('Fri 09:00');
  });
  it('drops an unknown day', () => {
    expect(formatSlot([m('XYZ', '09:00', '10:00')])).toBe('');
  });
});
