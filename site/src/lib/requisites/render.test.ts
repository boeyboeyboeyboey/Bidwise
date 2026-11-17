import { describe, expect, it } from 'vitest';
import { buildRows, formatAsOf, partsText, renderNode, renderRelation } from './render';
import type { CourseReq, Node, RenderCtx } from './types';

const ctx: RenderCtx = {
  siteKeys: new Set(['ACCT221', 'ACCT229', 'ACCT101', 'ECON102', 'FNCE101', 'MGMT001']),
  names: { ACCT221: 'Intermediate Financial Accounting', LAW201_621: 'Law variant' },
  cat: '0006021',
  asOf: '2026-11-08',
};
const text = (n: Node, anti = false) => partsText(renderNode(n, ctx, anti));
const grade = (min: string, of: Node): Node => ({ t: 'grade', min, of });
const gpa: Node = { t: 'gpa', kind: 'GPA', min: '3.40' };
const cond: Node = { t: 'cond', text: 'Eligibility is limited to SMU undergraduate students.' };

describe('renderNode', () => {
  it('writes a top-level or of 2-3 codes as "A or B" and 4+ as "one of"', () => {
    expect(text(['or', 'ACCT101', 'ECON102'])).toBe('ACCT101 or ECON102');
    expect(text(['or', 'ACCT101', 'ECON102', 'FNCE101'])).toBe('ACCT101, ECON102 or FNCE101');
    expect(text(['or', 'ACCT101', 'ECON102', 'FNCE101', 'MGMT001'])).toBe('one of ACCT101, ECON102, FNCE101, MGMT001');
  });

  it('brackets a nested "one of" so a chain of ands stays unambiguous (ACCT331-like)', () => {
    const t: Node = ['and', 'ACCT221', ['or', 'ACCT229', 'ACCT101', 'ECON102'], ['or', 'FNCE101', 'MGMT001'], cond];
    expect(text(t)).toBe('ACCT221 and one of (ACCT229, ACCT101, ECON102) and one of (FNCE101, MGMT001) and [Other condition]');
  });

  it('renders an ACCT429-like tree with "one of:" and a grade on each code of a group', () => {
    const t: Node = ['and', gpa, cond, ['or', grade('A-', ['and', 'ACCT221', 'ACCT229']), grade('A-', ['and', 'ACCT101', 'ECON102'])]];
    expect(text(t)).toBe(
      'GPA 3.40+ and [Other condition] and one of: both ACCT221 and ACCT229 at A- or better; both ACCT101 and ECON102 at A- or better',
    );
  });

  it('writes nested "or with a compound child" as "one of: X; Y" with plain "and" inside', () => {
    expect(text(['and', 'ACCT221', ['or', ['and', 'ACCT101', 'ECON102'], 'FNCE101']])).toBe('ACCT221 and one of: ACCT101 and ECON102; FNCE101');
  });

  it('puts a grade after its code, and names the group a grade covers', () => {
    expect(text(grade('B+', 'ACCT221'))).toBe('ACCT221 (B+ or better)');
    expect(text(['and', grade('B+', 'ACCT221'), 'ACCT229'])).toBe('ACCT221 (B+ or better) and ACCT229');
    expect(text(grade('A-', ['or', 'ACCT101', 'ECON102']))).toBe('one of (ACCT101, ECON102) at A- or better');
    expect(text(grade('B', ['and', 'ACCT101', 'ECON102', 'FNCE101']))).toBe('all of (ACCT101, ECON102, FNCE101) at B or better');
    expect(text(['and', 'FNCE101', grade('A-', ['and', 'ACCT101', 'ECON102'])])).toBe('FNCE101 and both ACCT101 and ECON102 at A- or better');
  });

  it('lists simple alternatives with a grade as "A, B or C (grade)" (ACCT221-like)', () => {
    expect(text(['or', 'ACCT101', 'ECON102', grade('A-', 'FNCE101')])).toBe('ACCT101, ECON102 or FNCE101 (A- or better)');
  });

  it('renders GPA, CUs and CUs-from', () => {
    expect(text({ t: 'gpa', kind: 'Major GPA', min: '3.00' })).toBe('Major GPA 3.00+');
    expect(text({ t: 'cus', n: 15 })).toBe('15+ CUs completed');
    expect(text({ t: 'cusFrom', n: 2, of: ['ACCT101', 'ECON102', 'FNCE101'] })).toBe('2 CUs from ACCT101, ECON102, FNCE101');
  });

  it('joins a top-level anti or with " · " whatever the count', () => {
    expect(text(['or', 'ACCT101', 'ECON102'], true)).toBe('ACCT101 · ECON102');
    expect(text(['or', 'ACCT101', 'ECON102', 'FNCE101', 'MGMT001'], true)).toBe('ACCT101 · ECON102 · FNCE101 · MGMT001');
    expect(text('ACCT101', true)).toBe('ACCT101');
  });

  it('links a code only when it is a site key, and keeps the title for either', () => {
    const [a, b] = renderNode(['and', 'ACCT221', 'LAW201_621'], ctx).filter((p) => p.k === 'code');
    expect(a).toEqual({ k: 'code', code: 'ACCT221', href: '/course/ACCT221/', title: 'Intermediate Financial Accounting' });
    expect(b).toEqual({ k: 'code', code: 'LAW201_621', title: 'Law variant' });
    const [c] = renderNode('ZZZZ999', ctx);
    expect(c).toEqual({ k: 'code', code: 'ZZZZ999' });
  });

  it('says an unreadable branch once, last, and never as a real alternative', () => {
    const unk: Node = { t: 'unknown' };
    expect(text(['and', 'ACCT221', unk])).toBe('ACCT221 and another rule (not captured)');
    expect(text(['and', unk, 'ACCT221', unk])).toBe('ACCT221 and another rule (not captured)');
    expect(text(['or', unk, 'ACCT221'], true)).toBe('ACCT221 or another rule (not captured)');
    expect(text(grade('A-', unk))).toBe('another rule (not captured)');
    expect(text(['or', grade('A-', unk), cond])).toBe('[Other condition] or another rule (not captured)');
    expect(text(['or', unk, unk])).toBe('another rule (not captured)');
  });

  it('keeps the separator before a tip inside it, so it cannot wrap away', () => {
    const parts = renderNode(['or', ['and', 'ACCT101', 'ECON102'], cond], ctx);
    expect(parts[parts.length - 1]).toMatchObject({ k: 'tip', lead: ';' });
    expect(partsText(parts)).toBe('one of: ACCT101 and ECON102; [Other condition]');
  });

  it('turns a condition into a visible tip carrying the catalogue sentence, with a fallback when the text is missing', () => {
    const [tip] = renderNode(cond, ctx);
    expect(tip).toMatchObject({ k: 'tip', label: 'Other condition', showLabel: true, lines: ['Eligibility is limited to SMU undergraduate students.'], href: 'https://courses.smu.edu.sg/courses/0006021' });
    const [none] = renderNode({ t: 'cond', text: null }, ctx);
    expect(none).toMatchObject({ lines: ["Details are on SMU's catalogue page."], linkText: 'Open SMU catalogue ↗' });
    const [noCat] = renderNode({ t: 'cond', text: null }, { ...ctx, cat: undefined });
    expect(noCat).toMatchObject({ lines: ["Details are in SMU's course catalogue."] });
    expect(noCat).not.toHaveProperty('href');
  });
});

