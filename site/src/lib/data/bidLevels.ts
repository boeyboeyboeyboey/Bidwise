// The three bid levels of the held-out backtest (forecast-meta.json `bidLevels`), or null when the calibration is not active.
import type { BidLevel, BidLevels, ForecastMeta, MeasuredWinCell, MeasuredWinSummary, WindowBidLevel } from './types';

const NAMES = ['cheap', 'balanced', 'safe'] as const;

/**
 * A plain JSON object: the only thing accepted where a container keyed by style, window or band names is expected. An array would
 * answer numeric-string lookups ("0".."4") and Object.entries, so it reads as malformed, as in scripts/claim_view.py (dict only).
 */
export const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): v is number | null => v === null || num(v);

function level(v: unknown): BidLevel | null {
  if (!isPlainObject(v)) return null;
  const o = v;
  if (!num(o.level) || !num(o.lossAll) || !num(o.meanOverpay) || !numOrNull(o.lossFilled) || !numOrNull(o.winAboveFloor) || typeof o.reached !== 'boolean') return null;
  return { level: o.level, lossFilled: o.lossFilled, lossAll: o.lossAll, winAboveFloor: o.winAboveFloor, meanOverpay: o.meanOverpay, reached: o.reached };
}

/** All three levels, only when the calibration is on and ok and every level reads cleanly; otherwise null (show nothing). */
export function bidLevels(m: Pick<ForecastMeta, 'distCalibration' | 'bidLevels'> | null | undefined): BidLevels | null {
  if (!m?.bidLevels || m.distCalibration?.ok !== true || !isPlainObject(m.bidLevels)) return null;
  const [cheap, balanced, safe] = NAMES.map((n) => level(m.bidLevels?.[n]));
  return cheap && balanced && safe ? { cheap, balanced, safe } : null;
}

/** The per-window extras of the calibration. Any of the three parts can be missing; the pooled `bidLevels` then stands in. */
export interface BidWindowData {
  levels: Record<string, Record<(typeof NAMES)[number], WindowBidLevel>> | null;
  measured: Record<string, Record<string, MeasuredWinCell>> | null;
  /** Four ascending edges (e$) between the five forecast bands. */
  edges: number[] | null;
}

const rate = (v: unknown): v is number | null => v === null || (num(v) && v >= 0 && v <= 1);

function windowLevels(v: unknown): BidWindowData['levels'] {
  if (!isPlainObject(v)) return null;
  const out: NonNullable<BidWindowData['levels']> = {};
  for (const [w, cell] of Object.entries(v)) {
    if (!isPlainObject(cell)) continue;
    const parts = NAMES.map((n) => cell[n]);
    if (parts.every((p): p is Record<string, unknown> => isPlainObject(p) && num(p.level) && p.level > 0 && p.level < 1 && numOrNull(p.lossFilled))) {
      const [cheap, balanced, safe] = parts.map((p) => ({ level: p!.level as number, lossFilled: p!.lossFilled as number | null, ...(typeof p!.reached === 'boolean' ? { reached: p!.reached } : {}) }));
      out[w] = { cheap, balanced, safe };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** An upper bound is a fraction; anything else is "not known". */
const upperOf = (v: unknown): number | null => (num(v) && v >= 0 && v <= 1 ? v : null);

/** A course count behind an upper bound: finite and positive, and an integer for nCourses; anything else is left out. */
const countOf = (v: unknown, integer: boolean): number | undefined => (num(v) && v > 0 && (!integer || Number.isInteger(v)) ? v : undefined);

function windowMeasured(v: unknown): BidWindowData['measured'] {
  if (!isPlainObject(v)) return null;
  const out: NonNullable<BidWindowData['measured']> = {};
  for (const [w, b] of Object.entries(v)) {
    if (!isPlainObject(b)) continue;
    const cells: Record<string, MeasuredWinCell> = {};
    for (let i = 0; i < 5; i++) {
      const c = b[String(i)];
      if (isPlainObject(c) && rate(c.cheap) && rate(c.balanced) && rate(c.safe) && num(c.nFilled)) {
        const up = isPlainObject(c.upper) ? c.upper : null;
        const upper = up ? { cheap: upperOf(up.cheap), balanced: upperOf(up.balanced), safe: upperOf(up.safe) } : null;
        const nCourses = countOf(c.nCourses, true);
        const effCourses = countOf(c.effCourses, false);
        cells[String(i)] = {
          cheap: c.cheap, balanced: c.balanced, safe: c.safe, nFilled: c.nFilled,
          ...(c.source === 'cell' || c.source === 'group' || c.source === 'all' ? { source: c.source } : {}),
          ...(upper ? { upper } : {}),
          ...(nCourses !== undefined ? { nCourses } : {}),
          ...(effCourses !== undefined ? { effCourses } : {}),
        };
      }
    }
    if (Object.keys(cells).length === 5) out[w] = cells;
  }
  return Object.keys(out).length ? out : null;
}

/** Per-window levels, measured win rates and band edges; null when the calibration is not ok or none of them is present. */
export function bidWindowData(m: Pick<ForecastMeta, 'distCalibration' | 'bidLevelsByWindow' | 'measuredWin' | 'bandEdges'> | null | undefined): BidWindowData | null {
  if (m?.distCalibration?.ok !== true) return null;
  const levels = windowLevels(m.bidLevelsByWindow);
  const measured = windowMeasured(m.measuredWin);
  const e = m.bandEdges;
  const edges = Array.isArray(e) && e.length === 4 && e.every(num) && e.every((x, i) => i === 0 || x > e[i - 1]) ? e : null;
  return levels || measured ? { levels, measured, edges } : null;
}

/** The /method summary of past win rates on filled sections (overall and per round); null when the calibration is not ok or
 *  the overall rates do not read cleanly. Rounds that do not read cleanly are dropped. */
export function measuredSummary(m: Pick<ForecastMeta, 'distCalibration' | 'measuredWinSummary'> | null | undefined): MeasuredWinSummary | null {
  const s = m?.measuredWinSummary;
  if (m?.distCalibration?.ok !== true || !isPlainObject(s)) return null;
  const ok = (o: unknown): o is Record<(typeof NAMES)[number], number> =>
    isPlainObject(o) && NAMES.every((n) => { const v = (o as Record<string, unknown>)[n]; return num(v) && v >= 0 && v <= 1; });
  if (!ok(s.overall)) return null;
  const byRound = (Array.isArray(s.byRound) ? s.byRound : []).filter((r) => ok(r) && typeof r.label === 'string' && num(r.nFilled));
  const t = s.terms;
  const terms = Array.isArray(t) && t.length === 2 && t.every((x) => typeof x === 'string') ? (t as string[]) : undefined;
  return { overall: s.overall, byRound, ...(terms ? { terms } : {}) };
}
