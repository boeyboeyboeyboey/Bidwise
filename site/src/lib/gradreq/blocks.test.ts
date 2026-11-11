import { describe, expect, it } from 'vitest';
import { deriveBlocks } from './blocks';
import { codes, group, loaded, member, view } from './fixtures';

const INTAKE = 'AY2025/26';
const ids = (bs: { id: string }[]) => bs.map((b) => b.id);

describe('components and parents', () => {
  // Components come before their parent in the file, on purpose.
  const v = view('d', [
    group('A', { role: 'component', parent: 'P', members: codes('X1', 'X2') }),
    group('B', { role: 'component', parent: 'P', members: codes('Y1') }),
    group('intern', { role: 'component', parent: 'P', missingList: true, name: 'Internship' }),
    group('P', { cus: 3 }),
  ]);

  it('attaches by parent id, not by row order, and the parent is a heading, not a block', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['X1']);
    expect(ids(r.open)).toEqual(['B']);
    expect(ids(r.finished)).toEqual(['A']);
    expect(r.headings).toHaveLength(1);
    expect(r.headings[0]).toMatchObject({ id: 'P', cus: 3, counted: 1, cusLeft: 2, childIds: ['A', 'B', 'intern'] });
    expect(r.nonCourse.map((n) => n.id)).toEqual(['intern']);
    expect(r.open[0].headings).toEqual(['P']);
  });

  it('parent CUs left never goes below zero and nested parents add up', () => {
    const nested = view('n', [
      group('L1', { role: 'component', parent: 'V', members: codes('A1'), cus: 1 }),
      group('L2', { role: 'component', parent: 'V', members: codes('A2'), cus: 1 }),
      group('V', { role: 'component', parent: 'W', cus: 2 }),
      group('L3', { role: 'component', parent: 'W', members: codes('A3'), cus: 1 }),
      group('W', { cus: 3 }),
    ]);
    const r = deriveBlocks([loaded('degree', nested)], INTAKE, ['A1', 'A2', 'A3', 'A9']);
    const byId = Object.fromEntries(r.headings.map((h) => [h.id, h]));
    expect(byId.V).toMatchObject({ counted: 2, cusLeft: 0 });
    expect(byId.W).toMatchObject({ counted: 3, cusLeft: 0 });
    expect(r.open).toHaveLength(0);
  });
});

describe('placeholders', () => {
  const degree = view('deg', [
    group('core', { members: codes('C1'), cus: 1 }),
    group('major', { cus: 6, missingList: true }),
  ]);
  const major = view('maj', [group('mcore', { cus: 3, members: codes('M1', 'M2', 'M3') })]);

  it('is returned as needsSelection until a major or track view is selected, and is never a missing list', () => {
    const r = deriveBlocks([loaded('degree', degree)], INTAKE, []);
    expect(r.needsSelection.map((p) => p.id)).toEqual(['major']);
    expect(r.needsSelection[0]).toMatchObject({ cus: 6, needs: 'major-or-track' });
    expect(ids(r.open)).toEqual(['core']);
    expect(r.open.some((b) => b.listMissing)).toBe(false);
  });

  it('is hidden when a major view fills it', () => {
    const r = deriveBlocks([loaded('degree', degree), loaded('major', major)], INTAKE, []);
    expect(r.needsSelection).toEqual([]);
    expect(ids(r.open)).toEqual(['core', 'mcore']);
  });
});

