// Swap chance model (direct pairs only). Pure and deterministic: no randomness, no DOM.
// A student holding section A of a course asks how likely a swap to section B of the same course is.
// SMU publishes no swap outcomes, so nothing here is fitted to swaps. The two settings below (R, K) are the
// owner's judgment of how hard swaps are, chosen so the median chance lands on the owner's anchors:
//   about as wanted 60-70%, less wanted 80-90%, more wanted 20-40%, much more wanted under 15%.
// A band around them (R_BAND, K_BAND) gives the range shown in the tooltip; the label comes from the central chance.
import type { CourseData, ForecastWindow, HistoryRow, PooledLevel, Section } from '../data/types';
import { seatsOf } from '../data/seats';

/** The forecast window that applies to the first bidding window after the swap round. */
export const SWAP_WINDOW = 'Round 1 Window 1';
/** History labels for the first bidding window of a regular round (older terms say "Round 1 Window 1", newer ones "Round 1A Window 1"). */
export const R1W1_WINDOWS: ReadonlySet<string> = new Set(['Round 1 Window 1', 'Round 1A Window 1']);
/**
 * A course is pre-assigned when, in its Round 1 Window 1 history, the median share of a section's seats put up for
 * bidding (`before` / `vacancy`) is under this. Across the 662 courses with 3+ such rows the share is two-humped:
 * 128 sit under 0.2 (almost every seat given out before bidding opens, e.g. COR1100 0.00, COR2100 0.07, COR3001 0.07)
 * and the rest are mostly above 0.3, with only 8 courses between 0.2 and 0.3, so 0.25 sits in the thin valley.
 * It flags 131 courses, 45 of them with more than one section.
 */
export const PREASSIGNED_BELOW = 0.25;
/** Fewest Round 1 Window 1 rows needed to call a course pre-assigned. */
export const PREASSIGNED_MIN_ROWS = 3;
/**
 * r: share of holders who apply to swap at all (most keep the class they were assigned), centre and band.
 * k: how strongly a request follows desirability; d is a log bid, so a gap of 0.69 means the pricier section
 * is predicted to clear at double. Centre (R, K) is set so the median chance hits the owner's anchors for the
 * Δd bands below; the band (R_BAND, K_BAND) gives the low and high chance as the extremes of
 * r / R_BAND .. r * R_BAND and k / K_BAND .. k * K_BAND.
 */
export const R = 0.1;
export const K = 5.5;
export const R_BAND = 1.5;
export const K_BAND = 1.25;
/** Likely: central chance at least this. */
export const LIKELY_AT = 0.75;
/** Unlikely: central chance below this. */
export const UNLIKELY_BELOW = 0.4;
/**
 * d = ln(median bid) + TIE_WEIGHT * ln(demand per seat). The second term is a tie-break: many sections
 * clear at the minimum bid, so their medians are equal while one is plainly busier. At 0.25 a 2x
 * difference in demand per seat counts as a 19% difference in bid, so a real price gap (1.5x or more)
 * still wins unless demand per seat differs by several times.
 */
export const TIE_WEIGHT = 0.25;
/** Fallback only: last term's bids are already on the bid scale, so no rescaling. */
export const FALLBACK_SCALE = 1;

export type SwapLabel = 'likely' | 'possible' | 'unlikely' | 'unknown';

export interface Desirability {
  /** Log of the predicted Round 1 Window 1 median bid (plus the tie-break), relative to the course's other sections; or last term's log bid ratio when `fallback`. */
  d: number;
  fallback: boolean;
  /** Past results behind d: the forecast's own count, or the matched history rows for the fallback. */
  sampleSize: number;
  pooledLevel: PooledLevel | null;
}

export interface SwapOption {
  section: string;
  label: SwapLabel;
  /** Central chance and its low / high band, 0..1. null when seats are unknown. */
  chance: number | null;
  chanceLow: number | null;
  chanceHigh: number | null;
  desirability: number;
  fallback: boolean;
  /** True when the course is pre-assigned and d comes from the forecast bid level, not the simulator. */
  preAssigned: boolean;
  sampleSize: number;
}

export type SwapCourse = Pick<CourseData, 'sectionsNow'> & Partial<Pick<CourseData, 'history'>>;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** A section's seats. 0 when unknown. */
export function holdersOf(s: Section): number {
  const t = seatsOf(s).total;
  return Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
}

const r1w1Rows = (history: readonly HistoryRow[]) => history.filter((h) => R1W1_WINDOWS.has(h.window));

/** Median share of seats put up for bidding in Round 1 Window 1 (before / vacancy), or null with fewer than PREASSIGNED_MIN_ROWS rows. */
export function offeredShare(history: readonly HistoryRow[]): number | null {
  const rows = r1w1Rows(history).filter((h) => h.vacancy > 0 && h.before != null);
  return rows.length < PREASSIGNED_MIN_ROWS ? null : median(rows.map((h) => h.before / h.vacancy));
}

