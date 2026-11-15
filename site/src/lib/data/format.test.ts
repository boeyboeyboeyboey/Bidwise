import { describe, expect, it } from 'vitest';
import { titleName } from './format';

describe('titleName', () => {
  it('title-cases capitals and keeps separators', () => {
    expect(titleName('PRADEEP REDDY VARAKANTHAM')).toBe('Pradeep Reddy Varakantham');
    expect(titleName('LEE KOK THONG, TAN AH-MENG')).toBe('Lee Kok Thong, Tan Ah-Meng');
    expect(titleName("O'BRIEN")).toBe("O'Brien");
    expect(titleName('A/B (C.D)')).toBe('A/B (C.D)');
  });
  it('normalises mixed case and trims', () => {
    expect(titleName('  lEE kOK  ')).toBe('Lee Kok');
    expect(titleName('Lee Kok Thong')).toBe('Lee Kok Thong');
  });
  it('is empty for empty input', () => {
    expect(titleName('')).toBe('');
    expect(titleName('   ')).toBe('');
    expect(titleName(null)).toBe('');
    expect(titleName(undefined)).toBe('');
  });
});
