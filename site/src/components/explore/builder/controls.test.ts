import { describe, expect, it } from 'vitest';
import { allTermsOn, controlState, effectiveTerms, setAgg, setAllTerms, setBin, setChart, setLatestTerm, setX, setY, termsSizeMb, toggleTerm } from './controls';
import { fmtTick, fmtY, planFor, useLog, yLabel } from './plan';
import { colorOf, xText } from './plot';
import { CHART_TYPES, decodeSpec, defaultSpec, encodeSpec, type ChartType } from './spec';

const T = ['2024-25 Term 2', '2025-26 Term 1', '2025-26 Term 2'];
const base = defaultSpec();

describe('controls', () => {
  it('Y changes keep or reset the aggregate by the new field', () => {
    expect(setY(base, 'min').y).toEqual({ field: 'min', agg: 'median' });
    expect(setY({ ...base, y: { field: 'median', agg: 'max' } }, 'min').y.agg).toBe('max');
    expect(setY(base, 'filled').y).toEqual({ field: 'filled', agg: 'pctTrue' });
    expect(setY(setY(base, 'count'), 'median').y).toEqual({ field: 'median', agg: 'median' });
    expect(setAgg(setY(base, 'filled'), 'median').y.agg).toBe('pctTrue');
  });

  it('only offers aggregates the Y field allows', () => {
    expect(controlState(base).aggs).toContain('median');
    expect(controlState(setY(base, 'filled')).aggs).not.toContain('median');
    expect(controlState(setY(base, 'count')).aggLocked).toBe(true);
  });

  it('scatter and box force raw rows and cannot count rows', () => {
    const c = setY(base, 'count');
    const s = setChart(c, 'scatter');
    expect(s.raw).toBe(true);
    expect(s.y.field).toBe('median');
    expect(controlState(s).yFields.some((f) => f.id === 'count')).toBe(false);
    expect(controlState(s).aggLocked).toBe(true);
    expect(setChart(s, 'bar').raw).toBeUndefined();
  });

  it('enables bin only for a numeric x, sort only for a category x', () => {
    expect(controlState(base).binOn).toBe(false);
    expect(controlState(base).sortOn).toBe(true);
    const n = setX(base, 'vacancy');
    expect(controlState(n).binOn).toBe(true);
    expect(controlState(n).sortOn).toBe(false);
    expect(setBin(n, '10').bin).toBe(10);
    expect(setBin(setBin(n, '10'), '').bin).toBeUndefined();
    expect(setBin(n, '-3').bin).toBeUndefined();
    expect(setX(setBin(n, '10'), 'course').bin).toBeUndefined();
  });

  it('forces zero for bars and disables log where it is meaningless', () => {
    expect(controlState(base).zeroChecked).toBe(true);
    expect(controlState(base).zeroOn).toBe(false);
    const line = setChart(base, 'line');
    expect(controlState(line).zeroOn).toBe(true);
    expect(controlState(setChart(line, 'stackedBar')).logOn).toBe(false);
    expect(useLog({ ...line, log: true })).toBe(true);
    expect(useLog({ ...setChart(line, 'heatmap'), log: true })).toBe(false);
  });

  it('every control change survives the URL', () => {
    let s = setChart(setX(setY(base, 'filled'), 'subject'), 'line');
    s = { ...s, color: 'round', facet: 'band', swap: true, log: true, zero: false };
    expect(decodeSpec(encodeSpec(s))).toEqual(s);
  });
});

