// Picks the courses for the planner's "Try an example plan": a demo a student with the standard e$125 can actually afford.
// Pure (no DOM, no data loading); the page builds the candidates. Unit tested in example.test.ts.

/** A course as the planner would add it: the section its row starts on, with that row's suggested bid. */
export interface ExampleCandidate {
  code: string;
  /** Seats left on the section the planner picks for the course. */
  seats: number;
  /** The planner's suggested bid for that section at the default bid style, cents. */
  bidCents: number;
}

/** Courses in the example. */
export const EXAMPLE_SIZE = 3;
/** The balance every student gets per term, cents. */
export const EXAMPLE_BUDGET_CENTS = 12500;
/** Seats a section needs, tried in turn: a roomy section first, then fewer. */
export const EXAMPLE_SEAT_FLOORS = [5, 3, 2] as const;

/**
 * Three distinct courses whose suggested bids together fit the budget. `candidates` come most contested first and that
 * order wins: of all the fitting triples the one earliest in the list is chosen (compared course by course, not by total).
 * Each seat floor is tried only when the one before it found nothing. Empty when no floor works: the page then hides the button.
 */
export function pickExampleCourses(candidates: readonly ExampleCandidate[], budgetCents: number = EXAMPLE_BUDGET_CENTS): string[] {
  for (const floor of EXAMPLE_SEAT_FLOORS) {
    const seen = new Set<string>();
    const pool = candidates.filter((c) => c.seats >= floor && c.bidCents >= 0 && !seen.has(c.code) && seen.add(c.code));
    const found = firstFit(pool, 0, EXAMPLE_SIZE, budgetCents);
    if (found) return found.map((c) => c.code);
  }
  return [];
}

function firstFit(pool: readonly ExampleCandidate[], from: number, need: number, left: number): ExampleCandidate[] | null {
  if (need === 0) return [];
  for (let i = from; i <= pool.length - need; i++) {
    if (pool[i].bidCents > left) continue;
    const rest = firstFit(pool, i + 1, need - 1, left - pool[i].bidCents);
    if (rest) return [pool[i], ...rest];
  }
  return null;
}
