import type { CourseReq, Node, Part, RenderCtx, Relation, Row, TipPart } from './types';

const CATALOGUE = 'https://courses.smu.edu.sg/courses/';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Pos = 'top' | 'andItem' | 'orItem' | 'gradeOf';
interface Opts {
  /** Top-level "or" of codes joins with " · " (antirequisites). */
  dot: boolean;
}

const text = (t: string, muted = false): Part => (muted ? { k: 'text', text: t, muted: true } : { k: 'text', text: t });

/** Merges neighbouring text parts so the output is as short as the display. */
function tidy(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.k === 'text' && last && last.k === 'text' && !p.muted === !last.muted) out[out.length - 1] = { ...last, text: last.text + p.text };
    else out.push(p);
  }
  return out;
}

/** Joins items with a separator. A separator before a tip goes inside it (`lead`), so it never wraps away from it. */
function join(items: Part[][], sep: string): Part[] {
  const out: Part[] = [];
  items.forEach((it, i) => {
    if (i && it[0]?.k === 'tip') {
      if (/^\s/.test(sep)) out.push(text(' '));
      out.push({ ...it[0], lead: sep.trim() }, ...it.slice(1));
    } else {
      if (i) out.push(text(sep));
      out.push(...it);
    }
  });
  return out;
}

/** "A, B or C" */
function orList(items: Part[][]): Part[] {
  if (items.length === 1) return items[0];
  return [...join(items.slice(0, -1), ', '), ...join([[], items[items.length - 1]], ' or ')];
}

const paren = (parts: Part[]): Part[] => [text('('), ...parts, text(')')];

function catalogueUrl(cat: string | undefined): string | undefined {
  return cat ? `${CATALOGUE}${cat}` : undefined;
}

function codePart(code: string, ctx: RenderCtx): Part {
  const part: Part = { k: 'code', code };
  if (ctx.siteKeys.has(code)) part.href = `/course/${code}/`;
  const title = ctx.names[code];
  if (title) part.title = title;
  return part;
}

const UNKNOWN = 'another rule (not captured)';
const isUnknown = (n: Node): boolean => typeof n === 'object' && n !== null && !Array.isArray(n) && n.t === 'unknown';
const isCode = (n: Node): n is string => typeof n === 'string';
/** Unknown, or a grade on nothing readable. */
const isLost = (n: Node): boolean =>
  isUnknown(n) ||
  (typeof n === 'object' && n !== null && !Array.isArray(n) && n.t === 'grade' &&
    (isUnknown(n.of) || (Array.isArray(n.of) && n.of.slice(1).every(isLost))));
/** Reads as one item in an "A, B or C" list: anything but a group or a grade of a group. */
const isSimple = (n: Node): boolean =>
  !Array.isArray(n) && !(typeof n === 'object' && n !== null && n.t === 'grade' && !isCode(n.of));

const cus = (n: number) => (n === 1 ? '1 CU' : `${n} CUs`);

function renderIn(node: Node, pos: Pos, ctx: RenderCtx, o: Opts): Part[] {
  if (typeof node === 'string') return [codePart(node, ctx)];
  if (Array.isArray(node)) {
    const [op, ...all] = node;
    // Unreadable branches are said once, at the end, so they never read as a real alternative or requirement.
    const kids = all.filter((k) => !isLost(k));
    const lost = kids.length < all.length;
    if (kids.length === 0) return [text(UNKNOWN)];
    if (op === 'and') {
      const multi = kids.length + (lost ? 1 : 0) > 1;
      const items = kids.map((k) => renderIn(k, multi ? 'andItem' : pos, ctx, o));
      if (lost) items.push([text(UNKNOWN)]);
      if (items.length === 1) return items[0];
      const body = join(items, ' and ');
      return pos === 'top' || pos === 'orItem' ? body : paren(body);
    }
    if (op === 'or') {
      let body: Part[];
      if (kids.length === 1) body = renderIn(kids[0], pos, ctx, o);
      else if (kids.every(isSimple)) {
        const items = kids.map((k) => renderIn(k, 'orItem', ctx, o));
        if (pos === 'top' && o.dot && kids.every(isCode)) body = join(items, ' · ');
        else if (pos === 'top') body = kids.length <= 3 || !kids.every(isCode) ? orList(items) : [text('one of '), ...join(items, ', ')];
        else body = [text('one of ('), ...join(items, ', '), text(')')];
      } else {
        body = [text('one of: '), ...join(kids.map((k) => renderIn(k, 'orItem', ctx, o)), '; ')];
        if (pos !== 'top' && pos !== 'andItem') body = paren(body);
      }
      if (!lost) return body;
      return [...body, text(` or ${UNKNOWN}`)];
    }
    return [text(UNKNOWN)];
  }
  if (node && typeof node === 'object') {
    switch (node.t) {
      case 'grade': {
        const of = node.of;
        if (isLost(node)) return [text(UNKNOWN)];
        if (isCode(of)) return [codePart(of, ctx), text(` (${node.min} or better)`)];
        // A grade on a group says which codes it covers, so it never reads as a grade on the last code only.
        const codes = Array.isArray(of) && of.slice(1).every(isCode) ? (of.slice(1) as string[]).map((c) => [codePart(c, ctx)]) : null;
        let inner: Part[];
        if (codes && Array.isArray(of) && of[0] === 'or') inner = [text('one of ('), ...join(codes, ', '), text(')')];
        else if (codes && codes.length === 2) inner = [text('both '), ...join(codes, ' and ')];
        else if (codes) inner = [text('all of ('), ...join(codes, ', '), text(')')];
        else inner = paren(renderIn(of, 'gradeOf', ctx, o));
        return [...inner, text(` at ${node.min} or better`)];
      }
      case 'gpa':
        return [text(`${node.kind} ${node.min}+`)];
      case 'cus':
        return [text(`${node.n}+ ${node.n === 1 ? 'CU' : 'CUs'} completed`)];
      case 'cusFrom':
        return [text(`${cus(node.n)} from `), ...join(node.of.map((c) => [codePart(c, ctx)]), ', ')];
      case 'cond': {
        const tip: Part = {
          k: 'tip',
          label: 'Other condition',
          lines: [node.text ? node.text : ctx.cat ? "Details are on SMU's catalogue page." : "Details are in SMU's course catalogue."],
          showLabel: true,
        };
        const href = catalogueUrl(ctx.cat);
        if (href) {
          tip.href = href;
          tip.linkText = node.text ? 'SMU catalogue ↗' : 'Open SMU catalogue ↗';
        }
        return [tip];
      }
      case 'unknown':
        return [text(UNKNOWN)];
    }
  }
  return [text(UNKNOWN)];
}

