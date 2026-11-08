/**
 * Accuracy on the two backtests, both fitted only on terms before the test term. One source for the home strip and /method.
 * The figures are generated: model/build_site_data.py copies them from model/forecast/out/backtest.json into
 * data/real/accuracy.json on every site-data build, so nothing here is typed by hand.
 *   fMae is the model scored on the same filled sections as the baseline, so the comparison is like for like.
 * All-forecast figures for the first test term are read from forecast-meta.json by /method.
 */
import accuracy from '../../data/real/accuracy.json';

export interface FilledTest {
  term: string;
  /** Sections that filled (clearing bid above the minimum). */
  filled: number;
  /** Average miss of the forecast's middle value on those sections, cents. */
  fMae: number;
  /** Average miss if last term's bid were reused, same sections, cents. */
  fBase: number;
  /** Share of those sections whose real bid fell inside the forecast's 10th to 90th percentile range, 0..1. */
  fCov: number;
}

/** Figures over every forecast (not only sections that filled) on the held-out term. */
export interface HeldOutTest {
  term: string;
  /** Forecasts scored. */
  n: number;
  /** Forecasts the last-term-bid baseline could make. */
  baseN: number;
  /** Average miss, cents: our forecast, and the baseline. */
  mae: number;
  base: number;
  /** Share of filled sections whose real bid fell inside the 80% range, 0..1 (ties at the minimum broken at random). */
  cov: number;
}

/** Read the generated file; fails the build loudly when the backtest is missing rather than showing invented numbers. */
export function readAccuracy(doc: { filledTests?: FilledTest[]; heldOut?: HeldOutTest | null }): {
  filledTests: FilledTest[];
  heldOut: HeldOutTest;
} {
  const filledTests = doc.filledTests ?? [];
  if (filledTests.length === 0 || !doc.heldOut) {
    throw new Error('accuracy.json has no backtest figures: run model/build_site_data.py with model/forecast/out/backtest.json present');
  }
  return { filledTests, heldOut: doc.heldOut };
}

const read = readAccuracy(accuracy as Parameters<typeof readAccuracy>[0]);

export const FILLED_TESTS: FilledTest[] = read.filledTests;
export const HELD_OUT_TEST: HeldOutTest = read.heldOut;

/** The most recent test, the one shown on the home page. */
export const LATEST_FILLED_TEST = FILLED_TESTS[FILLED_TESTS.length - 1];
