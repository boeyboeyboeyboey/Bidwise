import type { ReqTree, Requisites } from './types';

export type Eligibility = 'ok' | 'blocked' | 'check';

/** Is a requisite tree satisfied by the completed courses? A bare code, or ["and"|"or", ...]. Empty "and" holds, empty "or" does not. */
export function treeMet(tree: ReqTree, completed: ReadonlySet<string>): boolean {
  if (typeof tree === 'string') return completed.has(tree);
  if (!Array.isArray(tree) || tree.length === 0) return false;
  const [op, ...rest] = tree;
  if (typeof op !== 'string') return false;
  if (op === 'and') return rest.every((t) => treeMet(t, completed));
  if (op === 'or') return rest.some((t) => treeMet(t, completed));
  return false;
}

/**
 * blocked: the parsed prerequisite tree is not met, or the parsed antirequisite tree is met.
 * check: not blocked, has a parsed tree, but the rule is flagged uncertain (the parse may be incomplete).
 * ok: no entry, or no problem found. A prerequisite tree that is unmet stays blocked even when flagged uncertain.
 */
export function eligibility(code: string, completedCourses: Iterable<string>, requisites: Requisites): Eligibility {
  const r = requisites[code];
  if (!r) return 'ok';
  const completed = completedCourses instanceof Set ? (completedCourses as ReadonlySet<string>) : new Set(completedCourses);
  if (r.antireq !== undefined && treeMet(r.antireq, completed)) return 'blocked';
  if (r.prereq !== undefined && !treeMet(r.prereq, completed)) return 'blocked';
  // An uncertain flag with no parsed tree at all says nothing about this course, so it is not worth a warning.
  return r.uncertain && (r.prereq !== undefined || r.antireq !== undefined) ? 'check' : 'ok';
}
