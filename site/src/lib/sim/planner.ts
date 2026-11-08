import { pInAt, recommendBid, type SimResult } from './index';

export type Role = 'required' | 'oneOf' | 'optional';

export interface PlanItem {
  key: string;
  courseCode: string;
  role: Role;
  oneOfGroup?: string;
  curve: SimResult;
}

export interface PlanInput {
  budgetCents: number;
  items: PlanItem[];
  /** 0 = save e$, 1 = be sure. */
  certainty: number;
}

export interface PlanResult {
  bids: Record<string, number>;
  p: Record<string, number>;
  pAll: number;
  /** Expected spend: only successful bids are charged. */
  spentCents: number;
  /** Sum of all bids placed (must fit the balance). */
  bidTotalCents: number;
  leftCents: number;
}

export interface TradeoffPoint {
  s: number;
  spentCents: number;
  pAll: number;
}

const OPTIONAL_WEIGHT = 0.1;
const GRID = 50;
const EPS = 1e-12;

const oddCents = (c: number) => (c % 2 === 0 ? c + 1 : c);
/** Cost weight per unit of budget fraction spent; 0 at s = 1. */
export const kappa = (s: number): number => 1.2 * (1 - Math.min(1, Math.max(0, s))) ** 2;

const minBidOf = (it: PlanItem) => it.curve.histogram.startCents;
const maxBidOf = (it: PlanItem) => it.curve.curve.bidCents[it.curve.curve.bidCents.length - 1];
const pOf = (it: PlanItem, bid: number) => (bid <= 0 || bid < minBidOf(it) ? 0 : pInAt(it.curve, bid));

interface Prepared {
  items: PlanItem[];
  groupOf: number[]; // -1 = required, -2 = optional, >=0 oneOf group index
  groups: number;
}

function prepare(items: PlanItem[]): Prepared {
  const names = new Map<string, number>();
  const groupOf = items.map((it) => {
    if (it.role === 'required') return -1;
    if (it.role === 'optional') return -2;
    const g = it.oneOfGroup ?? 'A';
    if (!names.has(g)) names.set(g, names.size);
    return names.get(g)!;
  });
  return { items, groupOf, groups: names.size };
}

function evaluate(pr: Prepared, ps: number[]): number {
  let all = 1;
  let opt = 0;
  const miss = new Array<number>(pr.groups).fill(1);
  for (let i = 0; i < ps.length; i++) {
    const g = pr.groupOf[i];
    if (g === -1) all *= ps[i];
    else if (g === -2) opt += ps[i];
    else miss[g] *= 1 - ps[i];
  }
  for (let g = 0; g < pr.groups; g++) all *= 1 - miss[g];
  return all + OPTIONAL_WEIGHT * opt;
}

const pAllOf = (pr: Prepared, ps: number[]) => {
  const masked = ps.map((p, i) => (pr.groupOf[i] === -2 ? 0 : p));
  return evaluate(pr, masked);
};

function ascend(pr: Prepared, start: number[], budget: number, kap: number): { bids: number[]; obj: number } {
  const n = pr.items.length;
  const bids = start.slice();
  const ps = bids.map((b, i) => pOf(pr.items[i], b));
  const score = () => {
    let exp = 0;
    for (let i = 0; i < bids.length; i++) exp += ps[i] * bids[i];
    return evaluate(pr, ps) - (kap * exp) / budget;
  };
  let best = score();

  const tryItem = (i: number, cands: number[]): boolean => {
    const used = bids.reduce((a, b) => a + b, 0) - bids[i];
    const room = budget - used;
    const prevBid = bids[i];
    const prevP = ps[i];
    let bBid = prevBid;
    let bP = prevP;
    for (const c of cands) {
      if (c > room) continue;
      bids[i] = c;
      ps[i] = pOf(pr.items[i], c);
      const s = score();
      if (s > best + EPS) {
        best = s;
        bBid = c;
        bP = ps[i];
      }
    }
    bids[i] = bBid;
    ps[i] = bP;
    return bBid !== prevBid;
  };

  const gridFor = (it: PlanItem): number[] => {
    const lo = minBidOf(it);
    const hi = Math.min(budget, Math.ceil(maxBidOf(it) / GRID) * GRID);
    const out = [0, oddCents(lo)];
    for (let b = Math.ceil((lo + 1) / GRID) * GRID; b <= hi; b += GRID) out.push(oddCents(b));
    return out;
  };
  const grids = pr.items.map(gridFor);

  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) if (tryItem(i, grids[i])) changed = true;
    if (!changed) break;
  }
  // refine +-49 cents, odd values only
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (bids[i] === 0) continue;
      const lo = minBidOf(pr.items[i]);
      const cands: number[] = [];
      for (let d = -49; d <= 49; d++) {
        const c = bids[i] + d;
        if (c >= lo && c % 2 === 1) cands.push(c);
      }
      if (tryItem(i, cands)) changed = true;
    }
    if (!changed) break;
  }
  return { bids, obj: best };
}

function initials(pr: Prepared, budget: number): number[][] {
  const order = pr.items
    .map((_, i) => i)
    .sort((a, b) => {
      const rank = (i: number) => (pr.groupOf[i] === -1 ? 0 : pr.groupOf[i] >= 0 ? 1 : 2);
      return rank(a) - rank(b);
    });
  const mk = (bidFor: (it: PlanItem) => number) => {
    const bids = new Array<number>(pr.items.length).fill(0);
    let used = 0;
    for (const i of order) {
      const it = pr.items[i];
      const b = Math.max(bidFor(it), oddCents(minBidOf(it)));
      if (used + b <= budget) {
        bids[i] = b;
        used += b;
      }
    }
    return bids;
  };
  return [
    mk((it) => minBidOf(it)),
    mk((it) => recommendBid(it.curve, 0.5)),
    mk((it) => recommendBid(it.curve, 0.8)),
    mk((it) => recommendBid(it.curve, 0.95)),
  ];
}

function solve(input: PlanInput, fast: boolean): PlanResult {
  const budget = Math.max(0, Math.floor(input.budgetCents));
  const pr = prepare(input.items);
  const kap = kappa(input.certainty);
  let best: { bids: number[]; obj: number } | null = null;
  if (budget > 0 && input.items.length) {
    const inits = initials(pr, budget);
    for (const init of fast ? [inits[0], inits[2]] : inits) {
      const r = ascend(pr, init, budget, kap);
      if (!best || r.obj > best.obj) best = r;
    }
  }
  const bids = best ? best.bids : input.items.map(() => 0);
  const ps = bids.map((b, i) => pOf(pr.items[i], b));
  const total = bids.reduce((a, b) => a + b, 0);
  const spent = Math.round(bids.reduce((a, b, i) => a + b * ps[i], 0));
  const out: PlanResult = { bids: {}, p: {}, pAll: pAllOf(pr, ps), spentCents: spent, bidTotalCents: total, leftCents: budget - spent };
  input.items.forEach((it, i) => {
    out.bids[it.key] = bids[i];
    out.p[it.key] = ps[i];
  });
  return out;
}

export function optimise(input: PlanInput): PlanResult {
  return solve(input, false);
}

export function tradeoff(input: Omit<PlanInput, 'certainty'>, points = 10): TradeoffPoint[] {
  const out: TradeoffPoint[] = [];
  for (let k = 0; k < points; k++) {
    const s = points === 1 ? 1 : k / (points - 1);
    const r = solve({ ...input, certainty: s }, true);
    out.push({ s, spentCents: r.spentCents, pAll: r.pAll });
  }
  return out;
}
