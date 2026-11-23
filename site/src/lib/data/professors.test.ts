import { describe, expect, it } from 'vitest';
import { assignSlugs, buildProfessors, isUnscheduledUnbid, profSlug, splitInstructors, type ProfCourseInput } from './professors';

describe('splitInstructors', () => {
  it('splits on comma between multi-word names', () => {
    expect(splitInstructors('ALEX CHENG, ERIC TIN, JANSEN AW')).toEqual(['ALEX CHENG', 'ERIC TIN', 'JANSEN AW']);
    expect(splitInstructors('LEE KOK THONG, TAN AH-MENG')).toEqual(['LEE KOK THONG', 'TAN AH-MENG']);
  });

  it('keeps one-word parts with the name next to them (SURNAME GIVEN, ENGLISHNAME)', () => {
    expect(splitInstructors('JARED POON JUN KEAT, CHAM YANWEI, DERRICK')).toEqual(['JARED POON JUN KEAT', 'CHAM YANWEI, DERRICK']);
    expect(splitInstructors('AURELIO GURREA MARTINEZ, LOH SONG-EN, SAMUEL')).toEqual(['AURELIO GURREA MARTINEZ', 'LOH SONG-EN, SAMUEL']);
    expect(splitInstructors('ONG, BENJAMIN JOSHUA, EUGENE TAN KHENG BOON')).toEqual(['ONG, BENJAMIN JOSHUA', 'EUGENE TAN KHENG BOON']);
    expect(splitInstructors('QUEK ANDERSON, DORCAS, ADRIANA BANOZIC')).toEqual(['QUEK ANDERSON, DORCAS', 'ADRIANA BANOZIC']);
    expect(splitInstructors('DAVID FERNANDEZ, JOANNE, SU YIN YOONG')).toEqual(['DAVID FERNANDEZ, JOANNE', 'SU YIN YOONG']);
  });

  it('keeps a one-word-only or initial-bearing surname pair as one name', () => {
    expect(splitInstructors('LEE, YUN')).toEqual(['LEE, YUN']);
    expect(splitInstructors('BAO, YANLIN')).toEqual(['BAO, YANLIN']);
    expect(splitInstructors('CALLAHAN, WILLIAM A.')).toEqual(['CALLAHAN, WILLIAM A.']);
    expect(splitInstructors('CHNG SHUQI, MUHAMMED AMEER S/O MOHAMED NOOR')).toEqual(['CHNG SHUQI', 'MUHAMMED AMEER S/O MOHAMED NOOR']);
    expect(splitInstructors('PRIYA D/O RAJ / JOHN TAN')).toEqual(['PRIYA D/O RAJ', 'JOHN TAN']);
  });

  it('splits on slash, ampersand, semicolon and the word and', () => {
    expect(splitInstructors('A B / C D')).toEqual(['A B', 'C D']);
    expect(splitInstructors('A B & C D')).toEqual(['A B', 'C D']);
    expect(splitInstructors('A B ; C D')).toEqual(['A B', 'C D']);
    expect(splitInstructors('A B and C D')).toEqual(['A B', 'C D']);
    expect(splitInstructors('A B AND C D')).toEqual(['A B', 'C D']);
  });

  it('keeps words that only contain "and"', () => {
    expect(splitInstructors('ANDREW LIM')).toEqual(['ANDREW LIM']);
  });

  it('trims, drops empties and de-duplicates by key', () => {
    expect(splitInstructors('  A B  ')).toEqual(['A B']);
    expect(splitInstructors('A B / A B')).toEqual(['A B']);
    expect(splitInstructors('LEE KOK-THONG / LEE KOK THONG')).toEqual(['LEE KOK-THONG']);
    expect(splitInstructors('/ ;')).toEqual([]);
    expect(splitInstructors('ALEX CHENG, ')).toEqual(['ALEX CHENG']);
  });

  it('returns nothing for null, undefined or empty input', () => {
    expect(splitInstructors(null)).toEqual([]);
    expect(splitInstructors(undefined)).toEqual([]);
    expect(splitInstructors('')).toEqual([]);
  });
});

describe('profSlug and assignSlugs', () => {
  it('lowercases and joins non-alphanumerics with a single dash', () => {
    expect(profSlug('LEE KOK-THONG')).toBe('lee-kok-thong');
    expect(profSlug(' -A  B- ')).toBe('a-b');
  });

  it('suffixes clashing slugs in sorted key order', () => {
    // Real keys are capitals and spaces only, so a clash needs keys that differ in case or punctuation.
    const slugs = assignSlugs(['lee kok', 'Lee Kok', 'LEE  KOK!', 'ALEX']);
    expect(slugs.get('LEE  KOK!')).toBe('lee-kok');
    expect(slugs.get('Lee Kok')).toBe('lee-kok-2');
    expect(slugs.get('lee kok')).toBe('lee-kok-3');
    expect(slugs.get('ALEX')).toBe('alex');
  });
});

