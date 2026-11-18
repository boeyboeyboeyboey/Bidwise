// Named bid presets and the bid helpers every screen shares (no DOM, no worker), so they can be unit tested.
// With the distribution calibration active the three presets are Cheap / Balanced / Safe at the levels measured on the
// held-out term; without it they are today's 80 / 90 / 95% chances, and every helper behaves exactly as before.
import forecastMeta from '../../data/real/forecast-meta.json';
import { bidLevels, bidWindowData } from '../data/bidLevels';
import type { BidStyleKey, ForecastMeta } from '../data/types';
import { pInAt, recommendBid, type SimResult } from './index';
import { bidClaims, levelForWindow, measuredCell, measuredRate, reachedForWindow, type BidClaims } from './windowBids';

export { STYLE_TARGET, belowAim, groupEstimatesHidden } from './windowBids';

export interface BidPreset {
  key: string;
  label: string;
  /** Chance level the bid is read at, 0..1. */
  level: number;
  /** Share of sections that filled where a bid at this level still lost (calibrated presets only). */
  lossFilled?: number | null;
}

const levels = bidLevels(forecastMeta as unknown as ForecastMeta);
// Per-window levels and measured win rates; absent (null) until the refit has produced them. A preset's pooled `level` stays
// its identity (what screens store and compare); the window only changes the level the bid is read at.
const windowData = levels ? bidWindowData(forecastMeta as unknown as ForecastMeta) : null;

const PRESETS: readonly BidPreset[] = levels
  ? [
      { key: 'cheap', label: 'Cheap', level: levels.cheap.level, lossFilled: levels.cheap.lossFilled },
      { key: 'balanced', label: 'Balanced', level: levels.balanced.level, lossFilled: levels.balanced.lossFilled },
      { key: 'safe', label: 'Safe', level: levels.safe.level, lossFilled: levels.safe.lossFilled },
    ]
  : [
      { key: 't80', label: '80%', level: 0.8 },
      { key: 't90', label: '90%', level: 0.9 },
      { key: 't95', label: '95%', level: 0.95 },
    ];

/** True when the presets come from the calibrated backtest levels. */
export const bidCalibrated = (): boolean => levels !== null;

/** The three presets, lowest chance first. */
export const bidPresets = (): readonly BidPreset[] => PRESETS;

/** The preset levels; the chance choices every screen offers. */
export const TARGETS: readonly number[] = PRESETS.map((p) => p.level);

/** Default chance: Balanced when calibrated, else 90%. */
export const DEFAULT_TARGET: number = levels ? PRESETS[1].level : 0.9;

export const presetFor = (level: number): BidPreset | null => PRESETS.find((p) => p.level === level) ?? null;

/** The style name ("Safe") for a chance level; null when the presets are not calibrated (they are plain percentages then). */
export const styleName = (level: number): string | null => (levels ? (presetFor(level)?.label ?? null) : null);

/** True when a cheaper style than `level` exists (calibrated only): the advice "try a cheaper style" has somewhere to go. */
export const hasCheaperStyle = (level: number): boolean => !!levels && PRESETS.findIndex((p) => p.level === level) > 0;

/** A stored chance if it is one of the current levels, else the default (old saves hold 0.8 / 0.9 / 0.95). */
export const normaliseTarget = (stored: unknown): number =>
  typeof stored === 'number' && TARGETS.includes(stored) ? stored : DEFAULT_TARGET;

/**
 * What to store for a chosen chance level. Calibrated: the preset key ('cheap' | 'balanced' | 'safe'), because Cheap's level (0.90)
 * equals an old saved "90%" and a number could not tell the two apart. Not calibrated: the number, as before.
 */
export const targetToStored = (target: number): number | string => (levels ? (presetFor(target) ?? PRESETS[1]).key : target);

/**
 * The chance level for a stored value. Calibrated: only a preset key counts; any number is a legacy save and gives `fallback`
 * (the default preset unless the caller names another). Not calibrated: a current level is kept, anything else gives `fallback`.
 */
export function targetFromStored(stored: unknown, fallback: number = DEFAULT_TARGET): number {
  if (levels) return (typeof stored === 'string' ? PRESETS.find((p) => p.key === stored)?.level : undefined) ?? fallback;
  return typeof stored === 'number' && TARGETS.includes(stored) ? stored : fallback;
}

