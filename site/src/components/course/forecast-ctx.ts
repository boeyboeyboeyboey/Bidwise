import type { ForecastMeta, HistoryRow, Section } from '../../lib/data/types';

/** Shared by CourseView with the section panels below it (set via Svelte context, read through getters). */
export interface ForecastCtx {
  /** Course code, e.g. "LGST201". */
  readonly code: string;
  readonly meta: ForecastMeta;
  /** Label of the current window: the one open now, or the next to open between windows. */
  readonly currentWindow: string;
  /** True when currentWindow has not opened yet. */
  readonly currentUpcoming: boolean;
  /** The bidding window the person chose (shared with the rest of the site); null = the open window. */
  readonly chosenWindow: string | null;
  setWindow(label: string): void;
  /** Sections from the fetched course file (with forecast parameters), keyed by class number. Null while loading. */
  readonly bySection: Map<string, Section> | null;
  readonly failed: boolean;
  /** This class's row in the latest window with results this term; null if none or still loading. */
  latestFor(classNumber: string): HistoryRow | null;
  /** True when the latest window's results are still being released and this class has none yet. */
  pendingFor(classNumber: string): boolean;
  /** Chance the suggested bids aim for (0.8, 0.9 or 0.95), shared by the section list and the detail. */
  readonly target: number;
  setTarget(t: number): void;
  /** True on a wide screen, where the detail sits beside the list instead of under its row. */
  readonly desktop: boolean;
  /** Shows another section of the same course. */
  select(id: string): void;
  /** Bid report CSV for every section of the course. */
  readonly canReport: boolean;
  readonly reporting: boolean;
  downloadReport(): void;
}
