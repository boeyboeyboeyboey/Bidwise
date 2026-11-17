import { describe, expect, it } from 'vitest';
import { COURSE_ALIASES } from './aliases';
import { aliasesOf, courseRank, editDistance, flatText, isExactCode, queryTokens, rankCourses, searchCourses } from './courseSearch';

describe('text normalising', () => {
  it('reads & as and, drops apostrophes and other punctuation', () => {
    expect(flatText('Modeling & Data Analytics')).toBe('modelinganddataanalytics');
    expect(flatText('Innovations for Asia’s Smart Cities')).toBe('innovationsforasiassmartcities');
    expect(queryTokens('  W&R  business, government ')).toEqual(['wandr', 'business', 'government']);
  });
});

describe('courseRank', () => {
  const rank = (q: string, code = 'COR-MGMT1302', title = 'Business, Government and Society', aliases = ['bgs']) => courseRank(code, title, q, aliases);
  it('ranks exact code, exact nickname, code prefix, title words, nickname prefix, substring', () => {
    expect(rank('cor-mgmt1302')).toBe(0);
    expect(rank('MGMT 1302')).toBe(0);
    expect(rank('BGS')).toBe(1);
    expect(rank('mgmt13')).toBe(2);
    expect(rank('business gov')).toBe(3);
    expect(rank('bg')).toBe(4);
    expect(rank('vernment')).toBe(5);
    expect(rank('accounting')).toBe(-1);
    expect(rank('')).toBe(-1);
  });
  it('finds titles typed without their punctuation', () => {
    expect(rank('business government and society')).toBe(3);
    expect(courseRank('COR1305', 'Modeling & Data Analytics', 'modeling and data analytics', [])).toBe(3);
    expect(courseRank('X1', 'Innovations for Asia’s Smart Cities', "asia's smart", [])).toBe(3);
    expect(courseRank('X1', 'Innovations for Asia’s Smart Cities', 'asias smart', [])).toBe(3);
  });
  it('treats nickname punctuation and spacing as equal', () => {
    expect(courseRank('COR1100', 'Writing and Reasoning', 'w & r', aliasesOf('COR1100'))).toBe(1);
    expect(courseRank('COR-STAT1202', 'Introductory Statistics', 'Stat-X', aliasesOf('COR-STAT1202'))).toBe(1);
  });
  it('does not let a joined nickname match unrelated titles word by word or across words', () => {
    expect(courseRank('X1', 'Wealth and Risk', 'w&r', [])).toBe(-1);
    expect(courseRank('X1', 'EU-ASEAN Law and Relations', 'w&r', [])).toBe(-1);
  });
  it('finds nothing for punctuation alone', () => {
    expect(courseRank('X1', 'Law and Relations', '&', [])).toBe(-1);
    expect(courseRank('X1', 'Law and Relations', ' - ', [])).toBe(-1);
  });
});

describe('rankCourses', () => {
  const index: [string, string][] = [
    ['ACCT101', 'Financial Accounting'],
    ['ACCT102', 'Management Accounting'],
    ['ACCT112', 'Management Accounting'],
    ['COR3301', 'Ethics and Social Responsibility'],
    ['COR-PHIL2262', 'Environmental Ethics'],
    ['IS113', 'Web Application Development I'],
    ['IS216', 'Web Application Development II'],
  ];
  const codes = (q: string) => rankCourses(index, q, (e) => e).map((e) => e[0]);
  it('puts a nickname above title matches and keeps input order within a tier', () => {
    expect(codes('ethics')).toEqual(['COR3301', 'COR-PHIL2262']);
    expect(codes('MA')).toEqual(['ACCT102', 'ACCT112']);
    expect(codes('wad')).toEqual(['IS113', 'IS216']);
    expect(codes('wad2')).toEqual(['IS216']);
  });
});

describe('shared nicknames', () => {
  it('finds every course that shares a nickname', () => {
    const index: [string, string][] = [['CS206', 'Software Product Management'], ['IS212', 'Software Project Management'], ['IS213', 'Enterprise Solution Development']];
    expect(rankCourses(index, 'spm', (e) => e).map((e) => e[0])).toEqual(['CS206', 'IS212']);
  });
});

describe('isExactCode', () => {
  it('matches the code with or without its prefix only', () => {
    expect(isExactCode('COR-STAT1202', 'stat1202')).toBe(true);
    expect(isExactCode('COR-STAT1202', 'stats')).toBe(false);
  });
});

describe('alias table', () => {
  it('has no empty nicknames and no nickname equal to another course code', () => {
    const codes = new Set(Object.keys(COURSE_ALIASES).map(flatText));
    for (const [code, names] of Object.entries(COURSE_ALIASES)) {
      for (const n of names) {
        expect(flatText(n), `${code}: "${n}"`).not.toBe('');
        expect(codes.has(flatText(n)), `${code}: "${n}" is a course code`).toBe(false);
      }
    }
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions, substitutions and neighbour swaps as one edit each', () => {
    expect(editDistance('managment', 'management', 2)).toBe(1);
    expect(editDistance('statistcs', 'statistics', 2)).toBe(1);
    expect(editDistance('fianncial', 'financial', 2)).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('searchCourses close matches', () => {
  const index: [string, string][] = [
    ['ACCT101', 'Financial Accounting'],
    ['ACCT102', 'Management Accounting'],
    ['COR-STAT1202', 'Introductory Statistics'],
    ['IS113', 'Web Application Development I'],
    ['IS112', 'Data Management'],
    ['IS115', 'Algorithms and Programming'],
  ];
  const find = (q: string) => {
    const r = searchCourses(index, q, (e) => e);
    return { codes: r.items.map((e) => e[0]), close: r.close };
  };
  it('uses exact matches when there are any', () => {
    expect(find('management')).toEqual({ codes: ['ACCT102', 'IS112'], close: false });
  });
  it('finds title typos, including a half-typed last word', () => {
    expect(find('managment')).toEqual({ codes: ['ACCT102', 'IS112'], close: true });
    expect(find('statistcs')).toEqual({ codes: ['COR-STAT1202'], close: true });
    expect(find('finacial acco')).toEqual({ codes: ['ACCT101'], close: true });
    expect(find('acounting')).toEqual({ codes: ['ACCT101', 'ACCT102'], close: true });
  });
  it('forgives one typo in a whole code and in a nickname', () => {
    expect(find('act101').codes[0]).toBe('ACCT101');
    expect(find('algp').codes).toContain('IS115');
  });
  it('on a tie, puts the title with fewer words first', () => {
    const two: [string, string][] = [['COMM246', 'Crisis Management and Communication'], ['COR-COMM1304', 'Management Communication']];
    expect(searchCourses(two, 'mangement comunication', (e) => e).items.map((e) => e[0])).toEqual(['COR-COMM1304', 'COMM246']);
  });
  it('forgives nothing in words of 3 letters or fewer', () => {
    expect(find('wqd')).toEqual({ codes: [], close: false });
  });
});