const courses: ProfCourseInput[] = [
  {
    code: 'ACC1',
    title: 'Accounting',
    sectionsNow: [{ section: 'G1', classNumber: '1', meetings: [], instructor: 'ALEX CHENG, ERIC TIN, JANSEN AW' }],
    history: [
      { term: '2025-26 Term 1', window: 'Round 1 Window 1', instructor: 'ALEX CHENG', medianCents: 1000, minCents: 900 },
      { term: '2025-26 Term 1', window: 'Round 1 Window 2', instructor: 'ALEX CHENG', medianCents: null, minCents: null },
      { term: '2025-26 Term 1', window: 'Round 1 Window 3', instructor: 'ALEX CHENG', medianCents: null, minCents: null },
      { term: '2025-26 Term 2', window: 'Round 1 Window 2', instructor: 'ALEX CHENG / ERIC TIN', medianCents: 2000, minCents: 1800 },
      { term: '2025-26 Term 2', window: 'Round 1 Window 1', instructor: 'ALEX CHENG / ERIC TIN', medianCents: 1500, minCents: 1400 },
      { term: '2025-26 Term 2', window: 'Round 1 Window 3', instructor: '', medianCents: 500, minCents: null },
    ],
  },
  {
    code: 'STAT2',
    title: 'Statistics',
    sectionsNow: [],
    history: [
      { term: '2025-26 Term 2', window: 'Round 1 Window 1', instructor: 'ERIC TIN', medianCents: 3000, minCents: 2900 },
      { term: '2024-25 Term 1', window: 'Round 1 Window 1', instructor: 'ERIC TIN', medianCents: 800, minCents: 700 },
      { term: '2024-25 Term 1', window: 'Round 1 Window 1', instructor: 'LEE, YUN', medianCents: null, minCents: null },
    ],
  },
];

describe('buildProfessors', () => {
  const profs = buildProfessors(courses, '2026-27 Term 1');
  const bySlug = (slug: string) => profs.find((p) => p.slug === slug)!;

  it('credits every name on a team-taught row and sorts by name', () => {
    expect(profs.map((p) => p.name)).toEqual(['Alex Cheng', 'Eric Tin', 'Jansen Aw', 'Lee, Yun']);
    expect(bySlug('eric-tin').courses.map((c) => c.code)).toEqual(['ACC1', 'STAT2']);
  });

  it('picks the newest term with a median and the earliest window in it', () => {
    const alex = bySlug('alex-cheng').courses[0];
    expect(alex.latest).toEqual({ term: '2025-26 Term 2', window: 'Round 1 Window 1', medianCents: 1500, minCents: 1400 });
    expect(bySlug('eric-tin').courses[1].latest).toEqual({ term: '2025-26 Term 2', window: 'Round 1 Window 1', medianCents: 3000, minCents: 2900 });
  });

  it('gives null latest when no row has a median', () => {
    expect(bySlug('jansen-aw').courses[0].latest).toBeNull();
    expect(bySlug('lee-yun').courses[0].latest).toBeNull();
  });

  it('picks the most common raw instructor string for the history query', () => {
    expect(bySlug('alex-cheng').courses[0].historyQuery).toBe('ALEX CHENG');
    expect(bySlug('eric-tin').courses[0].historyQuery).toBe('ALEX CHENG / ERIC TIN');
    expect(bySlug('lee-yun').courses[0].historyQuery).toBe('LEE, YUN');
  });

  it('marks teaching-now professors and orders their courses first', () => {
    expect(bySlug('jansen-aw').teachingNow).toBe(true);
    expect(bySlug('lee-yun').teachingNow).toBe(false);
    const alex = bySlug('alex-cheng');
    expect(alex.courses[0].terms).toEqual(['2026-27 Term 1', '2025-26 Term 2', '2025-26 Term 1']);
    expect(alex.courses[0].nowSections.map((s) => s.section)).toEqual(['G1']);
    expect(alex.lastTerm).toBe('2026-27 Term 1');
    expect(bySlug('lee-yun').lastTerm).toBe('2024-25 Term 1');
  });
});

