import { describe, expect, it } from 'vitest';
import { applyTracks, isFullProgramme, withoutCoveredDegree } from './programme';
import { deriveBlocks } from './blocks';
import { codes, group, loaded, view } from './fixtures';

const degree = view('deg', [group('a', { name: 'Core' }), group('b', { name: 'Electives' }), group('c', { name: 'Overlay', role: 'overlay' })], { totalCus: 36 });

describe('withoutCoveredDegree', () => {
  it('lets a full-programme major replace the degree view (same total CUs)', () => {
    const maj = view('maj', [group('x', { name: 'Something else' })], { totalCus: 36 });
    const r = withoutCoveredDegree([loaded('degree', degree), loaded('major', maj), loaded('second', view('sm', []))]);
    expect(r.map((v) => v.view.id)).toEqual(['maj', 'sm']);
  });

  it('also treats a view with a group for every additive degree group as full', () => {
    const track = view('trk', [group('1', { name: 'core' }), group('2', { name: 'Electives' }), group('3', { name: 'Own part' })], { totalCus: 20 });
    expect(isFullProgramme(track, degree)).toBe(true);
    expect(withoutCoveredDegree([loaded('degree', degree), loaded('track', track)]).map((v) => v.view.id)).toEqual(['trk']);
  });

  it('keeps the degree view beside a partial major', () => {
    const maj = view('fin', [group('f', { name: 'Finance core' })], { totalCus: 6 });
    expect(isFullProgramme(maj, degree)).toBe(false);
    expect(withoutCoveredDegree([loaded('degree', degree), loaded('major', maj)]).map((v) => v.view.id)).toEqual(['deg', 'fin']);
  });

  it('does nothing when there is no degree view, and ignores zero totals', () => {
    expect(withoutCoveredDegree([loaded('major', view('m', []))]).length).toBe(1);
    expect(isFullProgramme(view('m', [], { totalCus: 0 }), view('d', [], { totalCus: 0 }))).toBe(false);
  });
});

