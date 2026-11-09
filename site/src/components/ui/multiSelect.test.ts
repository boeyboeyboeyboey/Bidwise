import { describe, expect, it } from 'vitest';
import { multiLabel } from './multiSelect';

describe('multiLabel', () => {
  it('says "any" for no choice, lists up to the limit, then counts', () => {
    expect(multiLabel([], 'Any day', 'days')).toBe('Any day');
    expect(multiLabel(['Mon'], 'Any day', 'days')).toBe('Mon');
    expect(multiLabel(['Mon', 'Wed'], 'Any day', 'days')).toBe('Mon, Wed');
    expect(multiLabel(['Mon', 'Wed', 'Fri'], 'Any day', 'days')).toBe('3 days');
    expect(multiLabel(['Morning', 'Afternoon', 'Evening'], 'Any time', 'times', 3)).toBe('Morning, Afternoon, Evening');
  });
});