/** Renders one relation's tree to parts (the rule only: no suffix, no "?" tip). */
export function renderNode(node: Node, ctx: RenderCtx, anti = false): Part[] {
  return tidy(renderIn(node, 'top', ctx, { dot: anti }));
}

/** A whole relation: the rule and, for corequisites, the "(before or same term)" note. */
export function renderRelation(rel: Relation, node: Node, ctx: RenderCtx): Part[] {
  if (isUnknown(node)) {
    const href = catalogueUrl(ctx.cat);
    return href ? [text('Not captured · '), { k: 'link', text: 'SMU catalogue ↗', href }] : [text('Not captured')];
  }
  const parts = renderNode(node, ctx, rel === 'anti');
  if (rel === 'co') parts.push(text(' (before or same term)', true));
  return tidy(parts);
}

/** The "?" beside the label of a rule whose catalogue wording is unclear (not for a wholly uncaptured one). */
function unclearTip(label: string, ctx: RenderCtx): TipPart {
  const tip: TipPart = { k: 'tip', label: `${label}: unclear rule`, lines: ["SMU's catalogue wording for this rule is unclear."] };
  const href = catalogueUrl(ctx.cat);
  if (href) {
    tip.href = href;
    tip.linkText = 'SMU catalogue';
  }
  return tip;
}

/** "2026-11-08" to "8 Nov 2026"; anything else is passed through. */
export function formatAsOf(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m || +m[2] < 1 || +m[2] > 12) return iso;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

const LABELS: [Relation, string][] = [['pre', 'Prerequisites'], ['co', 'Corequisites'], ['anti', 'Not with']];

/** The rows of one course's block; an empty list when the course has no entry (not in the catalogue). */
export function buildRows(entry: CourseReq | undefined, ctx: Omit<RenderCtx, 'cat'>): Row[] {
  if (!entry) return [];
  const c: RenderCtx = { ...ctx, cat: entry.cat };
  const rows: Row[] = [];
  for (const [rel, label] of LABELS) {
    const node = entry[rel];
    if (node === undefined) continue;
    const row: Row = { label, parts: renderRelation(rel, node, c) };
    if (entry.unclear?.includes(rel) && !isUnknown(node)) row.labelTip = unclearTip(label, c);
    rows.push(row);
  }
  if (rows.length) return rows;
  const tip: Part = {
    k: 'tip',
    label: 'About this',
    lines: [`None in SMU's public course catalogue as of ${formatAsOf(ctx.asOf)}. Restricted rules may be missing.`],
  };
  const href = catalogueUrl(entry.cat);
  if (href) {
    tip.href = href;
    tip.linkText = 'SMU catalogue';
  }
  return [{ label: 'Requisites', parts: [text('None listed'), tip], muted: true }];
}

/** Plain-text form of parts, for tests and logs: codes as is, tips as [label], links as their text. */
export function partsText(parts: Part[]): string {
  return parts
    .map((p) => (p.k === 'text' ? p.text : p.k === 'code' ? p.code : p.k === 'link' ? `<${p.text}>` : `${p.lead ? `${p.lead} ` : ''}[${p.label}]`))
    .join('');
}
