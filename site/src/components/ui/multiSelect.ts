// Label of a multi-select button: "Any day", the chosen names when few, otherwise a count ("3 days").
export function multiLabel(chosen: readonly string[], anyLabel: string, noun: string, listMax = 2): string {
  if (!chosen.length) return anyLabel;
  return chosen.length <= listMax ? chosen.join(', ') : `${chosen.length} ${noun}`;
}
