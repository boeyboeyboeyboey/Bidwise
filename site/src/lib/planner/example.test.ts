import { describe, expect, it } from 'vitest';
import { EXAMPLE_BUDGET_CENTS, pickExampleCourses, type ExampleCandidate } from './example';

const c = (code: string, seats: number, bidEs: number): ExampleCandidate => ({ code, seats, bidCents: bidEs * 100 });

describe('pickExampleCourses', () => {
  it('takes the first three courses when they have the seats and fit the budget', () => {
    const list = [c('A', 8, 40), c('B', 6, 30), c('C', 5, 20), c('D', 9, 10)];
    expect(pickExampleCourses(list)).toEqual(['A', 'B', 'C']);
  });

  it('skips sections under the seat floor while a roomier choice exists', () => {
    const list = [c('A', 1, 10), c('B', 4, 10), c('C', 5, 10), c('D', 7, 10), c('E', 5, 10)];
    expect(pickExampleCourses(list)).toEqual(['C', 'D', 'E']);
  });

  it('keeps the total within e$125 (exactly e$125 is fine)', () => {
    expect(pickExampleCourses([c('A', 9, 50), c('B', 9, 40), c('C', 9, 35)])).toEqual(['A', 'B', 'C']);
    expect(pickExampleCourses([c('A', 9, 50), c('B', 9, 40), c('C', 9, 36)])).toEqual([]);
  });

  it('passes over a course that would break the budget and keeps the contested order otherwise', () => {
    const list = [c('A', 9, 60), c('B', 9, 70), c('C', 9, 30), c('D', 9, 30), c('E', 9, 5)];
    // A + B is over; A + C + D = 120 is the earliest fitting triple.
    expect(pickExampleCourses(list)).toEqual(['A', 'C', 'D']);
  });

  it('backs off an early pick when the later courses need the room', () => {
    const list = [c('A', 9, 100), c('B', 9, 20), c('C', 9, 20), c('D', 9, 20)];
    expect(pickExampleCourses(list)).toEqual(['B', 'C', 'D']);
  });

  it('uses each course once even when several of its sections are listed', () => {
    const list = [c('A', 9, 10), c('A', 9, 10), c('B', 9, 10), c('B', 9, 10)];
    expect(pickExampleCourses(list)).toEqual([]);
    expect(pickExampleCourses([...list, c('C', 9, 10)])).toEqual(['A', 'B', 'C']);
  });

  it('relaxes the seat floor from 5 to 3, then to 2, only when needed', () => {
    expect(pickExampleCourses([c('A', 5, 10), c('B', 5, 10), c('C', 3, 10), c('D', 3, 10)])).toEqual(['A', 'B', 'C']);
    expect(pickExampleCourses([c('A', 5, 10), c('B', 3, 10), c('C', 2, 10), c('D', 3, 10)])).toEqual(['A', 'B', 'D']);
    expect(pickExampleCourses([c('A', 5, 10), c('B', 2, 10), c('C', 2, 10), c('D', 1, 10)])).toEqual(['A', 'B', 'C']);
  });

  it('applies the budget at every floor: a floor that finds three courses over budget does not stop the search', () => {
    const list = [c('A', 6, 70), c('B', 6, 70), c('C', 6, 70), c('D', 2, 5), c('E', 2, 5)];
    // Floor 5 has three courses but e$210; floor 3 has too few; floor 2 gives A, D, E = e$80.
    expect(pickExampleCourses(list)).toEqual(['A', 'D', 'E']);
  });

  it('returns nothing (the button is hidden) when no floor gives three courses', () => {
    expect(pickExampleCourses([c('A', 1, 10), c('B', 1, 10), c('C', 1, 10)])).toEqual([]);
    expect(pickExampleCourses([c('A', 9, 10), c('B', 9, 10)])).toEqual([]);
    expect(pickExampleCourses([])).toEqual([]);
  });

  it('defaults to the standard e$125 balance', () => {
    expect(EXAMPLE_BUDGET_CENTS).toBe(12500);
    expect(pickExampleCourses([c('A', 9, 10), c('B', 9, 10), c('C', 9, 10)], 2900)).toEqual([]);
  });
});
