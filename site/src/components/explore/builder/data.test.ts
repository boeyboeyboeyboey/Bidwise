import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeShard, type BrowseManifest, type BrowseShard } from '../browse';
import fixture from './syntheticShard.fixture.json';
import { availableTerms, loadForFilters, termsForFilters } from './data';
import { fieldById } from './fields';
import { median, runQuery } from './query';

// A synthetic 36-row shard (made-up courses and instructors, same shape as a built term shard).
const man = fixture.manifest as unknown as BrowseManifest;
const shard = fixture.shard as unknown as BrowseShard;
const rows = decodeShard(man, shard);

describe('synthetic shard sample', () => {
  it('decodes, and every field reads every row', () => {
    expect(rows).toHaveLength(36);
    for (const f of ['term', 'window', 'round', 'course', 'subject', 'section', 'day', 'band', 'start', 'vacancy', 'before', 'after', 'taken', 'filled', 'median', 'min']) {
      const g = fieldById(f)!;
      expect(rows.map((r) => g.get(r)).some((v) => v !== null && v !== undefined)).toBe(true);
    }
    for (const r of rows) {
      if (r.before !== null && r.after !== null) expect(fieldById('taken')!.get(r)).toBe(r.before - r.after);
      expect(fieldById('round')!.get(r)).toMatch(/^(Exch |Fresh )?R\d[ABC]?$/);
    }
  });

  it('aggregates like an independent computation on the raw columns', () => {
    const at = Object.fromEntries(man.columns.map((c, i) => [c, i]));
    const byWindow = new Map<number, number[]>();
    for (const r of shard.rows) {
      const m = r[at.medianCents];
      if (m === null) continue;
      byWindow.set(r[at.window] as number, [...(byWindow.get(r[at.window] as number) ?? []), m / 100]);
    }
    const res = runQuery(rows, { x: 'window', y: { field: 'median', agg: 'median' }, filters: [] });
    expect(res.points).toHaveLength(byWindow.size);
    for (const [wi, vals] of byWindow) {
      const p = res.points.find((x) => x.x === fieldById('window')!.fmt(man.windows[wi]))!;
      expect(p.y).toBeCloseTo(median(vals), 10);
    }
    const all = runQuery(rows, { x: 'term', y: { field: 'count', agg: 'count' }, filters: [] });
    expect(all.points[0].y).toBe(36);
    expect(res.domains.x.length).toBeGreaterThan(2);
  });
});

describe('loader', () => {
  const big: BrowseManifest = { ...man, terms: [
    { term: '2024-25 Term 1', file: 'browse/a.json', rows: 5 }, { term: '2024-25 Term 3A', file: 'browse/b.json', rows: 0 },
    { term: '2025-26 Term 1', file: 'browse/c.json', rows: 5 }, { term: '2025-26 Term 2', file: 'browse/d.json', rows: 5 },
  ] };
  it('picks terms from the term filter, else the latest with results, else all', () => {
    expect(availableTerms(big)).toEqual(['2024-25 Term 1', '2025-26 Term 1', '2025-26 Term 2']);
    expect(termsForFilters(big, [{ field: 'term', in: ['2025-26 Term 1', '2024-25 Term 1', 'Nope', '2024-25 Term 3A'] }])).toEqual(['2024-25 Term 1', '2025-26 Term 1']);
    expect(termsForFilters(big, [{ field: 'median', min: 1 }])).toEqual(['2025-26 Term 2']);
    expect(termsForFilters(big, [], 'all')).toHaveLength(3);
  });

  afterEach(() => vi.unstubAllGlobals());
  it('fetches the manifest and only the needed shard, once', async () => {
    const calls: string[] = [];
    const m: BrowseManifest = { ...man, terms: [{ term: shard.term, file: 'browse/x.json', rows: 36 }, { term: '2099-00 Term 1', file: 'browse/y.json', rows: 1 }] };
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      return { ok: true, json: async () => (url.endsWith('browse.json') ? m : shard) };
    });
    const a = await loadForFilters([{ field: 'term', in: [shard.term] }]);
    const b = await loadForFilters([{ field: 'term', in: [shard.term] }]);
    expect(a.rows).toHaveLength(36);
    expect(b.rows).toHaveLength(36);
    expect(calls).toEqual(['/data/browse.json', '/data/browse/x.json']);
  });
});
