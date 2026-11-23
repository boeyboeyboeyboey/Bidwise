import { describe, expect, it } from 'vitest';
import { searchTags, tagEntries, type TagEntry } from './tagSearch';

const TSS = 'Communities - Technology, Science and Society';
const CMW = 'Communities - Cultures of the Modern World';
const SGAS = 'Grad Req - SG & Asia Studies (Intake 2024 onwards)';
const DDA = 'Grad Req - Dig Tech/Data Ana (Intake 2024 onwards)';

const entries: TagEntry[] = [
  ['grad-sust', 'Grad Req - Sustainability (Intake 2024 onwards)', 'gradreq', 57],
  ['area-sust-core', 'Sustainable Societies Core', 'area', 3],
  ['area-sust-mgmt-el', 'Sustainability Management Electives', 'area', 44],
  ['trck-sust-fin', 'Finance Major: Sustainable Finance Track', 'track', 9],
  ['core-tss', 'Communities - Technology, Science and Society', 'core', 52],
  ['core-cmw', 'Communities - Cultures of the Modern World', 'core', 57],
  ['grad-sgas', SGAS, 'gradreq', 37],
  ['grad-dda', DDA, 'gradreq', 105],
  ['area-dig-biz', 'Digital Business Core', 'area', 7],
  ['area-data-core', 'Data Science and Analytics Core', 'area', 7],
];
const ids = (rows: TagEntry[]) => rows.map((r) => r[0]);

describe('searchTags aliases', () => {
  it('resolves TSS and CMW to their communities baskets', () => {
    expect(ids(searchTags(entries, 'TSS', 4))[0]).toBe('core-tss');
    expect(ids(searchTags(entries, 'cmw', 4))[0]).toBe('core-cmw');
  });

  it('resolves the SG & Asia nicknames, ignoring case and punctuation', () => {
    for (const q of ['SGAS', 'sg asia', 'SG & Asia', 'Singapore Asia', 'sg-asia']) {
      expect(ids(searchTags(entries, q, 4))[0]).toBe('grad-sgas');
    }
  });

  it('resolves the digital tech nicknames', () => {
    for (const q of ['DDA', 'dig tech', 'Digital Tech']) {
      expect(ids(searchTags(entries, q, 4))[0]).toBe('grad-dda');
    }
  });

  it('returns nothing for an unknown alias', () => {
    expect(searchTags(entries, 'XYZ', 4)).toEqual([]);
  });
});

describe('searchTags name matching', () => {
  it('matches a prefix of a name word', () => {
    expect(ids(searchTags(entries, 'sust', 10))).toEqual(
      expect.arrayContaining(['grad-sust', 'area-sust-core', 'area-sust-mgmt-el', 'trck-sust-fin']),
    );
  });

  it('requires every typed word to start a name word, in any order', () => {
    expect(ids(searchTags(entries, 'tech sci', 4))).toEqual(['core-tss']);
    expect(ids(searchTags(entries, 'cultures modern', 4))).toEqual(['core-cmw']);
    expect(ids(searchTags(entries, 'modern cultures', 4))).toEqual(['core-cmw']);
    expect(searchTags(entries, 'tech cultures', 4)).toEqual([]);
  });

  it('does not match inside a word', () => {
    expect(searchTags(entries, 'ustain', 4)).toEqual([]);
  });

  it('ranks gradreq and core before area and track, then shorter names first', () => {
    expect(ids(searchTags(entries, 'sust', 10))).toEqual([
      'grad-sust',
      'area-sust-core',
      'area-sust-mgmt-el',
      'trck-sust-fin',
    ]);
  });

  it('keeps the limit', () => {
    expect(searchTags(entries, 'sust', 2)).toHaveLength(2);
  });
});

describe('searchTags guards', () => {
  it('returns nothing for queries under 2 characters', () => {
    expect(searchTags(entries, '', 4)).toEqual([]);
    expect(searchTags(entries, ' s ', 4)).toEqual([]);
  });

  it('returns nothing for course-code-looking queries', () => {
    for (const q of ['ACCT101', 'cs102', 'stat-1202', 'COR.1100']) {
      expect(searchTags(entries, q, 4)).toEqual([]);
    }
  });
});

describe('tagEntries', () => {
  it('maps a tag to id, name, kind and its site course count', () => {
    const [row] = tagEntries([{ id: 'x', name: 'Digital Business Core', kind: 'area', codes: ['a', 'b'], total: 9 }]);
    expect(row).toEqual(['x', 'Digital Business Core', 'area', 2]);
  });
});
