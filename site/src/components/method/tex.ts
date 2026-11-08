// Build-time maths: formulas become static HTML in the page, so no maths code ships to the browser.
// Text blocks mark inline maths as @[ ... ]@ and display maths as @@[ ... ]@@ (e$ amounts stay literal).
import katex from 'katex';

export function tex(src: string, display = false): string {
  return katex.renderToString(src, { displayMode: display, throwOnError: true, strict: 'error' });
}

const MATH = /@@\[([\s\S]+?)\]@@|@\[([\s\S]+?)\]@/g;

/** Trusted, hand-written text with embedded maths; returns HTML. */
export function rich(text: string): string {
  return text.replace(MATH, (_m, d: string | undefined, i: string | undefined) => (d !== undefined ? tex(d, true) : tex(i as string)));
}
