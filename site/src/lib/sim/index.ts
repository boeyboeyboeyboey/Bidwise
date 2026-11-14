import type { SimParams } from '../data/types';
import { Rng } from './rng';

/** Optional distribution calibration (see calibrateFilled). Absent / 1 / 1 leaves the simulator exactly as it was. */
export interface SimCalibration {
  fillProb?: number | null;
  spreadLo?: number;
  spreadHi?: number;
}

export interface SimInput {
  seats: number;
  group: number;
  minBidCents: number;
  params: SimParams & SimCalibration;
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

const fillProbOf = (p: SimCalibration): number | null => {
  const f = p.fillProb;
  return typeof f === 'number' && f > 0 && f < 1 ? f : null;
};
const spreadOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1);

/** True when any calibration parameter departs from its default (fillProb outside (0,1) and spreads <= 0 count as absent). */
export function isCalibrated(p: SimCalibration): boolean {
  return fillProbOf(p) !== null || spreadOf(p.spreadLo) !== 1 || spreadOf(p.spreadHi) !== 1;
}

/** Same as _pct in sim.py: element floor(q * n) of a sorted array, clamped. */
const pctOf = (sorted: ArrayLike<number>, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Distribution calibration of the replays that filled (same as calibrate_filled in sim.py). Returns null to use the plain
 *  path (no calibration set, or no replay filled), else the fill probability (fillProb, or the simulated share), the run
 *  indices of the filled replays and their transformed cutoffs, in run order. fillProb is a single-bidder chance, so it is
 *  ignored when group > 1 (the simulated share is used; both spreads at 1 then leaves nothing to apply, so null).
 *  With m the median of the filled cutoffs: c' = max(floor, round(m * (c/m)^s)), s = spreadHi above m, spreadLo below, c' = c
 *  at m. Order and median are preserved. The clearing bid is then a mixture: mass 1 - pFill at the floor, pFill spread
 *  uniformly over the transformed filled cutoffs. */
export function calibrateFilled(
  cutoffs: ArrayLike<number>,
  flags: ArrayLike<number>,
  floor: number,
  p: SimCalibration,
  group = 1,
): { pFill: number; idx: number[]; vals: number[] } | null {
  if (!isCalibrated(p)) return null;
  if (group > 1 && spreadOf(p.spreadLo) === 1 && spreadOf(p.spreadHi) === 1) return null;
  const idx: number[] = [];
  for (let i = 0; i < cutoffs.length; i++) if (flags[i]) idx.push(i);
  if (idx.length === 0) return null;
  const fc = Int32Array.from(idx, (i) => cutoffs[i]).sort();
  const m = pctOf(fc, 0.5);
  const lo = spreadOf(p.spreadLo);
  const hi = spreadOf(p.spreadHi);
  const vals = idx.map((i) => {
    const c = cutoffs[i];
    const s = c > m ? hi : c < m ? lo : 1;
    if (s === 1 || !(m > 0)) return c;
    const v = Math.round(m * Math.pow(c / m, s));
    return v < floor ? floor : v;
  });
  const fp = group > 1 ? null : fillProbOf(p);
  return { pFill: fp === null ? idx.length / cutoffs.length : fp, idx, vals };
}

/** Unconditional quantile at level a of the mixture: the floor if 1 - pFill >= a, else the empirical quantile of the sorted
 *  transformed filled cutoffs at level (a - (1 - pFill)) / pFill (same as mixture_quantile in sim.py). */
export function mixtureQuantile(sortedF: ArrayLike<number>, pFill: number, floor: number, a: number): number {
  if (1 - pFill >= a) return floor;
  return pctOf(sortedF, (a - (1 - pFill)) / pFill);
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
  const filledFlag = new Uint8Array(runs);

  for (let r = 0; r < runs; r++) {
    const n = rng.negBin(p.demandMean, p.demandDispersion);
    if (n < k || k <= 0 && n === 0) {
      // N < k: seats are not contested; k<=0: group alone fills.
      cutoffs[r] = minBid;
      if (n < k && k > 0) tieWin[r] = 1;
      if (n >= k) {
        filled++;
        filledFlag[r] = 1;
      }
      continue;
    }
    filled++;
    filledFlag[r] = 1;
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

  const cal = calibrateFilled(cutoffs, filledFlag, minBid, p, group);
  let pFill = filled / runs;
  let sorted: Int32Array;
  let percentilesCents: SimResult['percentilesCents'];
  const tieSum = new Map<number, number>(); // summed in run order, as sim.py does
  // cumulative win chance of a bid b: the share of runs it beats, ties by random draw
  let win: (b: number) => number;
  // lowerBound(x): count of sorted values < x
  const lower = (x: number) => {
    let a = 0;
    let b = sorted.length;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (sorted[mid] < x) a = mid + 1;
      else b = mid;
    }
    return a;
  };
  if (cal === null) {
    sorted = Int32Array.from(cutoffs).sort();
    const pct = (q: number) => sorted[Math.min(runs - 1, Math.floor(q * runs))];
    percentilesCents = { p50: pct(0.5), p80: pct(0.8), p90: pct(0.9), p95: pct(0.95), p99: pct(0.99) };
    // A bid above a run's cutoff wins; a bid equal to it wins with that run's tie chance (random draw among equal bids).
    for (let i = 0; i < runs; i++) tieSum.set(cutoffs[i], (tieSum.get(cutoffs[i]) ?? 0) + tieWin[i]);
    win = (b) => (lower(b) + (tieSum.get(b) ?? 0)) / runs;
  } else {
    pFill = cal.pFill;
    sorted = Int32Array.from(cal.vals).sort();
    const nf = sorted.length;
    const mq = (q: number) => mixtureQuantile(sorted, cal.pFill, minBid, q);
    percentilesCents = { p50: mq(0.5), p80: mq(0.8), p90: mq(0.9), p95: mq(0.95), p99: mq(0.99) };
    for (let j = 0; j < nf; j++) tieSum.set(cal.vals[j], (tieSum.get(cal.vals[j]) ?? 0) + tieWin[cal.idx[j]]);
    // mass 1 - pFill at the floor (any bid at or above it wins), pFill spread over the transformed filled replays
    win = (b) => 1 - cal.pFill + cal.pFill * ((lower(b) + (tieSum.get(b) ?? 0)) / nf);
  }

  const hi = Math.max(minBid + 100, Math.ceil(percentilesCents.p99 * 1.15));
  const binWidthCents = Math.max(1, Math.ceil((hi - minBid) / HIST_BINS));
  const counts = new Array<number>(HIST_BINS).fill(0);
  if (cal === null) {
    for (let i = 0; i < runs; i++) {
      const b = Math.min(HIST_BINS - 1, Math.floor((cutoffs[i] - minBid) / binWidthCents));
      counts[b < 0 ? 0 : b]++;
    }
  } else {
    // weights: the floor mass counts for runs * (1 - pFill), each filled replay for runs * pFill / nf
    counts[0] += runs * (1 - cal.pFill);
    const wt = (runs * cal.pFill) / sorted.length;
    for (let j = 0; j < sorted.length; j++) {
      const b = Math.min(HIST_BINS - 1, Math.floor((sorted[j] - minBid) / binWidthCents));
      counts[b < 0 ? 0 : b] += wt;
    }
  }

  const bidCents: number[] = [];
  const pIn: number[] = [];
  const step = Math.max(1, (hi - minBid) / (GRID_POINTS - 1));
  let prev = -Infinity;
  for (let i = 0; i < GRID_POINTS; i++) {
    const b = i === GRID_POINTS - 1 ? hi : Math.round(minBid + i * step);
    if (b <= prev) continue;
    prev = b;
    bidCents.push(b);
    pIn.push(win(b));
  }

  return { runs, pFill, percentilesCents, histogram: { startCents: minBid, binWidthCents, counts }, curve: { bidCents, pIn } };
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