describe('tracks', () => {
  const IN = 'AY2025/26';
  const gen = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
  const find = (r: ReturnType<typeof deriveBlocks>, name: string) => [...r.open, ...r.finished].find((b) => b.name === name);
  const left = (r: ReturnType<typeof deriveBlocks>, name: string) => find(r, name)?.left;

  /**
   * SCIS shape: a base "Track Courses" group (4 CUs, every track's courses) and a long "depth" list (2 CUs) that also holds
   * them; the track view restates the 4 CUs as one compulsory course plus 3 electives. Free electives take what is left over.
   */
  function scis(kind: 'degree' | 'major', compulsory: string, electives: string[], depthCus: number) {
    const base = loaded(kind, view('base', [
      group('core', { name: 'Core', type: 'specific', cus: 6, members: codes(...gen('C', 6)) }),
      group('track-credit', { name: 'Track Courses', cus: 4, members: codes(compulsory, ...electives, ...gen('X', 6)) }),
      group('depth', { name: 'Depth electives', cus: depthCus, members: codes(compulsory, ...electives, ...gen('Y', 20)) }),
      group('free', { name: 'Free Electives', type: 'free_elective', cus: 6 }),
    ], { totalCus: 12 + depthCus - 2 }));
    const track = loaded('track', view('trk', [
      group('compulsory', { name: 'Compulsory Track Course', type: 'specific', cus: 1, minCourses: 1, members: codes(compulsory) }),
      group('track-electives', { name: 'Track Electives', cus: 3, minCourses: 3, members: codes(...electives) }),
    ], { totalCus: 4 }));
    return [base, track];
  }

  it('A (IS): four track electives fill 3 track slots and 1 depth slot; free electives stay untouched', () => {
    const E = gen('E', 8);
    const r = deriveBlocks(scis('degree', 'K1', E, 2), IN, ['E1', 'E2', 'E3', 'E4']);
    expect(find(r, 'Track Courses')).toBeUndefined();
    expect(left(r, 'Compulsory Track Course')).toBe(1);
    expect(find(r, 'Track Electives')).toMatchObject({ done: 3, left: 0, complete: true });
    expect(find(r, 'Depth electives')).toMatchObject({ done: 1, left: 1 });
    expect(find(r, 'Free Electives')).toMatchObject({ done: 0, left: 6 });
  });

  it('B (CS, major view): same allocation with a 3 CU long list', () => {
    const E = gen('CS44', 9);
    const r = deriveBlocks(scis('major', 'CS440', E, 3), IN, ['CS441', 'CS442', 'CS443', 'CS444']);
    expect(left(r, 'Compulsory Track Course')).toBe(1);
    expect(find(r, 'Track Electives')).toMatchObject({ done: 3, left: 0 });
    expect(find(r, 'Depth electives')).toMatchObject({ done: 1, left: 2 });
    expect(find(r, 'Free Electives')).toMatchObject({ done: 0, left: 6 });
  });

  it('with nothing done, the track blocks stand in for the dropped group and the programme total is unchanged', () => {
    const E = gen('E', 8);
    const views = scis('degree', 'K1', E, 2);
    const r = deriveBlocks(views, IN, []);
    const all = [...r.open, ...r.finished];
    expect(all.filter((b) => b.viewId === 'trk').map((b) => b.left)).toEqual([1, 3]);
    expect(all.filter((b) => b.viewKind === 'track').every((b) => !b.overlap)).toBe(true);
    expect(all.reduce((a, b) => a + (b.need ?? 0), 0)).toBe(18);
    const plain = deriveBlocks([views[0]], IN, []);
    expect(plain.open.reduce((a, b) => a + (b.need ?? 0), 0)).toBe(18);
  });

  it('C (BBM): a track without a stated total keeps every base group and only shows its own overlay', () => {
    const F = gen('FNCE', 12);
    const major = loaded('major', view('fin', [
      group('core', { name: 'Finance Core', cus: 3, members: codes('FNCE101', 'FNCE102', 'FNCE103') }),
      group('elec', { name: 'Finance Electives', cus: 3, members: codes(...F) }),
    ], { totalCus: 6 }));
    const degree = loaded('degree', view('bbm', [group('free', { name: 'Free Electives', type: 'free_elective', cus: 7 })], { totalCus: 7 }));
    const banking = loaded('track', view('bank', [
      group('req', { name: 'Track required courses', cus: null, minCourses: 3, members: codes('FNCE221', 'FNCE225', 'FNCE230') }),
    ], { totalCus: null as unknown as number }));
    const out = applyTracks([degree, major, banking], IN);
    expect(out[1].view.groups.map((g) => g.id)).toEqual(['core', 'elec']);
    expect(out[2].view.groups[0].role).toBe('overlay');
    const r = deriveBlocks([degree, major, banking], IN, ['FNCE221', 'FNCE225']);
    // the courses still count for the major's list (here they are in it) and for the track, not for free electives
    const withList = deriveBlocks([degree, loaded('major', view('fin', [
      group('elec', { name: 'Finance Electives', cus: 3, members: codes('FNCE221', 'FNCE225', ...F) }),
    ], { totalCus: 3 })), banking], IN, ['FNCE221', 'FNCE225']);
    expect(find(withList, 'Finance Electives')).toMatchObject({ done: 2, left: 1 });
    expect(find(withList, 'Track required courses')).toMatchObject({ done: 2, left: 1, overlap: true });
    expect(find(withList, 'Free Electives')).toMatchObject({ done: 0, left: 7 });
    // not in the major's list: they fall to free electives as usual, and the track still shows them
    expect(find(r, 'Track required courses')).toMatchObject({ done: 2, left: 1 });
    expect(find(r, 'Free Electives')).toMatchObject({ done: 2, left: 5 });
  });
});
