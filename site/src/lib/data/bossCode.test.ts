import { describe, expect, it } from 'vitest';
import { bossCodeOf, codeLabel, codeSlug, siteCodeFromLabel, splitFamily, splitSibling, splitTag, toBossCodes } from './bossCode';

describe('bossCodeOf', () => {
  it('uses the data field when present', () => {
    expect(bossCodeOf('COR-STAT1202-X', 'COR-STAT1202')).toBe('COR-STAT1202');
    expect(bossCodeOf('IS112', 'IS112')).toBe('IS112');
  });
  it('falls back to the known split suffix when old data has no bossCode', () => {
    expect(bossCodeOf('COR-STAT1202-X')).toBe('COR-STAT1202');
    expect(bossCodeOf('COR-STAT1202-X', undefined)).toBe('COR-STAT1202');
    expect(bossCodeOf('COR-STAT1202-X', '')).toBe('COR-STAT1202');
  });
  it('is the code itself for any other course', () => {
    expect(bossCodeOf('COR-STAT1202')).toBe('COR-STAT1202');
    expect(bossCodeOf('IS112')).toBe('IS112');
  });
});

describe('split siblings', () => {
  it('names the other site course of a split, either way round', () => {
    expect(splitSibling('COR-STAT1202')).toBe('COR-STAT1202-X');
    expect(splitSibling('COR-STAT1202-X')).toBe('COR-STAT1202');
    expect(splitSibling('IS112')).toBeNull();
    expect(splitFamily('COR-STAT1202-X')).toEqual(['COR-STAT1202', 'COR-STAT1202-X']);
    expect(splitFamily('IS112')).toEqual(['IS112']);
  });
  it('turns completed site codes into BOSS codes, each once', () => {
    expect(toBossCodes(['COR-STAT1202-X', 'IS112'])).toEqual(['COR-STAT1202', 'IS112']);
    expect(toBossCodes(['COR-STAT1202', 'COR-STAT1202-X'])).toEqual(['COR-STAT1202']);
  });
});

describe('showing a split course', () => {
  it('never puts the site code in what is shown', () => {
    for (const s of [codeLabel('COR-STAT1202-X'), codeSlug('COR-STAT1202-X'), codeLabel('COR-STAT1202-X', 'COR-STAT1202')]) expect(s).not.toContain('STAT1202-X');
  });
  it('labels a split course with its tag and a plain course with its code', () => {
    expect(codeLabel('COR-STAT1202-X')).toBe('COR-STAT1202 (SMU-X)');
    expect(codeLabel('COR-STAT1202-X', 'COR-STAT1202')).toBe('COR-STAT1202 (SMU-X)');
    expect(codeLabel('COR-STAT1202')).toBe('COR-STAT1202');
    expect(codeLabel('IS112', 'IS112')).toBe('IS112');
  });
  it('derives a tag for a split the table does not know, from the data field', () => {
    expect(splitTag('IS999-Z', 'IS999')).toBe('Z');
    expect(codeLabel('IS999-Z', 'IS999')).toBe('IS999 (Z)');
    expect(splitTag('IS112')).toBeNull();
  });
  it('names download files with the BOSS code and the tag', () => {
    expect(codeSlug('COR-STAT1202-X')).toBe('COR-STAT1202-SMU-X');
    expect(codeSlug('COR-STAT1202')).toBe('COR-STAT1202');
  });
  it('reads a shown label back to the site code', () => {
    expect(siteCodeFromLabel('COR-STAT1202 (SMU-X)')).toBe('COR-STAT1202-X');
    expect(siteCodeFromLabel('cor-stat1202(smu-x)')).toBe('COR-STAT1202-X');
    expect(siteCodeFromLabel('COR-STAT1202')).toBeNull();
    expect(siteCodeFromLabel('COR-STAT1202 (SMU')).toBeNull();
  });
});
