import { simulate, type SimInput, type SimResult } from './index';
import { createSimMemo } from './cache';
import { optimise, tradeoff, type PlanInput, type PlanResult, type TradeoffPoint } from './planner';

type Pending = { resolve: (r: unknown) => void; fallback: () => unknown };

let worker: Worker | null = null;
let failed = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (failed || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data as { id: number; result?: unknown; error?: string };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      p.resolve(error || result === undefined ? p.fallback() : result);
    };
    w.onerror = () => {
      failed = true;
      worker = null;
      const all = [...pending.values()];
      pending.clear();
      for (const p of all) p.resolve(p.fallback());
    };
    worker = w;
    return w;
  } catch {
    failed = true;
    return null;
  }
}

/** Runs off the main thread when a worker is available, otherwise inline. */
function call<T>(op: 'sim' | 'optimise' | 'tradeoff', input: unknown, fallback: () => T): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.resolve(fallback());
  return new Promise<T>((resolve) => {
    const id = nextId++;
    pending.set(id, { resolve: resolve as (r: unknown) => void, fallback });
    w.postMessage({ id, op, input });
  });
}

// Answers are remembered per input (see ./cache), so revisiting a course or switching back to a section is instant.
const memo = createSimMemo();

export const runSim = (input: SimInput): Promise<SimResult> =>
  memo.run('sim', input, () => call('sim', input, () => simulate(input)));
export const runOptimise = (input: PlanInput): Promise<PlanResult> =>
  memo.run('optimise', input, () => call('optimise', input, () => optimise(input)));
export const runTradeoff = (input: Omit<PlanInput, 'certainty'>): Promise<TradeoffPoint[]> =>
  memo.run('tradeoff', input, () => call('tradeoff', input, () => tradeoff(input)));
