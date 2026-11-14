// The three bid levels of the held-out backtest (forecast-meta.json `bidLevels`), or null when the calibration is not active.
import type { BidLevel, BidLevels, ForecastMeta } from './types';

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
