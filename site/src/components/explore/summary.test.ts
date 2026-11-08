import { describe, expect, it } from 'vitest';
import { bidSummary } from './summary';
import type { Row } from './rows';

const row = (o: Partial<Row>): Row => ({
  course: 'IS215', section: 'G1', instructor: 'A', day: 'Mon', start: '08:15', term: '2025-26 Term 2',
  window: 'Round 1 Window 1', medianE: 10, minE: 5, seatsOffered: 40, seatsLeft: 0, filled: true, ...o,
});

describe('bidSummary', () => {
  it('counts full windows among the last six and quotes the last term median', () => {
    const rows = ['Round 1 Window 1', 'Round 1 Window 2', 'Round 1A Window 1', 'Round 1B Window 1', 'Round 2 Window 1', 'Round 2A Window 1'].map((w, i) =>
      row({ term: '2026-27 Term 1', window: w, medianE: 20, filled: i !== 2, seatsLeft: i === 2 ? 3 : 0 }));
    expect(bidSummary(rows, ['IS215'])).toEqual([
      'IS215: it was full after the window in 5 of the last 6 windows; median winning bid e$20.00 in 2026-27 Term 1.',
    ]);
  });

  it('drops windows older than the last six', () => {
    const ws = ['Round 1 Window 1', 'Round 1 Window 2', 'Round 1A Window 1', 'Round 1B Window 1', 'Round 2 Window 1', 'Round 2A Window 1', 'Round 2A Window 2'];
    const rows = ws.map((w, i) => row({ term: '2026-27 Term 1', window: w, filled: i > 0, seatsLeft: i > 0 ? 0 : 5 }));
    expect(bidSummary(rows, ['IS215'])[0]).toContain('in 6 of the last 6 windows');
  });

  it('says "at least one section" for several sections and takes the median of medians', () => {
    const rows = [
      row({ section: 'G1', medianE: 10, filled: false, seatsLeft: 4 }),
      row({ section: 'G2', medianE: 30, filled: true }),
      row({ section: 'G3', medianE: 20, filled: false, seatsLeft: 1 }),
    ];
    expect(bidSummary(rows, ['IS215'])[0]).toBe(
      'IS215: at least one section was full after the window in 1 of the 1 window on record; median winning bid e$20.00 in 2025-26 Term 2.',
    );
  });

  it('handles never full, no winning bids and no data', () => {
    const rows = [row({ filled: false, seatsLeft: 10, medianE: null, minE: null })];
    expect(bidSummary(rows, ['IS215', 'ACCT101'])).toEqual([
      'IS215: no section was full after the window in the 1 window on record; no winning bids recorded in 2025-26 Term 2.',
      'ACCT101: no past bidding data for this selection.',
    ]);
    expect(bidSummary([row({ seatsOffered: 0 })], ['IS215'])[0]).toBe('IS215: no past bidding data for this selection.');
  });
});
