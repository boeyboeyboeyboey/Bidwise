import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeShard, type BrowseManifest, type BrowseShard } from '../browse';
import fixture from './syntheticShard.fixture.json';
import { availableTerms, loadRows, termsFor } from './data';
import { fieldById } from './fields';
import { median, runQuery } from './query';

// A 36-row sample of a real shard (2023-24 Term 1, every 600th row) with its lookup tables trimmed to what the rows use.
const man = fixture.manifest as unknown as BrowseManifest;
const shard = fixture.shard as unknown as BrowseShard;
const rows = decodeShard(man, shard);

describe('real shard sample', () => {
  it('decodes, and every field reads every row', () => {
    expect(rows).toHaveLength(36);
    for (const f of ['term', 'window', 'termWindow', 'course', 'section', 'day', 'start', 'vacancy', 'before', 'after', 'taken', 'fillPct', 'median', 'min']) {
      const g = fieldById(f)!;
      expect(rows.map((r) => g.get(r)).some((v) => v !== null && v !== undefined)).toBe(true);
    }
    for (const r of rows) if (r.before !== null && r.after !== null) expect(fieldById('taken')!.get(r)).toBe(r.before - r.after);
  });

  it('aggregates like an independent computation on the raw columns', () => {
    const at = Object.fromEntries(man.columns.map((c, i) => [c, i]));
    const byWindow = new Map<number, number[]>();
    for (const r of shard.rows) {
      const m = r[at.medianCents];
      if (m === null) continue;
      byWindow.set(r[at.window] as number, [...(byWindow.get(r[at.window] as number) ?? []), m / 100]);
    }
    const res = runQuery(rows, { x: 'window', y: 'median', agg: 'median', filters: [] });
    expect(res.points).toHaveLength(byWindow.size);
    for (const [wi, vals] of byWindow) {
      const p = res.points.find((x) => x.x === fieldById('window')!.fmt(man.windows[wi]))!;
      expect(p.y).toBeCloseTo(median(vals), 10);
    }
    expect(res.xDomain.length).toBeGreaterThan(2);
  });
});

describe('loader', () => {
  const big: BrowseManifest = { ...man, terms: [
    { term: '2022-23 Term 1', file: 'browse/a.json', rows: 5000 }, { term: '2022-23 Term 3A', file: 'browse/b.json', rows: 40 },
    { term: '2023-24 Term 1', file: 'browse/c.json', rows: 5000 }, { term: '2023-24 Term 2', file: 'browse/d.json', rows: 5000 },
    { term: '2024-25 Term 1', file: 'browse/e.json', rows: 5000 }, { term: '2024-25 Term 2', file: 'browse/f.json', rows: 5000 },
    { term: '2025-26 Term 1', file: 'browse/g.json', rows: 5000 }, { term: '2025-26 Term 9', file: 'browse/h.json', rows: 0 },
  ] };
  it('defaults to the last four regular terms; more terms means every term with rows', () => {
    expect(termsFor(big, false)).toEqual(['2023-24 Term 2', '2024-25 Term 1', '2024-25 Term 2', '2025-26 Term 1']);
    expect(termsFor(big, true)).toEqual(availableTerms(big));
    expect(termsFor(big, true)).not.toContain('2025-26 Term 9');
  });

  afterEach(() => vi.unstubAllGlobals());
  it('fetches only the needed shard, once', async () => {
    const calls: string[] = [];
    const m: BrowseManifest = { ...man, terms: [{ term: shard.term, file: 'browse/x.json', rows: 36 }, { term: '2099-00 Term 1', file: 'browse/y.json', rows: 1 }] };
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => shard };
    });
    expect(await loadRows(m, [shard.term])).toHaveLength(36);
    expect(await loadRows(m, [shard.term])).toHaveLength(36);
    expect(calls).toEqual(['/data/browse/x.json']);
  });
});
