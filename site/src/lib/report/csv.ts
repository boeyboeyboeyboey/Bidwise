// Pure builder for the bid report CSV (no DOM). Unit tested in csv.test.ts.
// Only the figures the planner and the course page already show: no history rows, no scan internals.
import type { Meeting, Section } from '../data/types';
import { fullText, seatsOf, type SeatSource } from '../data/seats';

export const REPORT_CREDIT = 'Data: SMU BOSS public bidding results and seat availability, compiled by Bidwise';
export const REPORT_DISCLAIMER = 'Forecasts are estimates, not guarantees. Check BOSS before you bid.';
export const BID_TARGETS = [0.8, 0.9, 0.95] as const;

export interface ReportRow {
  course: string;
  title: string;
  section: string;
  classNumber: string;
  professor: string;
  schedule: string;
  /** Bidding window the forecast is for. */
  window: string;
  seats: number;
  seatsBasis: SeatSource;
  /** Bid in cents for a 80 / 90 / 95% chance of a seat, per person; null when there is no forecast. */
  bids: Record<(typeof BID_TARGETS)[number], number | null>;
  note: string;
  /** Planner only. */
  priority?: string;
  group?: number;
  /** The bid the plan uses after fitting the balance, cents; null when the row is not bid on. */
  planBidCents?: number | null;
  /** Chance of a seat at the plan bid, as the planner shows it ("87%"); '' when none. */
  planChance?: string;
  /** The same chance as a number 0..1, for the shading of the printed chance cell; null when none. */
  planP?: number | null;
  /** One line on why the plan bids this much. */
  reason?: string;
}

export interface ReportTotal {
  label: string;
  value: string;
}

export interface ReportMeta {
  title: string;
  /** Already formatted, e.g. from sgtStamp(). */
  generatedAt: string;
  /** Planner reports carry the plan columns. */
  plan: boolean;
  totals?: ReportTotal[];
  /** One-line notes under the credit rows, e.g. which picks were left out. */
  notes?: string[];
}

export type Cell = string | number | null | undefined;

/**
 * One CSV field. Text starting with = + - @ (or a tab / carriage return) gets a leading apostrophe so a
 * spreadsheet shows it as text instead of running it as a formula; real numbers are written as they are.
 */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : v;
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: readonly Cell[]): string => cells.map(csvCell).join(',');

const cents = (c: number | null | undefined): string => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

/** "≈3" for an estimated count, "3" otherwise. */
export function seatsText(seats: number, basis: SeatSource): string {
  return basis === 'approx' ? `≈${seats}` : String(seats);
}

export const BASIS_TEXT: Record<SeatSource, string> = {
  live: 'Latest scan',
  approx: 'Estimated from previous window',
  last: 'Last results',
};

const COLUMNS: { head: string; plan: boolean; get: (r: ReportRow) => Cell }[] = [
  { head: 'Course', plan: false, get: (r) => r.course },
  { head: 'Title', plan: false, get: (r) => r.title },
  { head: 'Section', plan: false, get: (r) => r.section },
  { head: 'Class number', plan: false, get: (r) => r.classNumber },
  { head: 'Professor', plan: false, get: (r) => r.professor },
  { head: 'Schedule', plan: false, get: (r) => r.schedule },
  { head: 'Forecast window', plan: false, get: (r) => r.window },
  { head: 'Seats left', plan: false, get: (r) => seatsText(r.seats, r.seatsBasis) },
  { head: 'Seats basis', plan: false, get: (r) => BASIS_TEXT[r.seatsBasis] },
  { head: 'Priority', plan: true, get: (r) => r.priority ?? '' },
  { head: 'Group size', plan: true, get: (r) => r.group },
  { head: 'Bid for 80% chance (e$)', plan: false, get: (r) => cents(r.bids[0.8]) },
  { head: 'Bid for 90% chance (e$)', plan: false, get: (r) => cents(r.bids[0.9]) },
  { head: 'Bid for 95% chance (e$)', plan: false, get: (r) => cents(r.bids[0.95]) },
  { head: 'Plan bid (e$)', plan: true, get: (r) => cents(r.planBidCents) },
  { head: 'Chance at plan bid', plan: true, get: (r) => r.planChance ?? '' },
  { head: 'Why this bid', plan: true, get: (r) => r.reason ?? '' },
  { head: 'Note', plan: false, get: (r) => r.note },
];

/** Heading of the column whose cells are shaded by chance in the printed report. */
export const CHANCE_HEAD = 'Chance at plan bid';

/** Column headings of a report, for the printable view. */
export const reportColumns = (plan: boolean): string[] => COLUMNS.filter((c) => plan || !c.plan).map((c) => c.head);
/** Cells of one row in the same order as reportColumns(). */
export const reportCells = (r: ReportRow, plan: boolean): Cell[] => COLUMNS.filter((c) => plan || !c.plan).map((c) => c.get(r));

/**
 * The whole file: UTF-8 BOM (so Excel reads the accents and ≈), title, timestamp, credit and disclaimer rows,
 * a blank row, the table, then the totals. Lines end in CRLF.
 */
export function buildReportCsv(rows: readonly ReportRow[], meta: ReportMeta): string {
  const lines: string[] = [
    csvLine([meta.title]),
    csvLine([`Generated ${meta.generatedAt}`]),
    csvLine([REPORT_CREDIT]),
    csvLine([REPORT_DISCLAIMER]),
    csvLine(['Bids are e$ per person.']),
    ...(meta.notes ?? []).map((n) => csvLine([n])),
    '',
    csvLine(reportColumns(meta.plan)),
    ...rows.map((r) => csvLine(reportCells(r, meta.plan))),
  ];
  if (meta.totals?.length) {
    lines.push('');
    for (const t of meta.totals) lines.push(csvLine([t.label, t.value]));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-08 09:20 SGT" (Singapore is UTC+8 all year), whatever the viewer's time zone. */
export function sgtStamp(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} SGT`;
}

/** "2026-11-08", for file names. */
export const sgtDate = (d: Date): string => sgtStamp(d).slice(0, 10);

const DAY = (d: string) => d.split(/[ ,]+/).filter(Boolean).map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join('/');

/** "Mon 09:00–12:15; Thu 09:00–12:15", or "Time not set". */
export function scheduleText(meetings: readonly Meeting[]): string {
  const ms = meetings.filter((m) => m.start);
  return ms.length ? ms.map((m) => `${DAY(m.day)} ${m.start}–${m.end}`).join('; ') : 'Time not set';
}

/** The identifying columns of a section's row, the same facts the section list shows. */
export function sectionFacts(code: string, title: string, s: Section): Pick<ReportRow, 'course' | 'title' | 'section' | 'classNumber' | 'professor' | 'schedule' | 'seats' | 'seatsBasis'> {
  const v = seatsOf(s);
  return {
    course: code,
    title,
    section: s.section,
    classNumber: s.classNumber,
    professor: s.instructor || 'Instructor TBA',
    schedule: scheduleText(s.meetings),
    seats: Math.max(0, v.left),
    seatsBasis: v.source,
  };
}

export const NO_BIDS: ReportRow['bids'] = { 0.8: null, 0.9: null, 0.95: null };

/** Note for a section on the course page: why it has no bid figures, or '' when it has them. */
export function courseNote(s: Section, hasForecast: boolean): string {
  if (seatsOf(s).left <= 0) return fullText(s);
  return hasForecast ? '' : 'No forecast';
}

export function reportFileName(kind: string, date: Date): string {
  return `bidwise-${kind.replace(/[^A-Za-z0-9_-]+/g, '-')}-bid-report-${sgtDate(date)}.csv`;
}