/** Almost every seat is given out before bidding opens (see PREASSIGNED_BELOW). */
export function isPreAssigned(history: readonly HistoryRow[] | undefined): boolean {
  const share = history ? offeredShare(history) : null;
  return share !== null && share < PREASSIGNED_BELOW;
}

/**
 * Holders of a section. Normally its seats. In a pre-assigned course the seats put up for bidding are not
 * held by anyone yet, so holders = seats minus the typical Round 1 Window 1 seats offered (median `before`
 * of that section's rows, else of the course's rows), at least 1. 0 when the seat count is unknown.
 */
export function holdersIn(s: Section, history: readonly HistoryRow[] | undefined, preAssigned: boolean): number {
  const seats = holdersOf(s);
  if (!preAssigned || seats < 1) return seats;
  const rows = r1w1Rows(history ?? []).filter((h) => h.before != null);
  const own = rows.filter((h) => h.section === s.section);
  const offered = (own.length ? own : rows).map((h) => h.before);
  return Math.max(1, seats - Math.round(offered.length ? median(offered) : 0));
}

/** p(from -> to): chance that one holder of `from` applies to swap into `to`. */
export function requestProb(r: number, k: number, dFrom: number, dTo: number): number {
  return r * logistic(k * (dTo - dFrom));
}

/** Binomial pmf over 0..n, built in log space so it is stable for any n we meet. */
function binomPmf(n: number, p: number): number[] {
  const out = new Array<number>(n + 1).fill(0);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  const lf = [0];
  for (let i = 1; i <= n; i++) lf.push(lf[i - 1] + Math.log(i));
  const lp = Math.log(p);
  const lq = Math.log(1 - p);
  for (let i = 0; i <= n; i++) out[i] = Math.exp(lf[n] - lf[i] - lf[n - i] + i * lp + (n - i) * lq);
  return out;
}

/**
 * Exact E[min(1+X, Y) / (1+X)], X ~ Bin(nA - 1, pAB) other requesters from A, Y ~ Bin(nB, pBA)
 * requesters from B. Uses E[min(m, Y)] = sum_{j=1..m} P(Y >= j), so the cost is O(nA + nB).
 */
export function swapChance(nA: number, nB: number, pAB: number, pBA: number): number {
  if (nA < 1 || nB < 1) return 0;
  const px = binomPmf(nA - 1, pAB);
  const py = binomPmf(nB, pBA);
  const surv = new Array<number>(nB + 2).fill(0); // surv[j] = P(Y >= j)
  for (let j = nB; j >= 0; j--) surv[j] = surv[j + 1] + py[j];
  const emin = new Array<number>(nA + 1).fill(0); // emin[m] = E[min(m, Y)]
  for (let m = 1; m <= nA; m++) emin[m] = emin[m - 1] + (m <= nB ? surv[m] : 0);
  let total = 0;
  for (let x = 0; x < px.length; x++) total += (px[x] * emin[x + 1]) / (x + 1);
  return Math.min(1, Math.max(0, total));
}

export interface SwapResult {
  chance: number;
  low: number;
  high: number;
  label: Exclude<SwapLabel, 'unknown'>;
}

export function labelFor(chance: number): Exclude<SwapLabel, 'unknown'> {
  return chance >= LIKELY_AT ? 'likely' : chance < UNLIKELY_BELOW ? 'unlikely' : 'possible';
}

/** Central chance at (R, K), the low and high of the band, and the label from the central chance. */
export function swapResult(nA: number, nB: number, dA: number, dB: number): SwapResult {
  const at = (r: number, k: number) => swapChance(nA, nB, requestProb(r, k, dA, dB), requestProb(r, k, dB, dA));
  const corners = [R / R_BAND, R * R_BAND].flatMap((r) => [K / K_BAND, K * K_BAND].map((k) => at(r, k)));
  const chance = at(R, K);
  return { chance, low: Math.min(chance, ...corners), high: Math.max(chance, ...corners), label: labelFor(chance) };
}

function latestTerm(history: readonly HistoryRow[]): string | null {
  // Terms read "2025-26 Term 1": lexical order is chronological.
  let best: string | null = null;
  for (const h of history) if (best === null || h.term > best) best = h.term;
  return best;
}

/**
 * Fallback desirability from the latest term in the course history: median clearing bid of the rows
 * that match the section (same instructor, else same day and start time), relative to the median over
 * all the course's sections that term, on a log scale and scaled by FALLBACK_SCALE.
 * Neutral (d = 0, sampleSize 0) when nothing matches.
 */
