import { describe, expect, it } from 'vitest';
import { pickViews } from './pick';
import type { GradIndex } from './types';

const IN = 'AY2025/26';
const index: GradIndex = {
  intakes: [IN, 'AY2026/27'],
  schools: [{
    id: 'S', name: 'School', degrees: [{
      id: 'deg', name: 'Degree', views: { [IN]: 'v-deg' },
      majors: [
        { id: 'maj', name: 'Major', views: { [IN]: 'v-maj' }, tracks: [{ id: 'trk', name: 'Track', views: { [IN]: 'v-trk' } }] },
        { id: 'late', name: 'Late major', views: { 'AY2026/27': 'v-late' } },
      ],
      tracks: [{ id: 'dtrk', name: 'Degree track', views: { [IN]: 'v-dtrk' } }],
      secondMajors: [
        { id: 'sm', name: 'Second', school: 'S', views: { [IN]: [{ id: 'v-sm' }] } },
        { id: 'smv', name: 'With variant', school: 'S', views: { [IN]: [{ id: 'v-plain' }, { id: 'v-smt', variant: 'SMT' }] } },
        { id: 'twin', name: 'Twins', school: 'S', views: { [IN]: [{ id: 'v-a' }, { id: 'v-b' }] } },
      ],
    }],
  }],
};

describe('pickViews', () => {
  it('returns degree, major, track and second major view ids in order', () => {
    const r = pickViews(index, { degree: 'deg', intake: IN, major: 'maj', track: 'trk', secondMajor: 'sm' });
    expect(r.ids).toEqual(['v-deg', 'v-maj', 'v-trk', 'v-sm']);
    expect(r.views.map((v) => v.kind)).toEqual(['degree', 'major', 'track', 'second']);
    expect(r.missing).toEqual([]);
  });

  it('finds a degree-level track and reports parts with no view for the intake', () => {
    expect(pickViews(index, { degree: 'deg', intake: IN, track: 'dtrk' }).ids).toEqual(['v-deg', 'v-dtrk']);
    const r = pickViews(index, { degree: 'deg', intake: IN, major: 'late' });
    expect(r.ids).toEqual(['v-deg']);
    expect(r.missing).toEqual(['major']);
    expect(pickViews(index, { degree: 'nope', intake: IN }).missing).toEqual(['degree']);
  });

  it('picks one sibling programme of a second major by its view id', () => {
    const r = pickViews(index, { degree: 'deg', intake: IN, secondMajor: 'twin', secondView: 'v-b' });
    expect(r.ids).toEqual(['v-deg', 'v-b']);
    expect(r.ambiguousSecond).toBe(false);
  });

  it('picks a second-major variant, defaults to the entry without one, and flags unresolved twins', () => {
    expect(pickViews(index, { degree: 'deg', intake: IN, secondMajor: 'smv', secondVariant: 'SMT' }).ids).toEqual(['v-deg', 'v-smt']);
    expect(pickViews(index, { degree: 'deg', intake: IN, secondMajor: 'smv' }).ids).toEqual(['v-deg', 'v-plain']);
    const twin = pickViews(index, { degree: 'deg', intake: IN, secondMajor: 'twin' });
    expect(twin.ids).toEqual(['v-deg', 'v-a', 'v-b']);
    expect(twin.ambiguousSecond).toBe(true);
  });
});
