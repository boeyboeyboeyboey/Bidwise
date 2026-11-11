import { describe, expect, it } from 'vitest';
import { eligibility } from './eligibility';
import type { Requisites } from './types';

const req: Requisites = {
  BARE: { prereq: 'A' },
  ANDOR: { prereq: ['and', 'A', ['or', 'B', 'C']] },
  ANTI: { antireq: ['or', 'X', 'Y'] },
  BOTH: { prereq: 'A', antireq: 'X' },
  UNSURE: { uncertain: true },
  UNSURE_MET: { prereq: 'A', uncertain: true },
  EMPTY_AND: { prereq: ['and'] },
};

describe('eligibility', () => {
  const c = (...xs: string[]) => new Set(xs);

  it('is ok with no entry', () => {
    expect(eligibility('NOPE', c(), req)).toBe('ok');
  });

  it('reads a bare code and nested and/or trees', () => {
    expect(eligibility('BARE', c(), req)).toBe('blocked');
    expect(eligibility('BARE', c('A'), req)).toBe('ok');
    expect(eligibility('ANDOR', c('A'), req)).toBe('blocked');
    expect(eligibility('ANDOR', c('B'), req)).toBe('blocked');
    expect(eligibility('ANDOR', c('A', 'C'), req)).toBe('ok');
    expect(eligibility('EMPTY_AND', c(), req)).toBe('ok');
  });

  it('blocks when an antirequisite is met', () => {
    expect(eligibility('ANTI', c(), req)).toBe('ok');
    expect(eligibility('ANTI', c('Y'), req)).toBe('blocked');
    expect(eligibility('BOTH', c('A', 'X'), req)).toBe('blocked');
    expect(eligibility('BOTH', c('A'), req)).toBe('ok');
  });

  it('says check for an uncertain flag, but an unmet parsed prerequisite still blocks', () => {
    expect(eligibility('UNSURE_MET', c('A'), req)).toBe('check');
    expect(eligibility('UNSURE_MET', c(), req)).toBe('blocked');
  });

  it('does not warn for an uncertain flag that has no parsed tree', () => {
    expect(eligibility('UNSURE', c(), req)).toBe('ok');
  });

  it('takes any iterable of completed codes', () => {
    expect(eligibility('BARE', ['A'], req)).toBe('ok');
  });
});