describe('one course counts once in the programme, but may also count for an overlay', () => {
  const v = view('d', [
    group('A', { cus: 1, members: codes('C1', 'C2') }),
    group('B', { cus: 1, members: codes('C1', 'C3') }),
    group('O', { role: 'overlay', cus: 0, members: codes('C1') }),
  ]);

  it('gives a shared course to the first block when nothing else decides, the other block stays open', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['C1']);
    expect(ids(r.finished)).toEqual(['A', 'O']);
    expect(ids(r.open)).toEqual(['B']);
    expect(r.open[0].usedElsewhere).toEqual(['C1']);
    expect(r.finished.find((b) => b.id === 'O')?.overlap).toBe(true);
  });

  it('allocates the most constrained course first so both blocks can finish', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['C1', 'C3']);
    expect(r.finished.find((b) => b.id === 'A')?.doneCodes).toEqual(['C1']);
    expect(r.finished.find((b) => b.id === 'B')?.doneCodes).toEqual(['C3']);
    expect(r.open).toHaveLength(0);
  });

  it('puts a course in the block where it is mandatory', () => {
    const w = view('w', [
      group('opt', { cus: 1, members: codes('K', 'L') }),
      group('req', { cus: 1, members: [member('K', { mandatory: true }), member('M')] }),
    ]);
    const r = deriveBlocks([loaded('degree', w)], INTAKE, ['K']);
    expect(r.finished.map((b) => b.id)).toEqual(['req']);
    expect(r.open[0].id).toBe('opt');
  });

  it('a mandatory member not yet taken keeps the block open even when its CUs are met by others', () => {
    const w = view('w', [group('g', { cus: 2, members: [member('K', { mandatory: true }), member('L'), member('M')] })]);
    const r = deriveBlocks([loaded('degree', w)], INTAKE, ['L', 'M']);
    expect(r.open[0]).toMatchObject({ id: 'g', left: 1, mandatoryLeft: ['K'], complete: false });
  });
});

describe('free electives', () => {
  const v = view('d', [
    group('A', { cus: 1, members: codes('C1') }),
    group('free', { type: 'free_elective', cus: 3 }),
  ]);

  it('is filled by completed courses no block took, using their CUs (default 1), and clamps at its size', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['C1', 'Z1', 'Z2']);
    const free = r.open.find((b) => b.id === 'free');
    expect(free).toMatchObject({ kind: 'free', need: 3, done: 2, left: 1, doneCodes: ['Z1', 'Z2'] });
    const full = deriveBlocks([loaded('degree', v)], INTAKE, ['C1', 'Z1', 'Z2', 'Z3', 'Z4']);
    expect(full.finished.find((b) => b.id === 'free')).toMatchObject({ done: 3, left: 0 });
  });

  it('counts a leftover course at the CUs a list gives it', () => {
    const w = view('w', [
      group('A', { cus: 1, members: codes('C1') }),
      group('E', { role: 'overlay', cus: 0, members: [member('Z9', { cus: 2 })] }),
      group('free', { type: 'free_elective', cus: 2 }),
    ]);
    const r = deriveBlocks([loaded('degree', w)], INTAKE, ['C1', 'Z9']);
    expect(r.finished.find((b) => b.id === 'free')).toMatchObject({ done: 2 });
  });
});

