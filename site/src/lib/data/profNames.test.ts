import { describe, expect, it } from 'vitest';
import { instructorLinks, mergeCommaParts, profHref } from './profNames';

describe('mergeCommaParts', () => {
  it('keeps two one-word parts as one person, before or after a full name', () => {
    expect(mergeCommaParts('YU, SHIHAO, SUN JIAN')).toEqual(['YU, SHIHAO', 'SUN JIAN']);
    expect(mergeCommaParts('SUN JIAN, YU, SHIHAO')).toEqual(['SUN JIAN', 'YU, SHIHAO']);
  });
});

describe('profHref', () => {
  it('links to the profile slug with a trailing slash', () => {
    expect(profHref('Lee Kok Thong')).toBe('/prof/lee-kok-thong/');
    expect(profHref('LEE KOK THONG')).toBe('/prof/lee-kok-thong/');
    expect(profHref('Tan Ah-Meng')).toBe('/prof/tan-ah-meng/');
  });

  it('gives the same link for the same person across spellings', () => {
    expect(profHref('Alex Cheng')).toBe(profHref('ALEX CHENG'));
  });
});

describe('instructorLinks', () => {
  it('splits a team-taught field into one link per person', () => {
    expect(instructorLinks('ALEX CHENG, ERIC TIN, JANSEN AW')).toEqual([
      { name: 'ALEX CHENG', display: 'Alex Cheng', href: '/prof/alex-cheng/' },
      { name: 'ERIC TIN', display: 'Eric Tin', href: '/prof/eric-tin/' },
      { name: 'JANSEN AW', display: 'Jansen Aw', href: '/prof/jansen-aw/' },
    ]);
  });

  it('keeps an S/O name whole', () => {
    expect(instructorLinks("JOHN S/O RAMAN")).toEqual([
      { name: 'JOHN S/O RAMAN', display: "John S/O Raman", href: '/prof/john-s-o-raman/' },
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(instructorLinks(null)).toEqual([]);
    expect(instructorLinks(undefined)).toEqual([]);
    expect(instructorLinks('')).toEqual([]);
    expect(instructorLinks('   ')).toEqual([]);
  });
});
