import { describe, expect, it } from 'vitest';
import { groupBlocks, isTrackBlock, leftText, parseSaved, secondOptions, splitSecond, toSelection } from './degree';
import { group, loaded, view } from '../../lib/gradreq/fixtures';
import type { Block, GradIndex } from '../../lib/gradreq';

const INTAKE = 'AY2025/26';
const index: GradIndex = {
  intakes: [INTAKE],
  schools: [{
    id: 's', name: 'S', degrees: [{
      id: 'd', name: 'D', views: { [INTAKE]: 'dv' },
      secondMajors: [
        { id: 'plain', name: 'Plain', school: 'x', views: { [INTAKE]: [{ id: 'p1' }] } },
        { id: 'mixed', name: 'Mixed', school: 'x', views: { [INTAKE]: [{ id: 'm1' }, { id: 'm2', variant: 'SMT' }] } },
        { id: 'vari', name: 'Vari', school: 'x', views: { [INTAKE]: [{ id: 'v1', variant: 'IS' }, { id: 'v2', variant: 'SMT' }] } },
        { id: 'sib', name: 'Sibs', school: 'x', views: { [INTAKE]: [{ id: 'p4-x-ga-bsc', }, { id: 'p4-x-pppm-bsc' }, { id: 'p4-x-zzz-bsc' }, { id: 'p4-x-ga-smt', variant: 'SMT' }] } },
        { id: 'other', name: 'Other SMU undergraduate degree', school: 'x', views: { [INTAKE]: [{ id: 'o1' }] } },
        { id: 'gone', name: 'Gone', school: 'x', views: {} },
      ],
    }],
  }],
};

describe('secondOptions', () => {
  it('lists variants of an ambiguous second major, plain ones once, and skips ones without a view', () => {
    expect(secondOptions(index, 'd', INTAKE)).toEqual([
      { value: 'plain', label: 'Plain' },
      { value: 'mixed', label: 'Mixed' },
      { value: 'mixed|SMT', label: 'Mixed (SMT)' },
      { value: 'vari|IS', label: 'Vari (IS)' },
      { value: 'vari|SMT', label: 'Vari (SMT)' },
      { value: 'sib@p4-x-ga-bsc', label: 'Sibs: Global Asia' },
      { value: 'sib@p4-x-pppm-bsc', label: 'Sibs: Public Policy and Public Management' },
      { value: 'sib@p4-x-zzz-bsc', label: 'Sibs: ZZZ' },
      { value: 'sib@p4-x-ga-smt', label: 'Sibs: Global Asia (SMT)' },
    ]);
  });
  it('round-trips into a Selection', () => {
    expect(splitSecond('vari|SMT')).toEqual({ id: 'vari', variant: 'SMT' });
    expect(toSelection({ degree: 'd', intake: INTAKE, major: '', track: '', second: 'vari|SMT' }))
      .toEqual({ degree: 'd', intake: INTAKE, secondMajor: 'vari', secondVariant: 'SMT' });
    expect(toSelection({ degree: 'd', intake: INTAKE, major: '', track: '', second: 'sib@p4-x-ga-bsc' }))
      .toEqual({ degree: 'd', intake: INTAKE, secondMajor: 'sib', secondView: 'p4-x-ga-bsc' });
  });
});

describe('parseSaved', () => {
  it('falls back to defaults on bad storage', () => {
    for (const raw of [null, '', '{', '"x"', '[]']) expect(parseSaved(raw)).toMatchObject({ left: '', courses: 1, target: 0.8, completed: [] });
  });
  it('keeps valid fields and drops invalid ones', () => {
    expect(parseSaved('{"completed":[1,"A",{}],"left":"60","courses":2,"target":0.9}')).toMatchObject({ completed: ['A'], left: '60', courses: 2, target: 0.9 });
    expect(parseSaved('{"courses":7,"target":0.5}')).toMatchObject({ courses: 1, target: 0.8 });
  });
});

describe('result helpers', () => {
  it('words the quantity by unit and hides it when unknown', () => {
    expect(leftText({ left: 6, unit: 'cu' })).toBe('6 CUs left');
    expect(leftText({ left: 1, unit: 'course' })).toBe('1 course left');
    expect(leftText({ left: null, unit: 'cu' })).toBe('');
  });
  it('groups blocks by heading path, falling back to the view label', () => {
    const b = (id: string, headings: string[], viewId = 'v') => ({ id, headings, viewId }) as Block;
    const gs = groupBlocks([b('1', ['A']), b('2', []), b('3', ['A']), b('4', [], 'w')], (id) => `view ${id}`);
    expect(gs.map((g) => [g.label, g.blocks.map((x) => x.id)])).toEqual([['A', ['1', '3']], ['view v', ['2']], ['view w', ['4']]]);
  });
  it('finds track pool sets in the raw group, since Block.choiceSets leaves them out', () => {
    const v = view('v', [group('g', { choiceSets: [{ id: 'track-x', members: [0, 1] }] }), group('h')]);
    const lv = [loaded('degree', v)];
    expect(isTrackBlock({ id: 'g', viewId: 'v' }, lv)).toBe(true);
    expect(isTrackBlock({ id: 'h', viewId: 'v' }, lv)).toBe(false);
  });
});

describe('sibling names from the real id shape', () => {
  it('names an unlisted sibling by its own token, not the shared ones', () => {
    const idx: GradIndex = { intakes: [INTAKE], schools: [{ id: 's', name: 'S', degrees: [{ id: 'd', name: 'D', views: {}, secondMajors: [
      { id: 'soss-ga', name: 'Social Science', school: 'x', views: { [INTAKE]: [
        { id: 'p4-soss-ga-bsc-is-ay2022' }, { id: 'p4-soss-ga-bsc-smt-ay2022', variant: 'SMT' },
        { id: 'p4-soss-xyz-bsc-is-ay2022' }, { id: 'p4-soss-xyz-bsc-smt-ay2022', variant: 'SMT' },
      ] } },
    ] }] }] };
    expect(secondOptions(idx, 'd', INTAKE).map((o) => o.label)).toEqual([
      'Social Science: Global Asia', 'Social Science: Global Asia (SMT)', 'Social Science: XYZ', 'Social Science: XYZ (SMT)',
    ]);
  });
});