describe('second majors', () => {
  const second = view('s', [
    group('p1', { role: 'overlay', cus: null, minCourses: 1, members: codes('F1', 'F2') }),
    group('p2', { role: 'overlay', cus: 0, minCourses: 2, members: codes('F3', 'F4', 'F5') }),
    group('core', { cus: 4, missingList: true }),
    group('note', { role: 'overlay', type: 'non_course', cus: null }),
  ], { homeDegree: 'x', totalCus: 4, minNotShared: 2 });

  it('treats overlay baskets as blocks that complete by minCourses when cus is blank or 0', () => {
    const r = deriveBlocks([loaded('second', second)], INTAKE, ['F1', 'F3']);
    expect(ids(r.finished)).toEqual(['p1']);
    expect(r.open[0]).toMatchObject({ id: 'p2', unit: 'course', need: 2, done: 1, left: 1, overlap: false });
    const done = deriveBlocks([loaded('second', second)], INTAKE, ['F1', 'F3', 'F4']);
    expect(done.open).toHaveLength(0);
  });

  it('hides the allocation placeholders once real lists exist and drops meta rows', () => {
    const r = deriveBlocks([loaded('second', second)], INTAKE, []);
    expect(r.needsSelection).toEqual([]);
    expect(r.nonCourse).toEqual([]);
    expect(r.ignored.map((i) => i.id)).toContain('note');
  });

  it('returns the placeholder when the second major publishes no list at all', () => {
    const bare = view('b', [group('core', { cus: 4, missingList: true })], { homeDegree: 'x', totalCus: 4, minNotShared: 1 });
    const r = deriveBlocks([loaded('second', bare)], INTAKE, []);
    expect(r.needsSelection[0]).toMatchObject({ id: 'core', needs: 'second-major-list' });
  });

  it('a course used by both the first major and the second major counts once in the second and is reported as shared', () => {
    const first = view('f', [group('A', { cus: 3, members: codes('S1', 'S2', 'S3') })]);
    const sec = view('s2', [group('q', { role: 'overlay', cus: null, minCourses: 3, members: codes('S1', 'S2', 'S3', 'S4') })],
      { homeDegree: 'x', totalCus: 4, minNotShared: 2 });
    const a = deriveBlocks([loaded('degree', first), loaded('second', sec)], INTAKE, ['S1', 'S2']);
    expect(a.secondMajors[0]).toMatchObject({ sharedCus: 2, notSharedCus: 0, maxNotShared: 2, minNotShared: 2, atRisk: false });
    const b = deriveBlocks([loaded('degree', first), loaded('second', sec)], INTAKE, ['S1', 'S2', 'S3']);
    expect(b.secondMajors[0]).toMatchObject({ sharedCus: 3, sharedCodes: ['S1', 'S2', 'S3'], maxNotShared: 1, atRisk: true });
    // advice only: the second-major block still shows as done, nothing is filtered out
    expect(ids(b.finished)).toContain('q');
  });

  it('courses only the second major uses are not shared', () => {
    const first = view('f', [group('A', { cus: 1, members: codes('S1') })]);
    const sec = view('s2', [group('q', { role: 'overlay', cus: null, minCourses: 2, members: codes('S1', 'S4') })],
      { homeDegree: 'x', totalCus: 4, minNotShared: 3 });
    const r = deriveBlocks([loaded('degree', first), loaded('second', sec)], INTAKE, ['S1', 'S4']);
    expect(r.secondMajors[0]).toMatchObject({ sharedCus: 1, notSharedCus: 1, maxNotShared: 3, atRisk: false });
  });
});

describe('alternative and non-course groups', () => {
  const v = view('d', [
    group('A', { cus: 1, members: codes('C1') }),
    group('alt', { role: 'alternative', cus: 6, members: codes('C2', 'C3') }),
    group('glob', { type: 'non_course', role: 'overlay', cus: 0 }),
    group('intern', { role: 'component', parent: 'P', missingList: true, name: 'Internship' }),
    group('svc', { type: 'non_course', role: 'component', parent: 'P', name: 'Community Service' }),
    group('P', { cus: 3, members: [] }),
  ]);

  it('never returns alternative groups as blocks and a course in one counts for nothing', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['C2']);
    expect(r.open.concat(r.finished).map((b) => b.id)).toEqual(['A']);
    expect(r.ignored).toContainEqual(expect.objectContaining({ id: 'alt', reason: 'alternative' }));
    expect(r.headings[0].counted).toBe(0);
  });

  it('lists non-course rows apart, including member-less components such as Internship', () => {
    const r = deriveBlocks([loaded('degree', v)], INTAKE, []);
    expect(r.nonCourse.map((n) => n.id).sort()).toEqual(['glob', 'intern', 'svc']);
    expect(r.open.some((b) => b.listMissing)).toBe(false);
  });
});

describe('choice sets', () => {
  it('pool sets (track or elective lists) let several members count', () => {
    const v = view('d', [group('G', { cus: 3, members: codes('A', 'B', 'C'), choiceSets: [{ id: 'track-x', members: [0, 1, 2] }] })]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['A', 'B']);
    expect(r.open.find((b) => b.id === 'G')).toMatchObject({ done: 2, left: 1 });
  });

  it('completing one member satisfies the set and the others stop being needed', () => {
    const v = view('d', [group('G', { cus: 1, minCourses: 1, members: codes('P', 'Q', 'R'), choiceSets: [{ id: 's', members: [0, 1] }] })]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['P']);
    expect(r.finished[0].choiceSets).toEqual([{ id: 's', codes: ['P', 'Q'], satisfiedBy: 'P' }]);
    const open = deriveBlocks([loaded('degree', v)], INTAKE, []);
    expect(open.open[0].members.every((m) => !m.setSatisfied)).toBe(true);
  });

  it('a set counts one course: the second member of a set adds nothing and falls to free electives', () => {
    const v = view('d', [
      group('G', { cus: 2, members: codes('A', 'B', 'C'), choiceSets: [{ id: 's', members: [0, 1] }] }),
      group('free', { type: 'free_elective', cus: 2 }),
    ]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['A', 'B']);
    const g = r.open.find((b) => b.id === 'G');
    expect(g).toMatchObject({ done: 1, left: 1, doneCodes: ['A'] });
    expect(g?.members.find((m) => m.code === 'B')).toMatchObject({ setSatisfied: true, done: false });
    expect(r.open.find((b) => b.id === 'free')).toMatchObject({ doneCodes: ['B'], done: 1 });
  });
});