describe('terms', () => {
  it('no filter means the latest term, and choosing only the latest drops the filter', () => {
    expect(effectiveTerms(base, T)).toEqual([T[2]]);
    const two = toggleTerm(base, T[0], T);
    expect(two.filters).toEqual([{ field: 'term', in: [T[0], T[2]] }]);
    expect(effectiveTerms(two, T)).toEqual([T[0], T[2]]);
    expect(toggleTerm(two, T[0], T).filters).toEqual([]);
  });

  it('the last term cannot be removed; all terms and the size note', () => {
    expect(toggleTerm(base, T[2], T)).toBe(base);
    const all = setAllTerms(base, T);
    expect(allTermsOn(all, T)).toBe(true);
    expect(allTermsOn(base, T)).toBe(false);
    expect(setLatestTerm(all, T).filters).toEqual([]);
    const rows = [{ term: T[0], rows: 100 }, { term: T[1], rows: 100 }, { term: T[2], rows: 200 }];
    expect(termsSizeMb(rows, T)).toBeCloseTo(12);
    expect(termsSizeMb(rows, [T[2]])).toBeCloseTo(6);
  });

  it('keeps other filters when terms change', () => {
    const s = { ...base, filters: [{ field: 'filled', in: ['true'] }] };
    expect(toggleTerm(s, T[1], T).filters).toEqual([{ field: 'filled', in: ['true'] }, { field: 'term', in: [T[1], T[2]] }]);
  });
});

describe('plan', () => {
  const marks = (chart: ChartType, extra = {}) => planFor({ ...setChart(base, chart), ...extra }).marks;

  it('picks marks per chart type', () => {
    expect(CHART_TYPES.map((c) => [c, marks(c)])).toEqual([
      ['bar', ['bar']], ['stackedBar', ['stack']], ['line', ['line', 'dot']], ['area', ['area', 'line', 'dot']], ['dot', ['dot']],
      ['scatter', ['dot']], ['box', ['box', 'tip']], ['heatmap', ['cell', 'text']], ['table', ['table']],
    ]);
  });

  it('chooses the x scale', () => {
    expect(planFor(setChart(base, 'bar')).scale).toBe('band');
    expect(planFor(setChart(base, 'line')).scale).toBe('point');
    expect(planFor(setChart(setX(base, 'vacancy'), 'line')).scale).toBe('linear');
    expect(planFor(setChart(setX(base, 'vacancy'), 'bar')).scale).toBe('band');
  });

  it('groups bars by colour, stacks stacked bars, and heatmaps need a second axis', () => {
    expect(planFor(base).grouped).toBe(false);
    expect(planFor({ ...base, color: 'round' }).grouped).toBe(true);
    expect(planFor({ ...setChart(base, 'stackedBar'), color: 'round' })).toMatchObject({ grouped: false, stacked: true });
    expect(planFor({ ...base, chart: 'heatmap' }).needsColor).toBe(true);
    expect(planFor(setChart(base, 'heatmap'))).toMatchObject({ needsColor: false });
    expect(setChart(base, 'heatmap').color).toBe('round');
    expect(setChart(setX(base, 'round'), 'heatmap').color).toBe('band');
    expect(setChart({ ...base, color: 'day' }, 'heatmap').color).toBe('day');
  });
});

describe('labels', () => {
  it('names and formats the value', () => {
    expect(yLabel(base)).toBe('Median bid (e$)');
    expect(yLabel(setY(base, 'count'))).toBe('Rows');
    expect(yLabel(setY(base, 'filled'))).toBe('Filled, % true (%)');
    expect(yLabel(setChart(base, 'scatter'))).toBe('Median bid (e$)');
    expect(fmtY(base, 12.5)).toBe('e$12.50');
    expect(fmtY(setY(base, 'filled'), 62.4)).toBe('62%');
    expect(fmtY(setY(base, 'vacancy'), 3.46)).toBe('3.5');
    expect(fmtY(setY(base, 'start'), 495)).toBe('08:15');
    expect(fmtTick(base, 10)).toBe('10');
  });

  it('writes x as a label or a bin range and keeps Other grey', () => {
    expect(xText({ x: 'R1A W2' }, undefined)).toBe('R1A W2');
    expect(xText({ x: 10, x1: 20 }, undefined)).toBe('10 to 20');
    const c = colorOf(['A', 'B', 'Other']);
    expect(c('A')).not.toBe(c('B'));
    expect(c('Other')).toBe('#d6d3cb');
  });
});
