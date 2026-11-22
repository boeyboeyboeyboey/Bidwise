import { describe, expect, it } from 'vitest';
import { closeProfs, findProfs, type ProfEntry, searchProfs } from './profSearch';

const e = (name: string, courseCount: number, teachingNow: 0 | 1 = 0): ProfEntry => [name, name.toLowerCase().replace(/\W+/g, '-'), courseCount, teachingNow];
const names = (rows: readonly ProfEntry[]) => rows.map((r) => r[0]);

describe('professor search', () => {
  const cham = e('Cham Yanwei, Derrick', 3, 1);
  const lim = e('Lim Wei Ling', 5);
  const obrien = e("O'Brien, Ann", 2, 1);

  it('matches each typed word against the start of a name word, in any order', () => {
    expect(searchProfs([cham, lim], 'derrick cham')).toEqual([cham]);
    expect(searchProfs([cham, lim], 'cham yan')).toEqual([cham]);
    expect(searchProfs([cham, lim], 'wei lim')).toEqual([lim]);
  });

  it('does not match inside a word or on a missing word', () => {
    expect(searchProfs([cham, lim], 'errick')).toEqual([]);
    expect(searchProfs([cham, lim], 'cham lim')).toEqual([]);
  });

  it('treats punctuation as a word break and ignores apostrophes', () => {
    expect(searchProfs([obrien], "o'brien")).toEqual([obrien]);
    expect(searchProfs([obrien], 'obrien ann')).toEqual([obrien]);
    expect(searchProfs([obrien], 'ann, o')).toEqual([obrien]);
    expect(searchProfs([cham], 'derrick,cham')).toEqual([cham]);
  });

  it('ranks the full name first, then names starting with the text, then other matches', () => {
    const wei = e('Tan Wei', 1);
    const other = e('Lim Wei', 9);
    const weiFirst = e('Wei Ling Ho', 1);
    expect(names(searchProfs([other, wei, weiFirst], 'wei'))).toEqual(['Wei Ling Ho', 'Lim Wei', 'Tan Wei']);
    expect(names(searchProfs([other, weiFirst, wei], 'tan wei'))).toEqual(['Tan Wei']);
    // Full name (any order) beats a name that only starts with the text.
    const full = e('Ho Wei', 1);
    const starts = e('Ho Weiling', 9);
    expect(names(searchProfs([starts, full], 'wei ho'))).toEqual(['Ho Wei', 'Ho Weiling']);
  });

  it('breaks ties by teaching this term, then course count, then name', () => {
    const a = e('Ang Ben', 2, 0);
    const b = e('Ang Cee', 2, 1);
    const c = e('Ang Dee', 4, 0);
    const d = e('Ang Eve', 4, 0);
    expect(names(searchProfs([a, c, d, b], 'ang'))).toEqual(['Ang Cee', 'Ang Dee', 'Ang Eve', 'Ang Ben']);
  });

  it('returns nothing for queries under two letters', () => {
    expect(searchProfs([cham, lim], '')).toEqual([]);
    expect(searchProfs([cham, lim], 'c')).toEqual([]);
    expect(searchProfs([cham, lim], ' , ')).toEqual([]);
  });

  it('returns every match by default, and only the first rows when a limit is given', () => {
    const many = Array.from({ length: 18 }, (_, i) => e(`Sim P${i}`, 1));
    expect(searchProfs(many, 'sim')).toHaveLength(18);
    expect(searchProfs(many, 'sim', 5)).toHaveLength(5);
    expect(searchProfs(many, 'sim', 2)).toHaveLength(2);
  });

  it('keeps a match past the first five rows, so the full list can be shown', () => {
    const many = [...Array.from({ length: 6 }, (_, i) => e(`Sim P${i}`, 9, 1)), e('Wong George', 1)];
    expect(names(searchProfs(many, 'wong'))).toEqual(['Wong George']);
    expect(names(searchProfs(many, 'sim', 5))).toHaveLength(5);
    expect(searchProfs(many, 'sim')[5]?.[0]).toBe('Sim P5');
  });

  describe('close matches (typos)', () => {
    const wong = e('Wong, George', 4, 1);
    const naqvi = e('Ijlal Naqvi', 6, 1);
    const wang = e('Wang Lei', 2);

    it('finds a professor through a swapped or wrong letter', () => {
      expect(findProfs([wong, naqvi, wang], 'goerge wong')).toEqual({ items: [wong], close: true });
      expect(findProfs([wong, naqvi, wang], 'naqvy')).toEqual({ items: [naqvi], close: true });
      expect(names(findProfs([wong, naqvi], 'george wnog').items)).toEqual(['Wong, George']);
    });

    it('is used only when nothing matches exactly', () => {
      expect(findProfs([wong, naqvi, wang], 'wong')).toEqual({ items: [wong], close: false });
      expect(findProfs([wong, naqvi], 'zzzz')).toEqual({ items: [], close: false });
    });

    it('forgives no typo in words of three letters or fewer, but still takes them as a prefix', () => {
      expect(closeProfs([wang, wong], 'lee')).toEqual([]);
      expect(names(closeProfs([wang], 'lei wnag'))).toEqual(['Wang Lei']);
    });

    it('forgives one typo up to seven letters and two from eight', () => {
      expect(closeProfs([naqvi], 'naqvyy')).toEqual([]);
      expect(names(closeProfs([e('Christopherson Ann', 1)], 'christphersen'))).toEqual(['Christopherson Ann']);
    });

    it('ranks fewer typos first, then the usual ties', () => {
      const wing = e('Wing Ho', 9, 1);
      // "wonh" is one typo from "wong" but two from "wing", so only Wong shows.
      expect(names(closeProfs([wing, wong], 'wonh'))).toEqual(['Wong, George']);
      const a = e('Tann Ben', 1);
      const b = e('Tann Cee', 5);
      expect(names(closeProfs([a, b], 'tanm'))).toEqual(['Tann Cee', 'Tann Ben']);
      // "geroge" is one typo (a swap) from "george" but two from "gorge", so fewer typos wins over more courses.
      const w2 = e('Wong Gorge', 9, 1);
      expect(names(closeProfs([w2, wong], 'geroge wong'))[0]).toBe('Wong, George');
    });

    it('ranks a whole-word typo before a typo against the start of a longer word', () => {
      const chong = e('Mark Chong', 9, 1);
      const john = e('John Sequeira', 1);
      expect(names(closeProfs([chong, john], 'jhon'))).toEqual(['John Sequeira', 'Mark Chong']);
    });

    it('returns nothing for queries under two letters', () => {
      expect(findProfs([wong], 'w')).toEqual({ items: [], close: false });
    });
  });
});
