import { describe, expect, it } from 'vitest';
import { refitNote } from './refitNote';

const full = { refitAt: '2026-11-12T14:41:46+08:00', afterWindow: 'Round 1B Window 2', newBids: 993 };

describe('refitNote', () => {
  it('writes the date, the window and the bid count', () => {
    expect(refitNote(full)).toBe('Forecast refit 12 Nov after Round 1B Window 2 results (993 new bids)');
  });
  it('drops the parts that are missing', () => {
    expect(refitNote({ refitAt: full.refitAt })).toBe('Forecast refit 12 Nov');
    expect(refitNote({ ...full, newBids: undefined })).toBe('Forecast refit 12 Nov after Round 1B Window 2 results');
    expect(refitNote({ ...full, afterWindow: undefined })).toBe('Forecast refit 12 Nov (993 new bids)');
  });
  it('is null without a usable refit time', () => {
    expect(refitNote({})).toBeNull();
    expect(refitNote({ ...full, refitAt: 'nonsense' })).toBeNull();
    expect(refitNote(undefined)).toBeNull();
  });
  it('reads the day in Singapore time, not the viewer\'s', () => {
    expect(refitNote({ refitAt: '2026-11-12T20:30:00+00:00' })).toBe('Forecast refit 13 Nov');
  });
  it('counts one bid in the singular and groups thousands', () => {
    expect(refitNote({ refitAt: full.refitAt, newBids: 1 })).toBe('Forecast refit 12 Nov (1 new bid)');
    expect(refitNote({ refitAt: full.refitAt, newBids: 1234 })).toBe('Forecast refit 12 Nov (1,234 new bids)');
  });
});