describe('buildProfessors latest bid', () => {
  const row = (term: string, window: string, medianCents: number | null) =>
    ({ term, window, instructor: 'MAY LIM', medianCents, minCents: medianCents });
  const build = (history: ReturnType<typeof row>[]) =>
    buildProfessors([{ code: 'X1', title: 'X', sectionsNow: [], history } as ProfCourseInput], '2026-27 Term 1')[0].courses[0].latest;

  it('skips Incoming Exchange/Freshmen rounds when a regular round has a price', () => {
    expect(build([
      row('2026-27 Term 1', 'Incoming Exchange Rnd 1C Win 1', 2000),
      row('2025-26 Term 2', 'Round 1 Window 1', 1200),
    ])?.window).toBe('Round 1 Window 1');
  });

  it('falls back to Incoming rounds when nothing else has a price', () => {
    expect(build([
      row('2026-27 Term 1', 'Incoming Freshmen Rnd 1 Win 1', 1100),
      row('2025-26 Term 2', 'Round 1 Window 1', null),
    ])?.window).toBe('Incoming Freshmen Rnd 1 Win 1');
  });
});

describe('buildProfessors pastTerms', () => {
  const r = (term: string, section: string, window: string, medianCents: number | null, minCents: number | null, extra: Record<string, string> = {}) =>
    ({ term, section, window, instructor: 'MAY LIM', medianCents, minCents, days: 'MON', start: '08:15', end: '11:30', ...extra });
  const build = (history: ReturnType<typeof r>[], code = 'X1') =>
    buildProfessors([{ code, title: 'X', sectionsNow: [], history } as ProfCourseInput], '2026-27 Term 1')[0].pastTerms;

  it('groups by term, newest first, one entry per course and section, and leaves out the current term', () => {
    const past = build([
      r('2024-25 Term 2', 'G1', 'Round 1 Window 1', 900, 800),
      r('2026-27 Term 1', 'G1', 'Round 1 Window 1', 1000, 900),
      r('2025-26 Term 1', 'G2', 'Round 1 Window 1', 1100, 1000),
      r('2025-26 Term 1', 'G1', 'Round 1 Window 1', 1200, 1000),
      r('2025-26 Term 1', 'G1', 'Round 1 Window 2', 1300, 1100),
      r('2025-26 Term 1', 'G10', 'Round 1 Window 1', null, null),
    ]);
    expect(past.map((t) => t.term)).toEqual(['2025-26 Term 1', '2024-25 Term 2']);
    expect(past[0].sections.map((s) => s.section)).toEqual(['G1', 'G2', 'G10']);
    expect(past[0].sections[0]).toMatchObject({ code: 'X1', days: 'MON', start: '08:15', end: '11:30', bid: { window: 'Round 1 Window 1', medianCents: 1200, minCents: 1000 } });
    expect(past[0].sections[2].bid).toBeNull();
  });

  it('takes the earliest regular window with a price and skips Incoming rounds', () => {
    const [t] = build([
      r('2025-26 Term 1', 'G1', 'Incoming Freshmen Rnd 1 Win 1', 500, 400),
      r('2025-26 Term 1', 'G1', 'Round 1 Window 1', null, null),
      r('2025-26 Term 1', 'G1', 'Round 1A Window 2', 1500, 1400),
      r('2025-26 Term 1', 'G1', 'Round 1B Window 1', 1600, 1500),
    ]);
    expect(t.sections[0].bid).toEqual({ window: 'Round 1A Window 2', medianCents: 1500, minCents: 1400 });
  });

  it('uses an Incoming window only when nothing else is priced', () => {
    const [t] = build([
      r('2025-26 Term 1', 'G1', 'Round 1 Window 1', null, null),
      r('2025-26 Term 1', 'G1', 'Incoming Exchange Rnd 1C Win 2', 700, 600),
      r('2025-26 Term 1', 'G1', 'Incoming Exchange Rnd 1C Win 1', 800, 650),
    ]);
    expect(t.sections[0].bid).toEqual({ window: 'Incoming Exchange Rnd 1C Win 1', medianCents: 800, minCents: 650 });
  });

  it('credits each professor named on a team-taught row, and a course keeps its own sections', () => {
    const profs = buildProfessors([
      { code: 'A1', title: 'A', sectionsNow: [], history: [r('2025-26 Term 1', 'G1', 'Round 1 Window 1', 1000, 900, { instructor: 'MAY LIM / BOB TAN' })] },
      { code: 'B1', title: 'B', sectionsNow: [], history: [r('2025-26 Term 1', 'G1', 'Round 1 Window 1', 2000, 1900)] },
    ] as ProfCourseInput[], '2026-27 Term 1');
    const may = profs.find((p) => p.name === 'May Lim')!;
    const bob = profs.find((p) => p.name === 'Bob Tan')!;
    expect(may.pastTerms[0].sections.map((s) => s.code)).toEqual(['A1', 'B1']);
    expect(bob.pastTerms[0].sections.map((s) => s.code)).toEqual(['A1']);
  });
});

