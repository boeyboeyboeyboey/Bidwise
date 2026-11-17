// Site-wide state shared by every page, kept in localStorage (wrapped: storage can be unavailable).
// - The chosen bidding window: set from the header, read by the course page, planner and Past bids.
// - The plan: written by the course page's "Add to plan" and read/written by the planner.
// Pages subscribe with onWindowChange/onPlanChange; changes in another tab arrive via the storage event.
import { BALANCE_EMPTY_MARK, decodePlan } from '../components/planner/plan';
import type { StoredPlan } from '../components/planner/plan';
import { DEFAULT_TARGET, targetToStored } from './sim/presets';

export const WINDOW_KEY = 'boss.window';
export const PLAN_KEY = 'boss.planner';
/** The student's e$ balance, as typed. Nothing stored means never set (the planner then starts at e$125); BALANCE_EMPTY_MARK means cleared on purpose. */
export const BALANCE_KEY = 'bidwise.balance';
const WINDOW_EVENT = 'boss:window';
const PLAN_EVENT = 'boss:plan';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the change lives only in this page */
  }
}

/** The chosen window label, or null when the user hasn't picked one (pages then use the open window). */
export function getChosenWindow(): string | null {
  return read(WINDOW_KEY);
}

/** Pass null to go back to the open window. */
export function setChosenWindow(label: string | null): void {
  write(WINDOW_KEY, label);
  window.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: label }));
}

export function onWindowChange(fn: (label: string | null) => void): () => void {
  const local = (e: Event) => fn((e as CustomEvent<string | null>).detail);
  const other = (e: StorageEvent) => e.key === WINDOW_KEY && fn(e.newValue);
  window.addEventListener(WINDOW_EVENT, local);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(WINDOW_EVENT, local);
    window.removeEventListener('storage', other);
  };
}

/** The stored balance text: null when never set, BALANCE_EMPTY_MARK when the student cleared it, else what they typed. */
export function getBalanceText(): string | null {
  return read(BALANCE_KEY);
}

/** Pass '' to record an empty balance on purpose (it stays empty after a reload, unlike nothing stored). */
export function setBalanceText(text: string): void {
  write(BALANCE_KEY, text.trim() === '' ? BALANCE_EMPTY_MARK : text.trim());
}

export function getPlan(): StoredPlan | null {
  try {
    return decodePlan(JSON.parse(read(PLAN_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

export function savePlan(plan: StoredPlan): void {
  write(PLAN_KEY, JSON.stringify(plan));
  window.dispatchEvent(new CustomEvent(PLAN_EVENT));
  // The nav badge in Base.astro listens for this older event name.
  window.dispatchEvent(new CustomEvent('plan-change'));
}

export function onPlanChange(fn: () => void): () => void {
  const other = (e: StorageEvent) => e.key === PLAN_KEY && fn();
  window.addEventListener(PLAN_EVENT, fn);
  window.addEventListener('storage', other);
  return () => {
    window.removeEventListener(PLAN_EVENT, fn);
    window.removeEventListener('storage', other);
  };
}

/** Adds (or updates) one course section in the saved plan; returns the updated plan. */
export function addToPlan(code: string, sectionId: string, group: number): StoredPlan {
  const plan: StoredPlan = getPlan() ?? { b: null, s: targetToStored(DEFAULT_TARGET), w: '', a: [], r: [] };
  const rows = plan.r.filter((x) => x.c !== code);
  rows.push({ c: code, i: sectionId, g: group, o: 'required', l: 'A' });
  const next = { ...plan, r: rows };
  savePlan(next);
  return next;
}

export function planHas(code: string, sectionId?: string): boolean {
  return (getPlan()?.r ?? []).some((x) => x.c === code && (sectionId === undefined || x.i === sectionId));
}
