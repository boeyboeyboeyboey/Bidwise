import { describe, expect, it } from 'vitest';
import { partialNotice, resultsPending } from './partial';

const p = { window: 'Round 1B Window 1', posted: 3900, expected: 4050 };

describe('partialNotice', () => {
  it('names the window and the counts', () => {
    expect(partialNotice(p)).toBe("Round 1B Window 1 results: 3,900 of about 4,050 released so far. We'll update when the rest are out.");
  });
  it('drops the counts when the expected total is unknown', () => {
    expect(partialNotice({ ...p, expected: 0 })).toBe("Round 1B Window 1 results: only some released so far. We'll update when the rest are out.");
  });
});

describe('resultsPending', () => {
  it('is true only for a section with no row in the partial newest window', () => {
    expect(resultsPending(p, 'Round 1B Window 1', false)).toBe(true);
    expect(resultsPending(p, 'Round 1B Window 1', true)).toBe(false);
  });
  it('is false when results are complete or the partial window is not the newest', () => {
    expect(resultsPending(null, 'Round 1B Window 1', false)).toBe(false);
    expect(resultsPending(undefined, 'Round 1B Window 1', false)).toBe(false);
    expect(resultsPending(p, 'Round 1A Window 3', false)).toBe(false);
  });
});
