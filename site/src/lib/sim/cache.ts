// Memoises simulation results so a visit or switch that asks the same question again does not rerun the Monte Carlo.
// A question is the operation plus its whole input (seats, group size, minimum bid, every fitted parameter, runs, seed),
// so a different course, section, window, group size or refit can never hit another's answer: the key is the input itself.
// Kept in memory (also sharing a call that is still running) and in sessionStorage, which survives a reload or a page change.

/** Bump when the simulation or planner maths changes, so answers stored by an older build are not reused. */
export const SIM_CACHE_VERSION = 2; // 2: uncontested floor bids win for sure (10 Nov 2026)
const PREFIX = `bw:sim:v${SIM_CACHE_VERSION}:`;
const MAX_STORED_CHARS = 400_000;

/** JSON with object keys sorted, so the same input always gives the same text. */
export function canonicalJson(x: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(walk(x));
}

/** 53-bit hash (cyrb53) of a string, used only to name the storage entry; the stored entry also keeps the full key. */
function hash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function sessionStore(): StorageLike | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** JSON text of a result, or null when it would not read back identical (NaN, Infinity, undefined) or is very large. */
function storable(value: unknown): string | null {
  let lossy = false;
  const text = JSON.stringify(value, (_k, v) => {
    if (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) lossy = true;
    return v;
  });
  return lossy || text === undefined || text.length > MAX_STORED_CHARS ? null : text;
}

export interface SimMemo {
  run<T>(op: string, input: unknown, compute: () => Promise<T>): Promise<T>;
  /** Forget the in-memory answers (stored ones stay). For tests. */
  forgetMemory(): void;
}

export function createSimMemo(getStore: () => StorageLike | null = sessionStore): SimMemo {
  const memory = new Map<string, Promise<unknown>>();
  return {
    run<T>(op: string, input: unknown, compute: () => Promise<T>): Promise<T> {
      let key: string;
      try {
        key = `${op}|${canonicalJson(input)}`;
      } catch {
        return compute();
      }
      const hit = memory.get(key);
      if (hit) return hit as Promise<T>;

      const slot = PREFIX + hash(key);
      try {
        const raw = getStore()?.getItem(slot);
        if (raw) {
          const entry = JSON.parse(raw) as { k?: string; v?: T };
          if (entry && entry.k === key && entry.v !== undefined) {
            const p = Promise.resolve(entry.v);
            memory.set(key, p);
            return p;
          }
        }
      } catch {
        /* unreadable or blocked storage: compute instead */
      }

      const p = compute().then(
        (value) => {
          try {
            const text = storable(value);
            const store = getStore();
            if (text !== null && store) store.setItem(slot, `{"k":${JSON.stringify(key)},"v":${text}}`);
          } catch {
            /* full or blocked storage: the in-memory answer still serves */
          }
          return value;
        },
        (err) => {
          memory.delete(key); // never remember a failure
          throw err;
        },
      );
      memory.set(key, p);
      return p;
    },
    forgetMemory: () => memory.clear(),
  };
}
