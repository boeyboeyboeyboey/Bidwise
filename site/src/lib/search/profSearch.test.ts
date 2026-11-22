import { describe, expect, it } from 'vitest';
import { type ProfEntry, searchProfs } from './profSearch';

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
});
