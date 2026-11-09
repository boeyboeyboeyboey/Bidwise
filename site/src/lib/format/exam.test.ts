import { describe, expect, it } from 'vitest';
import { formatExam } from './exam';

describe('formatExam', () => {
  it('writes day name, day and short month, then the start time', () => {
    expect(formatExam({ date: '2027-04-29', start: '13:00', end: '15:00' })).toBe('Thu 29 Apr, 13:00');
    expect(formatExam({ date: '2027-05-03', start: '9:30', end: null })).toBe('Mon 3 May, 09:30');
  });
  it('is empty for no exam or an unreadable or impossible date', () => {
    expect(formatExam(null)).toBe('');
    expect(formatExam(undefined)).toBe('');
    expect(formatExam({ date: '29-Apr-2027', start: '13:00', end: null })).toBe('');
    expect(formatExam({ date: '2027-02-30', start: '13:00', end: null })).toBe('');
  });
});
