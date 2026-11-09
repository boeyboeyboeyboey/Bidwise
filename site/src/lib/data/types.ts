export interface WindowInfo {
  term: string;
  /** e.g. '1', '1A', '2B' */
  round: string;
  window: number;
  /** Absent in data built before opensAt was added. */
  opensAt?: string;
  closesAt: string;
  status: 'open' | 'closed' | 'upcoming';
}

/** One row of data/real/index.json. */
export interface CourseIndexEntry {
  code: string;
  title: string;
  school: string;
  offeredNow: boolean;
  /** Sections offered in the current term. */
  sectionCount: number;
  termsWithData: number;
}

/** Search payload sent to the browser: [code, title, sections offered now]. */
export type SearchEntry = [code: string, title: string, sections: number];

export interface Meeting {
  day: string;
  start: string;
  end: string;
  venue: string;
}

/** Seats from the latest availability scan (model/build_site_data.py --availability). Absent when there is no scan. */
export interface LiveSeats {
  available: number;
  total: number;
  /** live: seen in ClassSearch. approx: estimated from the previous window's after-process vacancy. */
  source: 'live' | 'approx';
  capturedAt: string;
  window: string;
  /** Change in available seats since the window-open scan. Live sections only; null when unknown. */
  sinceOpen?: number | null;
  /** Change in available seats since the previous scan. Live sections only; null when unknown. */
  sinceLast?: number | null;
  /** Available seats at each scan this window, oldest first (2+ points). Live sections only. */
  history?: SeatPoint[];
}

export interface SeatPoint {
  at: string;
  available: number;
}

/** A section offered in the current term. */
export interface Section {
  id: string;
  section: string;
  classNumber: string;
  instructor: string;
  meetings: Meeting[];
  startDate: string;
  endDate: string;
  tba: boolean;
  hasClassDetails: boolean;
  seatsTotal: number;
  seatsLeft: number;
  /** Seats now. Prefer this over seatsLeft via seatsOf() in lib/data/seats.ts. */
  live?: LiveSeats;
  /** Latest BOSS window with results for this section. */
  latestWindow: string;
  enrolled: number;
  /** Final exam from the BOSS class details. null = none listed (can also mean TBA or a missed capture); absent = no exam data in this build. */
  exam?: { date: string; start: string; end: string | null } | null;
  /** Minimum bid in cents. Only on sections that have fitted forecast parameters. */
  minBidCents?: number;
  /** Fitted parameters per bidding window label. Only in the fetched course file, not in the page. */
  forecast?: Record<string, ForecastWindow>;
}

export type PooledLevel = 'course×instructor' | 'course' | 'subject' | 'global';

/** One section in one window: simulator inputs plus where they came from. */
export interface ForecastWindow extends SimParams {
  pooledLevel: PooledLevel;
  /** Past results behind the estimate at its pooling level. */
  nObs: number;
}

/** One section in one past bidding window. null bids mean nobody bid successfully. */
export interface HistoryRow {
  term: string;
  /** Window label exactly as BOSS writes it. */
  window: string;
  section: string;
  classNumber: string;
  instructor: string;
  days: string;
  start: string;
  end: string;
  medianCents: number | null;
  minCents: number | null;
  /** Seats offered. */
  vacancy: number;
  /** Seats open before the window was processed. */
  before: number;
  /** Seats open after the window was processed. */
  after: number;
  enrolled: number;
}

/** Contents of data/real/courses/<code>.json. */
/** Chance a full section gets a seat back, cumulative by each later window (model/forecast/drops.py). Course-level, full sections only. */
export interface DropChance {
  /** Window the estimate starts from. */
  from: string;
  /** p: cumulative chance 0..1; n: past cases behind it; l: level of that n (c course, s subject, g all courses). */
  steps: { w: string; p: number; n: number; l: 'c' | 's' | 'g' }[];
}

export interface CourseData {
  drops?: DropChance;
  code: string;
  title: string;
  school: string;
  sectionsNow: Section[];
  history: HistoryRow[];
}

/** Section data embedded in the course page (no history, no forecast parameters). */
export type CourseHead = Pick<CourseData, 'code' | 'title' | 'school' | 'sectionsNow'>;

export interface SimParams {
  demandMean: number;
  demandDispersion: number;
  priceLevelCents: number;
  priceSigma: number;
  anchorSigma: number;
  anchorShare: number;
  anchorCents: number;
}

/** Backtest numbers per window, from data/real/forecast-meta.json. */
export interface ForecastWindowMeta {
  confidence: 'ok' | 'low';
  samples: number;
  filled: number;
  coverage80: number | null;
  coverage80Filled: number | null;
  maeCents: number | null;
  /** Error if you reused last term's bid, same window. */
  baselineMaeCents: number | null;
}

/** data/real/forecast-meta.json. `windows` is empty when forecasts are not available. */
export interface ForecastMeta {
  term: string | null;
  windows: string[];
  byWindow: Record<string, ForecastWindowMeta>;
  coverage80: number | null;
  maeCents: number | null;
  samples: number;
  baseline: { samples: number | null; maeCents: number | null; modelMaeCents: number | null } | null;
  generatedAt: string;
}

/** Home page strip. */
export interface Accuracy {
  /** Share of held-out outcomes inside the forecast 80% range, 0..1. */
  coverage80: number;
  samples: number;
  /** Average absolute error of the median cutoff, cents. */
  maeCents: number;
  /** Same error if you guessed last term's price, cents. */
  baselineMaeCents: number;
}

/** One row of a home page forecast list, simulated at build time for the current window. */
export interface ForecastHighlight {
  code: string;
  title: string;
  section: string;
  classNumber: string;
  instructor: string | null;
  seatsLeft: number;
  seatsTotal: number;
  /** Seats are estimated from the previous window (not scanned live). */
  approx?: boolean;
  minBidCents: number;
  pFill: number;
  p50Cents: number;
  /** Bid for a seat with chance `targetP`, group of 1: the same figure the course page shows. */
  bidCents: number;
}

/** The two home page lists for one forecast window. */
export interface WindowHighlights {
  mostContested: ForecastHighlight[];
  /** Sections least likely to fill (cheapest to get into). */
  easy: ForecastHighlight[];
}

export interface ForecastHighlights {
  term: string;
  /** The window that is open now. */
  window: string;
  runs: number;
  targetP: number;
  /** Keyed by window label, e.g. "Round 1A Window 3": one entry for every forecast window. */
  byWindow: Record<string, WindowHighlights>;
}

/** One bidding window in the term's schedule. Times are ISO strings with the SGT offset. */
export interface ScheduleEntry {
  round: string;
  window: number;
  opensAt: string;
  closesAt: string;
}

/** Set in meta.json while the newest window's results are only partly released. */
export interface ResultsPartial {
  window: string;
  posted: number;
  expected: number;
}
