import { simulate, type SimInput } from './index';
import { optimise, tradeoff, type PlanInput } from './planner';

type Msg =
  | { id: number; op?: 'sim'; input: SimInput }
  | { id: number; op: 'optimise'; input: PlanInput }
  | { id: number; op: 'tradeoff'; input: Omit<PlanInput, 'certainty'> };

const ctx = self as unknown as {
  onmessage: ((e: { data: Msg }) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    const result = m.op === 'optimise' ? optimise(m.input) : m.op === 'tradeoff' ? tradeoff(m.input) : simulate(m.input);
    ctx.postMessage({ id: m.id, result });
  } catch (err) {
    ctx.postMessage({ id: m.id, error: String(err) });
  }
};
