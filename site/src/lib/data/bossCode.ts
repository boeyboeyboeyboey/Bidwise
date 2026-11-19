// Some BOSS courses are shown as two site courses (COR-STAT1202-X is Rosie Ching's SMU-X sections of COR-STAT1202).
// The site code keys pages and plans; the BOSS code is what BOSS, requirements and a student's CSV use.

/** Site codes that are a split of a real BOSS course, with the BOSS code each one stands for. Used when data predates `bossCode`. */
export const SPLIT_SUFFIXES: Readonly<Record<string, string>> = {
  'COR-STAT1202-X': 'COR-STAT1202',
};

/** The BOSS code for a site course code: the data's `bossCode` when present, else the known split suffix removed, else the code itself. */
export function bossCodeOf(code: string, bossCode?: string | null): string {
  return bossCode || SPLIT_SUFFIXES[code] || code;
}

/** Site codes that share this BOSS code, the regular course first (e.g. COR-STAT1202 -> [COR-STAT1202, COR-STAT1202-X]). */
export function splitFamily(code: string): string[] {
  const boss = bossCodeOf(code);
  return [boss, ...Object.entries(SPLIT_SUFFIXES).filter(([, b]) => b === boss).map(([site]) => site)];
}

/** The other site course of a split, or null when this course is not part of one. */
export function splitSibling(code: string): string | null {
  const fam = splitFamily(code);
  return fam.length > 1 ? (fam.find((c) => c !== code) ?? null) : null;
}

/** Completed courses as BOSS codes, each once, so marking COR-STAT1202-X cleared counts as COR-STAT1202 (requirements and prerequisites name BOSS codes). */
export function toBossCodes(codes: Iterable<string>): string[] {
  return [...new Set([...codes].map((c) => bossCodeOf(c)))];
}