export function fallbackDesirability(s: Section, history: readonly HistoryRow[]): Desirability {
  const neutral: Desirability = { d: 0, fallback: true, sampleSize: 0, pooledLevel: null };
  const term = latestTerm(history);
  if (!term) return neutral;
  const rows = history.filter((h) => h.term === term && h.medianCents != null && h.medianCents > 0);
  if (!rows.length) return neutral;
  const perSection = new Map<string, number[]>();
  for (const h of rows) (perSection.get(h.section) ?? perSection.set(h.section, []).get(h.section)!).push(h.medianCents as number);
  const courseMed = median([...perSection.values()].map(median));
  const day = s.meetings[0]?.day;
  const start = s.meetings[0]?.start;
  const norm = (x: string) => x.trim().toUpperCase();
  let match = rows.filter((h) => s.instructor && norm(h.instructor) === norm(s.instructor));
  if (!match.length && day && start) match = rows.filter((h) => norm(h.days) === norm(day) && h.start === start);
  if (!match.length) return neutral;
  const bySec = new Map<string, number[]>();
  for (const h of match) (bySec.get(h.section) ?? bySec.set(h.section, []).get(h.section)!).push(h.medianCents as number);
  const d = FALLBACK_SCALE * Math.log(median([...bySec.values()].map(median)) / courseMed);
  return { d, fallback: true, sampleSize: match.length, pooledLevel: null };
}

/** Predicted Round 1 Window 1 median clearing bid (cents) per section code, from the simulator. Sections without one use the fallback. */
export type PredictedBids = ReadonlyMap<string, number>;

/** d before centring: ln(median bid) + TIE_WEIGHT * ln(demand per seat). */
export function rawDesirability(p50Cents: number, demandMean: number, seats: number): number {
  return Math.log(p50Cents) + TIE_WEIGHT * Math.log(demandMean / seats);
}

/**
 * Desirability of every section of a course, on a log scale relative to the course's median section.
 * Normal course: ln(simulated median bid) + TIE_WEIGHT * ln(demand per seat), needing a predicted bid.
 * Pre-assigned course: the simulator would collapse to the minimum bid (almost no seats are offered), so
 * d = ln(forecast price level) instead: the course x instructor bid level pooled over all windows, times the
 * fitted time-slot effect (early / mid / late, Friday); no simulation. Sections with no usable forecast
 * use the last-term fallback.
 */
export function desirabilities(course: SwapCourse, bids: PredictedBids = new Map()): Map<string, Desirability> {
  const history = course.history ?? [];
  const pre = isPreAssigned(history);
  const raw = new Map<string, { v: number; f: ForecastWindow }>();
  for (const s of course.sectionsNow) {
    const f = s.forecast?.[SWAP_WINDOW];
    if (!f) continue;
    if (pre) {
      if (Number.isFinite(f.priceLevelCents) && f.priceLevelCents > 0) raw.set(s.section, { v: Math.log(f.priceLevelCents), f });
      continue;
    }
    const bid = bids.get(s.section);
    const seats = holdersOf(s);
    if (bid !== undefined && bid > 0 && seats > 0 && Number.isFinite(f.demandMean) && f.demandMean > 0) {
      raw.set(s.section, { v: rawDesirability(bid, f.demandMean, seats), f });
    }
  }
  const centre = raw.size ? median([...raw.values()].map((x) => x.v)) : 0;
  const out = new Map<string, Desirability>();
  for (const s of course.sectionsNow) {
    const r = raw.get(s.section);
    out.set(s.section, r
      ? { d: r.v - centre, fallback: false, sampleSize: r.f.nObs, pooledLevel: r.f.pooledLevel }
      : fallbackDesirability(s, history));
  }
  return out;
}

/** Swap chance from `fromSection` to every other section of the course. */
export function swapOptions(course: SwapCourse, fromSection: string, bids: PredictedBids = new Map()): SwapOption[] {
  const from = course.sectionsNow.find((s) => s.section === fromSection);
  if (!from) return [];
  const pre = isPreAssigned(course.history);
  const ds = desirabilities(course, bids);
  const nA = holdersIn(from, course.history, pre);
  const dA = ds.get(fromSection)!;
  return course.sectionsNow
    .filter((s) => s.section !== fromSection)
    .map((s): SwapOption => {
      const nB = holdersIn(s, course.history, pre);
      const dB = ds.get(s.section)!;
      const base = { section: s.section, desirability: dB.d, fallback: dB.fallback || dA.fallback, preAssigned: pre, sampleSize: dB.sampleSize };
      if (nA < 1 || nB < 1) return { ...base, label: 'unknown', chance: null, chanceLow: null, chanceHigh: null };
      const g = swapResult(nA, nB, dA.d, dB.d);
      return { ...base, label: g.label, chance: g.chance, chanceLow: g.low, chanceHigh: g.high };
    });
}
