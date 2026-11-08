import { describe, expect, it } from 'vitest';
import { canonicalJson, createSimMemo } from './cache';
import { simulate, type SimInput } from './index';

const input: SimInput = {
  seats: 10, group: 2, minBidCents: 100, runs: 2000, seed: 5,
  params: { demandMean: 30, demandDispersion: 8, priceLevelCents: 900, priceSigma: 0.5, anchorSigma: 0.2, anchorShare: 0.15, anchorCents: 500 },
};

const fakeStore = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const counted = (i: SimInput) => {
  const calls = { n: 0 };
  return { calls, compute: () => { calls.n++; return Promise.resolve(simulate(i)); } };
};

describe('createSimMemo', () => {
  it('returns exactly the uncached result, and computes once per input', async () => {
    const memo = createSimMemo(() => fakeStore());
    const { calls, compute } = counted(input);
    const a = await memo.run('sim', input, compute);
    const b = await memo.run('sim', { ...input }, compute);
    expect(a).toEqual(simulate(input));
    expect(b).toEqual(a);
    expect(calls.n).toBe(1);
  });

  it('shares a call that is still running', async () => {
    const memo = createSimMemo(() => null);
    const { calls, compute } = counted(input);
    const [a, b] = await Promise.all([memo.run('sim', input, compute), memo.run('sim', input, compute)]);
    expect(a).toBe(b);
    expect(calls.n).toBe(1);
  });

  it('treats any change to the question as a different one', async () => {
    const memo = createSimMemo(() => null);
    const variants: SimInput[] = [
      input,
      { ...input, group: 3 },
      { ...input, seats: 11 },
      { ...input, minBidCents: 101 },
      { ...input, params: { ...input.params, priceLevelCents: 901 } },
    ];
    let n = 0;
    for (const v of variants) await memo.run('sim', v, () => { n++; return Promise.resolve(simulate(v)); });
    await memo.run('other', input, () => { n++; return Promise.resolve(1); });
    expect(n).toBe(variants.length + 1);
  });

  it('is not sensitive to key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
  });

  it('serves a later page load from sessionStorage with an identical result', async () => {
    const store = fakeStore();
    const first = createSimMemo(() => store);
    const live = await first.run('sim', input, () => Promise.resolve(simulate(input)));
    expect(store.m.size).toBe(1);
    const second = createSimMemo(() => store); // a fresh page: empty memory, same storage
    let n = 0;
    const again = await second.run('sim', input, () => { n++; return Promise.resolve(simulate(input)); });
    expect(n).toBe(0);
    expect(again).toEqual(live);
    expect(again).toEqual(simulate(input));
  });

  it('ignores a stored entry whose key differs (hash clash or corrupt data)', async () => {
    const store = fakeStore();
    const memo = createSimMemo(() => store);
    await memo.run('sim', input, () => Promise.resolve(simulate(input)));
    const [k] = [...store.m.keys()];
    store.m.set(k, JSON.stringify({ k: 'other', v: 'wrong' }));
    const fresh = createSimMemo(() => store);
    expect(await fresh.run('sim', input, () => Promise.resolve(simulate(input)))).toEqual(simulate(input));
    store.m.set(k, '{not json');
    expect(await createSimMemo(() => store).run('sim', input, () => Promise.resolve(simulate(input)))).toEqual(simulate(input));
  });

  it('still works when storage throws', async () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const memo = createSimMemo(() => boom);
    expect(await memo.run('sim', input, () => Promise.resolve(simulate(input)))).toEqual(simulate(input));
    const noStore = createSimMemo(() => { throw new Error('no storage'); });
    await expect(noStore.run('sim', input, () => Promise.resolve(1))).resolves.toBe(1);
  });

  it('does not store results that would not read back identical, and does not remember failures', async () => {
    const store = fakeStore();
    const memo = createSimMemo(() => store);
    const odd = { x: Number.NaN };
    expect(await memo.run('o', 1, () => Promise.resolve(odd))).toBe(odd);
    expect(store.m.size).toBe(0);
    let n = 0;
    await expect(memo.run('f', 1, () => { n++; return Promise.reject(new Error('x')); })).rejects.toThrow('x');
    await expect(memo.run('f', 1, () => { n++; return Promise.reject(new Error('x')); })).rejects.toThrow('x');
    expect(n).toBe(2);
  });
});
