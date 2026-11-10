import type { SimParams } from '../data/types';
import { Rng } from './rng';

export interface SimInput {
  seats: number;
  group: number;
  minBidCents: number;
  params: SimParams;
  runs?: number;
  seed?: number;
}

export interface SimResult {
  runs: number;
  pFill: number;
  percentilesCents: { p50: number; p80: number; p90: number; p95: number; p99: number };
  histogram: { startCents: number; binWidthCents: number; counts: number[] };
  curve: { bidCents: number[]; pIn: number[] };
}

const HIST_BINS = 40;
const GRID_POINTS = 120;

/** In-place quickselect: after the call, buf[kth] is the kth smallest of buf[0..n). */
function quickselect(buf: Float64Array, n: number, kth: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = buf[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (buf[i] < pivot) i++;
      while (buf[j] > pivot) j--;
      if (i <= j) {
        const t = buf[i];
        buf[i] = buf[j];
        buf[j] = t;
        i++;
        j--;
      }
    }
    if (kth <= j) hi = j;
    else if (kth >= i) lo = i;
    else break;
  }
  return buf[kth];
}

/** Chance all `group` members win when they bid exactly the cutoff: `above` rivals bid more, `tied` bid the same, the
 *  remaining seats go by random draw. C(seats - above, group) / C(tied + group, group), as a product (same as sim.py). */
export function tieWinChance(seats: number, group: number, above: number, tied: number): number {
  let w = 1;
  for (let i = 0; i < group; i++) w *= (seats - above - i) / (tied + group - i);
  return w > 0 ? w : 0;
}

export function simulate(input: SimInput): SimResult {
  const { seats, group, minBidCents: minBid, params: p } = input;
  const runs = Math.max(1, Math.floor(input.runs ?? 30000));
  const rng = new Rng(input.seed ?? 12345);
  const k = seats - group + 1;
  let buf = new Float64Array(256);
  const cutoffs = new Int32Array(runs);
  let filled = 0;
  const tieWin = new Float64Array(runs); // chance a bid equal to this run's cutoff wins (1 when seats were left over)

  for (let r = 0; r < runs; r++) {
    const n = rng.negBin(p.demandMean, p.demandDispersion);
    if (n < k || k <= 0 && n === 0) {
      // N < k: seats are not contested; k<=0: group alone fills.
      cutoffs[r] = minBid;
      if (n < k && k > 0) tieWin[r] = 1;
      if (n >= k) filled++;
      continue;
    }
    filled++;
    if (buf.length < n) buf = new Float64Array(Math.max(n, buf.length * 2));
    const m = p.priceLevelCents * Math.exp(p.anchorSigma * rng.normal());
    const { anchorShare, anchorCents, priceSigma } = p;
    for (let i = 0; i < n; i += 2) {
      rng.normalPair();
      const z0 = rng.z0;
      const z1 = rng.z1;
      let bid = rng.uniform() < anchorShare ? anchorCents + rng.uniform() * 200 : m * Math.exp(priceSigma * z0);
      bid = Math.round(bid);
      buf[i] = bid < minBid ? minBid : bid;
      if (i + 1 < n) {
        bid = rng.uniform() < anchorShare ? anchorCents + rng.uniform() * 200 : m * Math.exp(priceSigma * z1);
        bid = Math.round(bid);
        buf[i + 1] = bid < minBid ? minBid : bid;
      }
    }
    // k-th highest == (n-k)-th smallest (0-indexed)
    if (k <= 0) {
      cutoffs[r] = minBid;
    } else {
      const c = quickselect(buf, n, n - k);
      cutoffs[r] = c;
      let above = 0;
      let tied = 0;
      for (let i = 0; i < n; i++) {
        if (buf[i] > c) above++;
        else if (buf[i] === c) tied++;
      }
      tieWin[r] = tieWinChance(seats, group, above, tied);
    }
  }

  const sorted = Int32Array.from(cutoffs).sort();
  const pct = (q: number) => sorted[Math.min(runs - 1, Math.floor(q * runs))];
  const percentilesCents = { p50: pct(0.5), p80: pct(0.8), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99) };

  const hi = Math.max(minBid + 100, Math.ceil(percentilesCents.p99 * 1.15));
  const binWidthCents = Math.max(1, Math.ceil((hi - minBid) / HIST_BINS));
  const counts = new Array<number>(HIST_BINS).fill(0);
  for (let i = 0; i < runs; i++) {
    const b = Math.min(HIST_BINS - 1, Math.floor((cutoffs[i] - minBid) / binWidthCents));
    counts[b < 0 ? 0 : b]++;
  }

  // A bid above a run's cutoff wins; a bid equal to it wins with that run's tie chance (random draw among equal bids).
  const tieSum = new Map<number, number>(); // summed in run order, as sim.py does
  for (let i = 0; i < runs; i++) tieSum.set(cutoffs[i], (tieSum.get(cutoffs[i]) ?? 0) + tieWin[i]);

  // lowerBound(x): count of cutoffs < x
  const lower = (x: number) => {
    let a = 0;
    let b = runs;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (sorted[mid] < x) a = mid + 1;
      else b = mid;
    }
    return a;
  };
  const bidCents: number[] = [];
  const pIn: number[] = [];
  const step = Math.max(1, (hi - minBid) / (GRID_POINTS - 1));
  let prev = -Infinity;
  for (let i = 0; i < GRID_POINTS; i++) {
    const b = i === GRID_POINTS - 1 ? hi : Math.round(minBid + i * step);
    if (b <= prev) continue;
    prev = b;
    bidCents.push(b);
    pIn.push((lower(b) + (tieSum.get(b) ?? 0)) / runs);
  }

  return { runs, pFill: filled / runs, percentilesCents, histogram: { startCents: minBid, binWidthCents, counts }, curve: { bidCents, pIn } };
}

export function pInAt(result: SimResult, bidCents: number): number {
  const { bidCents: xs, pIn: ys } = result.curve;
  const n = xs.length;
  if (bidCents <= xs[0]) return ys[0];
  if (bidCents >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= bidCents) lo = mid;
    else hi = mid;
  }
  const t = (bidCents - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

const oddCents = (c: number) => (c % 2 === 0 ? c + 1 : c);

export function recommendBid(result: SimResult, targetP: number): number {
  const { bidCents: xs, pIn: ys } = result.curve;
  const n = xs.length;
  let bid: number;
  if (ys[0] >= targetP) bid = xs[0];
  else if (ys[n - 1] < targetP) bid = xs[n - 1];
  else {
    let i = 1;
    while (ys[i] < targetP) i++;
    const t = (targetP - ys[i - 1]) / (ys[i] - ys[i - 1]);
    bid = Math.ceil(xs[i - 1] + t * (xs[i] - xs[i - 1]));
    // guard against float edge cases of the interpolation
    while (bid < xs[i] && pInAt(result, bid) < targetP) bid++;
  }
  return oddCents(bid);
}
