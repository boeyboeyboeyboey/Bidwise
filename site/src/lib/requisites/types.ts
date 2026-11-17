// Shapes of src/data/real/gradreq/course-requisites.json (written by model/build_gradreq_data.py) and of the
// flat parts the renderer produces. Display trees only: the exporter has already resolved and flattened them.

export type Op = 'and' | 'or';

export type Node =
  | string
  | [Op, ...Node[]]
  | { t: 'grade'; min: string; of: Node }
  | { t: 'gpa'; kind: 'GPA' | 'Major GPA'; min: string }
  | { t: 'cus'; n: number }
  | { t: 'cusFrom'; n: number; of: string[] }
  | { t: 'cond'; text: string | null }
  | { t: 'unknown' };

export type Relation = 'pre' | 'co' | 'anti';

export interface CourseReq {
  /** 7-digit id of the course's page on courses.smu.edu.sg. */
  cat?: string;
  pre?: Node;
  co?: Node;
  anti?: Node;
  /** Relations whose catalogue wording is unclear. */
  unclear?: Relation[];
}

export interface RequisitesFile {
  /** ISO date the catalogue was read. */
  asOf: string;
  courses: Record<string, CourseReq>;
  /** Catalogue titles of the codes that appear in a tree. */
  names: Record<string, string>;
}

export type Part =
  | { k: 'text'; text: string; muted?: boolean }
  | { k: 'code'; code: string; href?: string; title?: string }
  | { k: 'link'; text: string; href: string }
  | { k: 'tip'; label: string; lines: string[]; href?: string; linkText?: string; showLabel?: boolean; lead?: string };

export type TipPart = Extract<Part, { k: 'tip' }>;

export interface Row {
  label: string;
  /** The "?" beside the label when the catalogue wording of this rule is unclear. */
  labelTip?: TipPart;
  parts: Part[];
  /** The whole row is secondary (the "None listed" row). */
  muted?: boolean;
}

export interface RenderCtx {
  /** Codes that have a /course/CODE/ page. */
  siteKeys: ReadonlySet<string>;
  names: Record<string, string>;
  /** The page's own catalogue id, for links to the SMU catalogue. */
  cat?: string;
  asOf: string;
}
