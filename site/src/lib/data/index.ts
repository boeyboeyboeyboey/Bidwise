// Single swap point for site data. Build-time and client-safe pieces live here; the heavy per-course
// files are read by ./server (build only) or fetched by ./client (browser).
import meta from '../../data/real/meta.json';
import index from '../../data/real/index.json';
import forecastMeta from '../../data/real/forecast-meta.json';
import type { Accuracy, CourseIndexEntry, ForecastMeta, ResultsPartial, ScheduleEntry, SearchEntry, WindowInfo } from './types';

export * from './types';
export * from './format';

export const dataMeta = meta as {
  generatedAt: string;
  currentTerm: string;
  latestResultsWindow: string;
  /** Set while the newest window's results are only partly released. */
  resultsPartial?: ResultsPartial | null;
  window: WindowInfo & { term: string };
  schedule: ScheduleEntry[];
  /** Present when a live-seat file was merged. openScanAt, prevScanAt and scanAt are scan times (ISO, SGT): window open, the scan before the newest, the newest. */
  seats?: { capturedAt: string; window: string; openScanAt?: string; prevScanAt?: string; scanAt?: string };
};

export function getWindow(): WindowInfo {
  return dataMeta.window;
}

/** Full bidding schedule in order. */
export function getSchedule(): ScheduleEntry[] {
  return dataMeta.schedule;
}

export function getCourseIndex(): CourseIndexEntry[] {
  return (index as { code: string; title: string; school: string; offeredNow: boolean; sectionsNow: number; termsWithData: number }[])
    .map((c) => ({
      code: c.code, title: c.title, school: c.school, offeredNow: c.offeredNow,
      sectionCount: c.sectionsNow, termsWithData: c.termsWithData,
    }));
}

/** Compact search payload, courses offered now first. Keeps the home page HTML small. */
export function getSearchIndex(): SearchEntry[] {
  return getCourseIndex()
    .sort((a, b) => Number(b.offeredNow) - Number(a.offeredNow) || a.code.localeCompare(b.code))
    .map((c) => [c.code, c.title, c.sectionCount]);
}

/** Same term number one year earlier, e.g. "2026-27 Term 2" -> "2025-26 Term 2". */
export function previousYearTerm(term: string): string | null {
  const m = /^(\d{4})-(\d{2}) (Term .+)$/.exec(term);
  if (!m) return null;
  const y = Number(m[1]) - 1;
  return `${y}-${String((Number(m[2]) + 99) % 100).padStart(2, '0')} ${m[3]}`;
}

export function getForecastMeta(): ForecastMeta {
  return forecastMeta as ForecastMeta;
}

/** Null when forecasts are unavailable (no backtest in the build). */
export function getAccuracy(): Accuracy | null {
  const m = getForecastMeta();
  const b = m.baseline;
  if (m.coverage80 === null || m.maeCents === null || !b || b.maeCents === null || b.modelMaeCents === null) return null;
  // The comparison uses the model's error on the same sections the baseline could be scored on.
  return { coverage80: m.coverage80, samples: m.samples, maeCents: b.modelMaeCents, baselineMaeCents: b.maeCents };
}
