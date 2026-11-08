import { describe, expect, it } from 'vitest';
import type { BrowseRow } from '../browse';
import { runLines } from './lines';
import { MAX_SAVED, SAVED_KEY, deleteChart, loadSaved, saveChart } from './saved';
import { csvAllowed, csvCell, resultCsv, resultTable } from './table';
import { defaultSpec, normalizeSpec, type BuilderSpec } from './spec';

let seq = 0;
const row = (o: Partial<BrowseRow> = {}): BrowseRow => ({
  code: 'IS214', term: '2025-26 Term 1', window: 'Round 1 Window 1', section: `G${++seq}`, instructor: 'ANN LEE', slot: 'Mon 08:15–11:30',
  medianCents: 1000, minCents: 500, vacancy: 40, before: 40, after: 10, filled: false, ...o,
});
const spec = (o: Partial<BuilderSpec>): BuilderSpec => normalizeSpec({ ...defaultSpec(), ...o });

describe('CSV', () => {
  const rows = [row({ term: 'A', medianCents: 1000 }), row({ term: 'A', medianCents: 3000 }), row({ term: 'B', medianCents: 500 }), row({ term: 'B', code: 'IS216' })];
  it('has one line per plotted point with a header, and no source row fields', () => {
    const s = spec({ x: 'term', lines: [{ course: 'IS214' }, { course: 'IS216' }] });
    const csv = resultCsv(s, runLines(rows, s));
    expect(csv.split('\r\n')).toEqual(['Line,Term,Median bid (e$),n', 'IS214,A,e$20.00,2', 'IS214,B,e$5.00,1', 'IS216,B,e$10.00,1', '']);
    expect(csv).not.toMatch(/G\d|ANN LEE/);
  });
  it('is empty for a Scatter, and the table lists every point', () => {
    const s = spec({ chart: 'scatter', x: 'vacancy', lines: [{ course: 'IS214' }] });
    expect(csvAllowed(s)).toBe(false);
    expect(resultCsv(s, runLines(rows, s))).toBe('');
    expect(resultTable(s, runLines(rows, s)).body).toHaveLength(3);
  });
  it('caps the table but reports the rest', () => {
    const s = spec({ x: 'term', lines: [{ course: 'IS214' }] });
    const t = resultTable(s, runLines(rows, s), 1);
    expect([t.body.length, t.more]).toEqual([1, 1]);
  });
  it('defuses formulas but keeps negative numbers', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-3.5')).toBe('-3.5');
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
});

describe('saved charts', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('saves newest first, replaces a name, deletes, and reads back normalized specs', () => {
    const st = mem();
    saveChart('one', spec({ lines: [{ course: 'IS214' }] }), st);
    saveChart('two', spec({ chart: 'bar' }), st);
    saveChart('one', spec({ y: 'min' }), st);
    expect(loadSaved(st).map((c) => c.name)).toEqual(['one', 'two']);
    expect(loadSaved(st)[0].spec.y).toBe('min');
    expect(deleteChart('one', st).map((c) => c.name)).toEqual(['two']);
  });
  it('ignores charts saved by the older builder, caps at 20 and rejects empty names', () => {
    const st = mem();
    st.setItem(SAVED_KEY, JSON.stringify([{ name: 'old', spec: { x: 'window', y: { field: 'median', agg: 'median' }, filters: [] } }]));
    expect(loadSaved(st)).toEqual([]);
    for (let i = 0; i < MAX_SAVED; i++) expect(saveChart(`c${i}`, defaultSpec(), st).ok).toBe(true);
    expect(saveChart('extra', defaultSpec(), st)).toMatchObject({ ok: false, reason: 'full' });
    expect(saveChart('  ', defaultSpec(), st)).toMatchObject({ ok: false, reason: 'name' });
  });
  it('survives storage that throws or is missing', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadSaved(bad)).toEqual([]);
    expect(saveChart('a', defaultSpec(), bad)).toMatchObject({ ok: false, reason: 'storage' });
    expect(saveChart('a', defaultSpec(), null)).toMatchObject({ ok: false });
  });
});
