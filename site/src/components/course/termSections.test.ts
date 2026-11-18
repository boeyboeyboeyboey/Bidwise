import { describe, expect, it } from 'vitest';
import { parseTermParams, pickTerm, withTermParams } from './termSections';

describe('termSections URL state', () => {
  it('reads term and section, spelled as Browse writes them', () => {
    expect(parseTermParams('?term=2025-26+Term+2&sec=G1')).toEqual({ term: '2025-26 Term 2', sec: 'G1' });
    expect(parseTermParams('?term=2025-26%20Term%202')).toEqual({ term: '2025-26 Term 2', sec: '' });
    expect(parseTermParams('')).toEqual({ term: '', sec: '' });
  });
  it('falls back to the newest term when the wanted one has no data', () => {
    const t = ['2026-27 Term 1', '2025-26 Term 2', '2025-26 Term 1'];
    expect(pickTerm(t, '2025-26 Term 2')).toBe('2025-26 Term 2');
    expect(pickTerm(t, '2019-20 Term 1')).toBe('2026-27 Term 1');
    expect(pickTerm(t, '')).toBe('2026-27 Term 1');
    expect(pickTerm([], 'x')).toBe('');
  });
  it('keeps other params and drops sec with term', () => {
    expect(withTermParams('?i=Tan+Ah+Kow', '2025-26 Term 2', 'G1')).toBe('?i=Tan+Ah+Kow&term=2025-26+Term+2&sec=G1');
    expect(withTermParams('?i=X&term=a&sec=G1', '2025-26 Term 1', '')).toBe('?i=X&term=2025-26+Term+1');
    expect(withTermParams('?term=a&sec=G1', '', 'G1')).toBe('');
  });
});
