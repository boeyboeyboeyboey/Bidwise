import { describe, expect, it } from 'vitest';
import { aboutPct, aboutPctParts } from './fmt';

describe('aboutPct', () => {
  it('prefixes plain percentages', () => {
    expect(aboutPct(0.9)).toBe('about 90%');
  });
  it('words the edges', () => {
    expect(aboutPct(0.001)).toBe('under 1%');
    expect(aboutPct(0.9999)).toBe('over 99%');
  });
});

describe('aboutPctParts', () => {
  it('separates the lead word from the figure', () => {
    expect(aboutPctParts(0.9)).toEqual(['about ', '90%']);
    expect(aboutPctParts(0.9999)).toEqual(['over ', '99%']);
  });
});
