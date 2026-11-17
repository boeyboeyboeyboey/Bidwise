// The three bid levels of the held-out backtest (forecast-meta.json `bidLevels`), or null when the calibration is not active.
import type { BidLevel, BidLevels, ForecastMeta, MeasuredWinCell, WindowBidLevel } from './types';

const NAMES = ['cheap', 'balanced', 'safe'] as const;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): v is number | null => v === null || num(v);

function level(v: unknown): BidLevel | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!num(o.level) || !num(o.lossAll) || !num(o.meanOverpay) || !numOrNull(o.lossFilled) || !numOrNull(o.winAboveFloor) || typeof o.reached !== 'boolean') return null;
  return { level: o.level, lossFilled: o.lossFilled, lossAll: o.lossAll, winAboveFloor: o.winAboveFloor, meanOverpay: o.meanOverpay, reached: o.reached };
}

/** All three levels, only when the calibration is on and ok and every level reads cleanly; otherwise null (show nothing). */
export function bidLevels(m: Pick<ForecastMeta, 'distCalibration' | 'bidLevels'> | null | undefined): BidLevels | null {
  if (!m?.bidLevels || m.distCalibration?.ok !== true) return null;
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
  if (!v || typeof v !== 'object') return null;
  const out: NonNullable<BidWindowData['levels']> = {};
  for (const [w, cell] of Object.entries(v as Record<string, unknown>)) {
    const c = cell as Record<string, Record<string, unknown> | undefined> | null;
    const parts = NAMES.map((n) => c?.[n]);
    if (parts.every((p) => p && num(p.level) && p.level > 0 && p.level < 1 && numOrNull(p.lossFilled))) {
      const [cheap, balanced, safe] = parts.map((p) => ({ level: p!.level as number, lossFilled: p!.lossFilled as number | null, ...(typeof p!.reached === 'boolean' ? { reached: p!.reached } : {}) }));
      out[w] = { cheap, balanced, safe };
    }
  }
  return Object.keys(out).length ? out : null;
}

function windowMeasured(v: unknown): BidWindowData['measured'] {
  if (!v || typeof v !== 'object') return null;
  const out: NonNullable<BidWindowData['measured']> = {};
  for (const [w, bands] of Object.entries(v as Record<string, unknown>)) {
    const b = bands as Record<string, Record<string, unknown> | undefined> | null;
    const cells: Record<string, MeasuredWinCell> = {};
    for (let i = 0; i < 5; i++) {
      const c = b?.[String(i)];
      if (c && rate(c.cheap) && rate(c.balanced) && rate(c.safe) && num(c.nFilled)) cells[String(i)] = { cheap: c.cheap, balanced: c.balanced, safe: c.safe, nFilled: c.nFilled };
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