describe('intakes', () => {
  it('drops members whose intakes exclude this one and keeps choice-set indices pointing at the right members', () => {
    const v = view('d', [group('G', {
      cus: 1,
      members: [member('OLD', { cls: 'tagged', intakes: ['AY2024/25'] }), member('P'), member('Q'), member('NEW', { cls: 'tagged', intakes: [INTAKE] })],
      choiceSets: [{ id: 's', members: [1, 2] }],
    })]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['OLD', 'P']);
    const g = r.finished[0];
    expect(g.members.map((m) => m.code)).toEqual(['P', 'Q', 'NEW']);
    expect(g.choiceSets[0]).toMatchObject({ codes: ['P', 'Q'], satisfiedBy: 'P' });
    const old = deriveBlocks([loaded('degree', v)], 'AY2024/25', ['OLD']);
    expect(old.finished[0].members.map((m) => m.code)).toEqual(['OLD', 'P', 'Q']);
  });

  it('skips a group whose own intakes exclude this one, with its components', () => {
    const v = view('d', [
      group('P', { cus: 2, intakes: ['AY2024/25'] }),
      group('c', { role: 'component', parent: 'P', members: codes('X') }),
      group('keep', { members: codes('Y') }),
    ]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, []);
    expect(ids(r.open)).toEqual(['keep']);
  });
});

describe('members without a plain code', () => {
  it('returns null-code members as unnamed titles, and hints never count but are reported as mayCount when completed', () => {
    const v = view('d', [group('G', {
      cus: 2,
      members: [member(null, { title: 'Find this on BOSS' }), member('A'), member('H', { cls: 'hint' }), member('T', { cls: 'tagged' })],
    })]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, ['H', 'T']);
    const g = r.open[0];
    expect(g.unnamed).toEqual(['Find this on BOSS']);
    expect(g.mayCount).toEqual(['H']);
    expect(g.hints.map((h) => h.code)).toEqual(['H']);
    expect(g).toMatchObject({ done: 1, left: 1, doneCodes: ['T'] });
    expect(g.members.map((m) => m.code)).toEqual(['A', 'T']);
  });

  it('flags a real leaf with no usable list and does not treat an unflagged empty overlay as a block', () => {
    const v = view('d', [
      group('dig', { role: 'overlay', cus: 0, missingList: true }),
      group('quiet', { role: 'overlay', cus: 0 }),
      group('elec', { role: 'component', parent: 'P', cus: 2, missingList: true, name: 'Computing Electives' }),
      group('P', { cus: 2 }),
    ]);
    const r = deriveBlocks([loaded('degree', v)], INTAKE, []);
    expect(r.open.filter((b) => b.listMissing).map((b) => b.id)).toEqual(['dig', 'elec']);
    expect(r.open.find((b) => b.id === 'elec')).toMatchObject({ left: 2 });
    expect(r.ignored).toContainEqual(expect.objectContaining({ id: 'quiet', reason: 'empty' }));
  });

  it('an overlay with no stated quantity is complete once any listed course is done, and has no CUs left', () => {
    const v = view('d', [group('o', { role: 'overlay', cus: null, members: codes('A', 'B') })]);
    expect(deriveBlocks([loaded('degree', v)], INTAKE, []).open[0]).toMatchObject({ need: null, left: null, complete: false });
    expect(deriveBlocks([loaded('degree', v)], INTAKE, ['B']).finished[0]).toMatchObject({ id: 'o', doneCodes: ['B'] });
  });
});