describe('buildProfessors historyComplete', () => {
  const row = (instructor: string) => ({ term: '2025-26 Term 1', window: 'Round 1 Window 1', instructor, medianCents: 1000, minCents: 900 });
  const course = (history: ReturnType<typeof row>[], sectionInstructor?: string) =>
    ({ code: 'X1', title: 'X', sectionsNow: sectionInstructor ? [{ section: 'G1', classNumber: '1', meetings: [], instructor: sectionInstructor }] : [], history } as ProfCourseInput);
  const may = (c: ProfCourseInput) => buildProfessors([c], '2026-27 Term 1').find((p) => p.name === 'May Lim')!.courses[0];

  it('is true when every row has the same instructor string, ignoring case and punctuation', () => {
    expect(may(course([row('MAY LIM'), row('May Lim')])).historyComplete).toBe(true);
    expect(may(course([row('MAY LIM')], 'MAY LIM')).historyComplete).toBe(true);
  });

  it('is false when the professor appears under different team strings', () => {
    expect(may(course([row('MAY LIM'), row('MAY LIM / BOB TAN')])).historyComplete).toBe(false);
    expect(may(course([row('MAY LIM')], 'MAY LIM / BOB TAN')).historyComplete).toBe(false);
  });
});

describe('unscheduled, unbid rows', () => {
  const row = (section: string, days: string, start: string, end: string, medianCents: number | null, instructor = 'TAN, A') =>
    ({ term: '2025-26 Term 1', window: 'Round 1 Window 1', instructor, medianCents, minCents: medianCents, section, days, start, end });

  it('flags only rows with no time and no bid', () => {
    expect(isUnscheduledUnbid(row('G1', 'TBA', 'TBA', 'TBA', null))).toBe(true);
    expect(isUnscheduledUnbid(row('G1', '', '', '', null))).toBe(true);
    expect(isUnscheduledUnbid(row('G1', 'TBA', 'TBA', 'TBA', 1500))).toBe(false);
    expect(isUnscheduledUnbid(row('G1', 'MON', '08:15', '11:30', null))).toBe(false);
    expect(isUnscheduledUnbid({ medianCents: null })).toBe(false);
  });

  it('leaves them out of courses taught and past terms, but keeps them for a professor with nothing else', () => {
    const profs = buildProfessors([
      { code: 'WS1', title: 'Work-study', sectionsNow: [], history: [row('G6', 'TBA', 'TBA', 'TBA', null, 'MOK, A'), row('G7', 'MON', '08:15', '11:30', null, 'LIM, B')] },
      { code: 'IS1', title: 'Programming', sectionsNow: [], history: [row('G1', 'TUE', '12:00', '15:15', 2000, 'MOK, A')] },
      { code: 'WS2', title: 'Other', sectionsNow: [], history: [row('G1', 'TBA', 'TBA', 'TBA', null, 'ONLY, C')] },
    ] as ProfCourseInput[], '2026-27 Term 2');
    const mok = profs.find((p) => p.name.startsWith('Mok'))!;
    expect(mok.courses.map((c) => c.code)).toEqual(['IS1']);
    expect(mok.pastTerms.flatMap((t) => t.sections.map((s) => s.code))).toEqual(['IS1']);
    expect(profs.find((p) => p.name.startsWith('Lim'))!.courses.map((c) => c.code)).toEqual(['WS1']);
    expect(profs.find((p) => p.name.startsWith('Only'))!.courses.map((c) => c.code)).toEqual(['WS2']);
  });
  it('on a team-taught hidden row, drops it for a professor with other rows and keeps it for one without', () => {
    const profs = buildProfessors([
      { code: 'WS1', title: 'Work-study', sectionsNow: [], history: [row('G1', 'TBA', 'TBA', 'TBA', null, 'TAN, ALICE / KOH, BEN')] },
      { code: 'IS1', title: 'Programming', sectionsNow: [], history: [row('G1', 'TUE', '12:00', '15:15', 2000, 'TAN, ALICE')] },
    ] as ProfCourseInput[], '2026-27 Term 2');
    expect(profs.find((p) => p.name.startsWith('Tan'))!.courses.map((c) => c.code)).toEqual(['IS1']);
    expect(profs.find((p) => p.name.startsWith('Koh'))!.courses.map((c) => c.code)).toEqual(['WS1']);
  });
});