describe('renderRelation', () => {
  it('shows a wholly unknown relation as "Not captured" with a catalogue link, or alone without a catalogue id', () => {
    const parts = renderRelation('pre', { t: 'unknown' }, ctx);
    expect(partsText(parts)).toBe('Not captured · <SMU catalogue ↗>');
    expect(parts[1]).toEqual({ k: 'link', text: 'SMU catalogue ↗', href: 'https://courses.smu.edu.sg/courses/0006021' });
    expect(partsText(renderRelation('pre', { t: 'unknown' }, { ...ctx, cat: undefined }))).toBe('Not captured');
  });

  it('marks a corequisite as before or same term, muted', () => {
    const parts = renderRelation('co', 'ACCT221', ctx);
    expect(partsText(parts)).toBe('ACCT221 (before or same term)');
    expect(parts[1]).toEqual({ k: 'text', text: ' (before or same term)', muted: true });
  });
});

describe('buildRows', () => {
  const base = { siteKeys: ctx.siteKeys, names: ctx.names, asOf: ctx.asOf };

  it('builds the rows in order with the exact labels', () => {
    const entry: CourseReq = { cat: '0006021', pre: 'ACCT221', co: 'ACCT229', anti: ['or', 'ACCT101', 'ECON102'] };
    const rows = buildRows(entry, base);
    expect(rows.map((r) => r.label)).toEqual(['Prerequisites', 'Corequisites', 'Not with']);
    expect(rows.map((r) => partsText(r.parts))).toEqual(['ACCT221', 'ACCT229 (before or same term)', 'ACCT101 · ECON102']);
    expect(rows.some((r) => r.labelTip)).toBe(false);
  });

  it('puts a "?" beside the label of an unclear rule, linking to the catalogue, but not on a wholly uncaptured one', () => {
    const rows = buildRows({ cat: '0006021', pre: { t: 'unknown' }, anti: ['or', 'ACCT101', 'ECON102'], unclear: ['pre', 'anti'] }, base);
    expect(rows[0].labelTip).toBeUndefined();
    expect(rows[1].labelTip).toEqual({
      k: 'tip',
      label: 'Not with: unclear rule',
      lines: ["SMU's catalogue wording for this rule is unclear."],
      href: 'https://courses.smu.edu.sg/courses/0006021',
      linkText: 'SMU catalogue',
    });
    expect(buildRows({ pre: 'ACCT221', unclear: ['pre'] }, base)[0].labelTip).not.toHaveProperty('href');
  });

  it('skips relations that are absent', () => {
    expect(buildRows({ cat: '1', anti: 'ACCT101' }, base).map((r) => r.label)).toEqual(['Not with']);
  });

  it('gives a catalogue course with no rules one muted "None listed" row with the dated tip', () => {
    const rows = buildRows({ cat: '0007051' }, base);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Requisites', muted: true });
    expect(partsText(rows[0].parts)).toBe('None listed[About this]');
    expect(rows[0].parts[1]).toMatchObject({ lines: ["None in SMU's public course catalogue as of 8 Nov 2026. Restricted rules may be missing."], href: 'https://courses.smu.edu.sg/courses/0007051' });
  });

  it('gives no block for a course that is not in the catalogue', () => {
    expect(buildRows(undefined, base)).toEqual([]);
  });
});

describe('formatAsOf', () => {
  it('uses an English month name', () => {
    expect(formatAsOf('2026-11-08')).toBe('8 Nov 2026');
    expect(formatAsOf('soon')).toBe('soon');
  });
});
