import { describe, expect, it } from 'vitest';
import { bossCodeOf, splitFamily, splitSibling, toBossCodes } from './bossCode';

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
