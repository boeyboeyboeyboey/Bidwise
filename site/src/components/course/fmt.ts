export const eS = (cents: number): string => `e$${(cents / 100).toFixed(2)}`;
/**
 * Percent for a chance, the one rule used everywhere (home lists and course page): the chance is first
 * rounded to 0.1% (home's build-time figures are stored that way, so a simulated 67.48% and a stored 0.675
 * both read 68%), then to a whole percent. Never "0%" or "100%" unless the chance is exactly 0 or 1.
 */
export const pct = (p: number): string => {
  const r = Math.round(Math.round(p * 1000) / 10);
  if (r <= 0 && p > 0) return '<1%';
  // Same display rule as the home lists (home/chance.ts).
  return r >= 100 && p < 1 ? '>99%' : `${r}%`;
};
/** Bid in e$, or a dash when nobody won in that window (never e$0). */
export const bidOrNone = (cents: number | null): string => (cents === null ? '—' : eS(cents));
/** "about 90%" for a chance; the edges read "over 99%" and "under 1%". */
export const aboutPct = (p: number): string => {
  const t = pct(p);
  if (t.startsWith('>')) return `over ${t.slice(1)}`;
  if (t.startsWith('<')) return `under ${t.slice(1)}`;
  return `about ${t}`;
};
/** aboutPct split into its lead word and the figure, so the figure can be set bold: ["about ", "90%"]. */
export const aboutPctParts = (p: number): [string, string] => {
  const t = aboutPct(p);
  const i = t.indexOf(' ');
  return [t.slice(0, i + 1), t.slice(i + 1)];
};
