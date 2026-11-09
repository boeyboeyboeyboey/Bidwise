import { describe, expect, it } from 'vitest';
import { dropLine, dropPct } from './dropText';

describe('dropPct', () => {
  it('rounds to 5% and never claims 0 or 100', () => {
    expect(dropPct(0.352)).toBe('35%');
    expect(dropPct(0.01)).toBe('<5%');
    expect(dropPct(0.99)).toBe('>95%');
    expect(dropPct(1)).toBe('>95%');
  });
});

describe('dropLine', () => {
  const steps = [
    { w: 'Round 1B Window 2', p: 0.152, n: 109, l: 'c' as const },
    { w: 'Round 2 Window 1', p: 0.62, n: 109, l: 'c' as const },
    { w: 'Round 2 Window 2', p: 0.7, n: 109, l: 'c' as const },
  ];
  it('shows the next window and the next round, with the sample size in the tip', () => {
    const l = dropLine({ from: 'Round 1B Window 1', steps }, 'MGMT102')!;
    expect(l.text).toBe('Seat may open: ~15% by Round 1B Window 2, ~60% by Round 2 Window 1');
    expect(l.tip[0]).toContain('109 past cases of a full MGMT102 section');
  });
  it('shows one window when all remaining windows are in one round, and names the subject or SMU for pooled estimates', () => {
    const l = dropLine({ from: 'x', steps: [{ w: 'Round 2 Window 2', p: 0.4, n: 80, l: 's' }] }, 'MGMT102')!;
    expect(l.text).toBe('Seat may open: ~40% by Round 2 Window 2');
    expect(l.tip[0]).toContain('a full MGMT section');
    expect(dropLine({ from: 'x', steps: [{ w: 'Round 2 Window 2', p: 0.4, n: 900, l: 'g' }] }, 'MGMT102')!.tip[0]).toContain('a full section');
  });
  it('is null without steps', () => {
    expect(dropLine(null, 'A1')).toBeNull();
    expect(dropLine({ from: 'x', steps: [] }, 'A1')).toBeNull();
  });
});
