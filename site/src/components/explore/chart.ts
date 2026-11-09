export interface Theme {
  text: string; muted: string; border: string; surface: string; font: string;
}

const WIN_SHORT = (w: string) =>
  w.replace('Incoming Exchange Rnd', 'IE').replace('Incoming Freshmen Rnd', 'IF').replace('Round ', 'R').replace(/ Win(?:dow)? /, ' W');

/** Short axis label: "2025-26 Term 2" becomes "25/26 T2"; "2025-26 Term 2 · Round 1A Window 2" becomes "25/26 T2 · R1A W2". Other labels are unchanged. */
export function shortLabel(x: string): string {
  const [term, win] = x.split(' · ');
  const m = /^\d{2}(\d{2})-(\d{2}) Term (\w+)$/.exec(term);
  if (!m) return x;
  const t = `${m[1]}/${m[2]} T${m[3]}`;
  return win ? `${t} · ${WIN_SHORT(win)}` : t;
}
