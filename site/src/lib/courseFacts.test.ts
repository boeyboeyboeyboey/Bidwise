import { describe, expect, it } from 'vitest';
import { courseDescription, courseFacts, courseDataset, DESCRIPTION_MAX } from './courseFacts';
import type { HistoryRow } from './data/types';

const row = (term: string, window: string, medianCents: number | null, minCents: number | null, after = 0): HistoryRow => ({
  term, window, section: 'G1', classNumber: '1', instructor: 'X', days: 'MON', start: '09:00', end: '12:00',
  medianCents, minCents, vacancy: 40, before: 0, after, enrolled: 40 - after,
});

describe('courseFacts', () => {
  it('has no facts when nobody won a seat', () => {
    expect(courseFacts([row('2025-26 Term 2', 'Round 1 Window 1', null, null)])).toBeNull();
    expect(courseFacts([])).toBeNull();
  });

  it('uses the latest term with bids in Round 1 Window 1, median of section medians and the lowest bid', () => {
    const f = courseFacts([
      row('2024-25 Term 2', 'Round 1 Window 1', 5000, 4000),
      row('2025-26 Term 2', 'Round 1 Window 1', 2000, 1500),
      row('2025-26 Term 2', 'Round 1 Window 1', 2200, 1800),
      row('2025-26 Term 2', 'Round 1 Window 1', 3000, 2500),
      row('2025-26 Term 2', 'Round 2 Window 1', 100, 100),
      row('2026-27 Term 2', 'Round 1 Window 1', null, null),
    ])!;
    expect(f).toMatchObject({ window: 'Round 1 Window 1', term: '2025-26 Term 2', medianCents: 2200, lowestCents: 1500 });
    expect(f.terms).toEqual(['2024-25 Term 2', '2025-26 Term 2']);
  });

  it('takes the lowest bid only from sections that filled', () => {
    const f = courseFacts([
      row('2025-26 Term 2', 'Round 1 Window 1', 2000, 1000, 5),
      row('2025-26 Term 2', 'Round 1 Window 1', 2200, 1800, 0),
      row('2025-26 Term 2', 'Round 1 Window 1', 3000, 2500, 0),
    ])!;
    expect(f.lowestCents).toBe(1800);
    expect(f.medianCents).toBe(2200);
  });

  it('has no lowest bid when no section filled', () => {
    const f = courseFacts([
      row('2025-26 Term 2', 'Round 1 Window 1', 2000, 1000, 5),
      row('2025-26 Term 2', 'Round 1 Window 1', 2200, 1800, 2),
    ])!;
    expect(f.lowestCents).toBeNull();
    expect(courseDescription('IS213', 'DB', f, 'history')).toBe('IS213 DB: past BOSS bids over 1 term; Round 1 Window 1, 2025-26 Term 2: median e$21.00.');
  });

  it('falls back to the earliest window with bids when Round 1 Window 1 has none', () => {
    const f = courseFacts([
      row('2025-26 Term 2', 'Round 2 Window 2', 900, 800),
      row('2024-25 Term 2', 'Round 1A Window 1', 1200, 1000),
      row('2025-26 Term 2', 'Round 1A Window 1', 1400, 1100),
    ])!;
    expect(f).toMatchObject({ window: 'Round 1A Window 1', term: '2025-26 Term 2', medianCents: 1400, lowestCents: 1100 });
  });
});

describe('courseDescription', () => {
  const facts = courseFacts([
    row('2024-25 Term 2', 'Round 1 Window 1', 2088, 1501),
    row('2025-26 Term 2', 'Round 1 Window 1', 2088, 1501),
  ])!;

  it('states the numbers', () => {
    expect(courseDescription('IS213', 'Database Management', facts, 'history')).toBe(
      'IS213 Database Management: past BOSS bids over 2 terms; Round 1 Window 1, 2025-26 Term 2: median e$20.88, lowest winning e$15.01.',
    );
  });

  it('adds the section count on the course page only', () => {
    expect(courseDescription('IS213', 'Database Management', facts, 'course', 11)).toMatch(/ 11 sections this term\.$/);
    expect(courseDescription('IS213', 'Database Management', facts, 'history', 11)).not.toMatch(/sections/);
  });

  it('drops the sections clause before cutting a title', () => {
    const d = courseDescription('IS213', 'Enterprise Solution Development', facts, 'course', 11);
    expect(d).toContain('Enterprise Solution Development:');
    expect(d).not.toContain('sections');
  });

  it('shortens a long title and stays within the limit', () => {
    const long = 'A'.repeat(120);
    const d = courseDescription('IS213', long, facts, 'course', 11);
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(d).toContain('…');
    expect(d).toContain('median e$20.88');
  });

  it('leaves out a lowest winning bid above the median', () => {
    const d = courseDescription('IS213', 'Database Management', { ...facts, lowestCents: 2500 }, 'history');
    expect(d).toMatch(/median e\$20\.88\.$/);
    expect(d).not.toContain('lowest');
  });

  it('falls back to the plain sentence without results', () => {
    expect(courseDescription('IS213', 'Database Management', null, 'course')).toBe(
      'IS213 Database Management: past BOSS bid results by window and a forecast of the bid each section needs.',
    );
    expect(courseDescription('IS213', 'Database Management', null, 'history')).toBe(
      'IS213 Database Management: past BOSS clearing bids for every window and term.',
    );
  });
});

describe('courseDataset', () => {
  it('names the course and no provider', () => {
    const f = courseFacts([row('2022-23 Term 2', 'Round 1 Window 1', 1, 1), row('2025-26 Term 2', 'Round 1 Window 1', 1, 1)])!;
    const d = courseDataset('IS213', 'DB', 'desc', 'https://x.test/course/IS213/', f, 'https://x.test/');
    expect(d.name).toBe('IS213 DB: past BOSS bid results');
    expect(d).not.toHaveProperty('provider');
  });
});