/**
 * The bid every screen suggests for `target` (a preset's pooled level). Calibrated: a bid above the minimum goes up to the next
 * whole e$ plus one cent, since about 30% of real clearing bids are whole e$ amounts; with a `window` that has its own levels,
 * the bid is read at that window's level for the style. No window, or no per-window levels: the pooled level, as before.
 * Not calibrated: exactly recommendBid.
 */
export function suggestBid(result: SimResult, target: number, window?: string | null): number {
  const bid = recommendBid(result, levelForWindow(windowData, window, levels ? presetFor(target)?.key : null) ?? target);
  if (!levels) return bid;
  const min = result.histogram.startCents;
  if (bid <= (min % 2 === 0 ? min + 1 : min)) return bid;
  return Math.ceil((bid - 1) / 100) * 100 + 1;
}

/**
 * How often this style's bid won on sections that filled, in past terms, for sections of this window and size of price
 * (0..1). Null when not calibrated, the data is missing, or the section almost never fills; callers then keep chanceIfFills.
 */
export function measuredIfFills(window: string | null | undefined, result: SimResult, style: string | null | undefined): number | null {
  return measuredRate(windowData, window, result, style);
}

/**
 * What may be claimed next to the bid suggested for `target` in `window`: floor case, past win rate of each style that gives this
 * bid, an unreached aim, the styles with the same bid, or nothing at all for a group of 2 or more (see bidClaims).
 * `result` is the simulation for `group`; the measured rates are for one bidder, so they are never offered for a group.
 */
export function claimsFor(result: SimResult, window: string | null | undefined, group: number, target: number, minBid: number | null): BidClaims {
  const rec = suggestBid(result, target, window);
  const style = levels ? ((presetFor(target)?.key as BidStyleKey | undefined) ?? null) : null;
  const tied = levels ? PRESETS.filter((p) => suggestBid(result, p.level, window) === rec).map((p) => p.key as BidStyleKey) : [];
  const cells = Object.fromEntries(tied.map((k) => [k, measuredCell(windowData, window, result, k)]));
  const reached = Object.fromEntries(tied.map((k) => [k, reachedForWindow(windowData, window, k)]));
  return bidClaims({ group, calibrated: levels !== null, rec, minBid, style, tied, cells, reached });
}

/** Chance the bid wins given the section fills; null when it almost never fills (the number would mean nothing). */
export function chanceIfFills(result: SimResult, bidCents: number): number | null {
  const f = result.pFill;
  if (!(f >= 0.02)) return null;
  // rounded so float noise (7e-17) at the lowest bids reads as exactly 0
  return Math.min(1, Math.max(0, Math.round(((pInAt(result, bidCents) - (1 - f)) / f) * 1e9) / 1e9));
}

export type LowConfidenceReason = 'oneSeat' | 'lateWindow' | 'farWindow';

/** The late windows: few seats and few bids, so prices are harder to predict. */
export const isLateWindow = (windowLabel: string): boolean => windowLabel === 'Round 2 Window 3' || windowLabel.startsWith('Round 2A');

/**
 * A window after the build's own window (open or next to open when the data was built), in the forecast window order: its
 * forecast was made before the earlier windows' results were in. False when either label is not in `windows`.
 */
export function isFarWindow(windowLabel: string, buildWindowLabel: string, windows: readonly string[]): boolean {
  const at = windows.indexOf(windowLabel);
  const build = windows.indexOf(buildWindowLabel);
  return at >= 0 && build >= 0 && at > build;
}

/** Why a forecast deserves less trust: one seat only, a late window, or a window after the build's own (`far`, see isFarWindow). */
export function lowConfidence(seats: number, windowLabel: string, far = false): LowConfidenceReason[] {
  const out: LowConfidenceReason[] = [];
  if (seats === 1) out.push('oneSeat');
  if (isLateWindow(windowLabel)) out.push('lateWindow');
  if (far) out.push('farWindow');
  return out;
}

/**
 * Why a row's forecast deserves less trust. A window whose own tag already says it is low confidence (`windowTagged`) is not
 * repeated on every row: only the 1-seat reason stays there.
 */
export function rowLowConfidence(seats: number, windowLabel: string, windowTagged: boolean, far = false): LowConfidenceReason[] {
  return lowConfidence(seats, windowLabel, far).filter((r) => !(windowTagged && (r === 'lateWindow' || r === 'farWindow')));
}
