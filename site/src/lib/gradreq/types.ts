// Shapes of the generated graduation-requirement JSON (src/data/real/gradreq/, written by model/build_gradreq_data.py)
// and of what the "what should I take" logic returns. Pure types, no runtime code.

// ---------------------------------------------------------------- input data

/** Intake label as the data writes it, e.g. "AY2025/26". */
export type Intake = string;

export interface GradMember {
  /** Site key (courses.boss_code). Null for a rule member with no course code yet ("find this on BOSS"). */
  code: string | null;
  title: string;
  /** Null/absent = 1. */
  cus: number | null;
  /** rule: required or listed. tagged: counts (area tag). hint: example only, never fills the block. */
  cls: 'rule' | 'tagged' | 'hint';
  mandatory?: boolean;
  /** Tagged members only: the intakes it applies to. Absent = every intake of the view. */
  intakes?: Intake[];
  /** False when the code has no key on the site. */
  offeredKey?: boolean;
}

export type GroupRole = 'additive' | 'component' | 'overlay' | 'alternative';
export type GroupType = 'basket' | 'specific' | 'free_elective' | 'non_course';

export interface GradGroup {
  id: string;
  name: string;
  type: GroupType;
  role: GroupRole;
  cus: number | null;
  minCourses: number | null;
  /** Components only: id of the additive group they sit inside. */
  parent?: string;
  missingList: boolean;
  /** Intakes lacking a list, when only some are covered. */
  missingIntakes?: Intake[];
  /** Absent in today's data; honoured when present. */
  intakes?: Intake[];
  members: GradMember[];
  /** Indices into `members`: completing one member of a set satisfies the set. */
  choiceSets?: { id: string; members: number[] }[];
}

export interface GradView {
  id: string;
  label: string;
  intakeFrom: Intake;
  intakeTo: Intake;
  openEnded: boolean;
  totalCus: number | null;
  basis: 'stated' | 'inferred' | 'newer';
  groups: GradGroup[];
  /** Second-major views only. */
  homeDegree?: string;
  homeVariant?: string;
  /** Second-major views only: CUs that must not be shared with the first major. */
  minNotShared?: number;
}

export interface IndexViews {
  /** intake -> view id */
  views: Record<Intake, string>;
}
export interface IndexTrack extends IndexViews { id: string; name: string }
export interface IndexMajor extends IndexViews { id: string; name: string; tracks?: IndexTrack[] }
export interface IndexSecondMajor {
  id: string;
  name: string;
  school: string;
  /** intake -> one or more views (a second major can have variants or sibling programmes). */
  views: Record<Intake, { id: string; variant?: string }[]>;
}
export interface IndexDegree extends IndexViews {
  id: string;
  name: string;
  majors?: IndexMajor[];
  tracks?: IndexTrack[];
  secondMajors?: IndexSecondMajor[];
}
export interface GradIndex {
  generator?: string;
  intakes: Intake[];
  schools: { id: string; name: string; degrees: IndexDegree[] }[];
}

/** A bare course code, or ["and" | "or", ...subtrees]. */
export type ReqTree = string | readonly ReqTree[];
export interface Requisite {
  prereq?: ReqTree;
  antireq?: ReqTree;
  /** The parse may be incomplete: check the rule on BOSS. */
  uncertain?: boolean;
}
/** requisites.json: course key -> rule. A missing entry means no rule. */
export type Requisites = Record<string, Requisite>;

// ---------------------------------------------------------------- selection

export interface Selection {
  /** IndexDegree id. */
  degree: string;
  intake: Intake;
  major?: string;
  track?: string;
  secondMajor?: string;
  /** Picks among the views of a second major that has variants (e.g. "SMT"). */
  secondVariant?: string;
  /** Picks one view of a second major whose entries are sibling programmes (same variant, e.g. Global Asia or Sociology). Wins over `secondVariant`. */
  secondView?: string;
}

export type ViewKind = 'degree' | 'major' | 'track' | 'second';
export interface PickedView { kind: ViewKind; id: string; variant?: string }

export interface PickResult {
  /** View ids in order: degree, major, track, then second-major views. */
  ids: string[];
  views: PickedView[];
  /** Selected parts that have no view for this intake. */
  missing: ViewKind[];
  /** The second major matched several views and no variant told them apart: all are returned. */
  ambiguousSecond: boolean;
}

export interface LoadedView { kind: ViewKind; view: GradView }

// ---------------------------------------------------------------- blocks

export interface BlockMember {
  code: string;
  title: string;
  cus: number;
  cls: 'rule' | 'tagged';
  mandatory: boolean;
  /** Completed and counted in this block. */
  done: boolean;
  /** Another member of its choice set is done, so this one is not needed. */
  setSatisfied: boolean;
}

export interface HintMember { code: string; title: string; cus: number }

export interface ChoiceSetState {
  id: string;
  codes: string[];
  /** The completed member that satisfies the set, or null. */
  satisfiedBy: string | null;
}

export type BlockKind = 'list' | 'free';
export type BlockUnit = 'cu' | 'course';

export interface Block {
  id: string;
  viewId: string;
  viewKind: ViewKind;
  name: string;
  /** Names of the parent groups, outermost first. */
  headings: string[];
  kind: BlockKind;
  role: 'additive' | 'component' | 'overlay';
  /** Overlay blocks of a degree/major view can share courses with the additive blocks. Second-major blocks are allocated within their own view. */
  overlap: boolean;
  /** What `need`, `done` and `left` count. */
  unit: BlockUnit;
  /** Null: the data states no quantity (overlay without cus or minCourses). */
  need: number | null;
  done: number;
  /** Null when `need` is null. */
  left: number | null;
  minCourses: number | null;
  /** Needs no more courses and every mandatory member is done. An unquantified overlay is complete once any member is done. */
  complete: boolean;
  members: BlockMember[];
  /** Mandatory members not yet done. */
  mandatoryLeft: string[];
  /** Completed codes counted here. */
  doneCodes: string[];
  /** Completed codes that could count here but are used by another block. */
  usedElsewhere: string[];
  /** Rule members with no course code: titles to look up on BOSS. */
  unnamed: string[];
  /** Hint members (examples), never counted. */
  hints: HintMember[];
  /** Completed hint codes: they may count, check with the school. */
  mayCount: string[];
  choiceSets: ChoiceSetState[];
  /** The data holds no usable course list for this block. */
  listMissing: boolean;
}

export interface Heading {
  id: string;
  viewId: string;
  name: string;
  headings: string[];
  cus: number | null;
  /** CUs counted in the components below it. */
  counted: number;
  /** cus minus counted, never negative; null when cus is null. */
  cusLeft: number | null;
  childIds: string[];
}

export interface Placeholder {
  id: string;
  viewId: string;
  name: string;
  cus: number | null;
  /** Pick a major or track (degree view), or no second-major list is published. */
  needs: 'major-or-track' | 'second-major-list';
}

export interface NonCourseItem {
  id: string;
  viewId: string;
  name: string;
  headings: string[];
  cus: number | null;
}

export interface IgnoredGroup { id: string; viewId: string; name: string; reason: 'alternative' | 'meta' | 'empty' }

export interface SecondMajorState {
  viewId: string;
  name: string;
  totalCus: number | null;
  minNotShared: number | null;
  /** CUs of this second major's completed courses that also fill first-major blocks. */
  sharedCus: number;
  sharedCodes: string[];
  /** CUs of its completed courses not used by first-major blocks. */
  notSharedCus: number;
  /** Most CUs it can still end with that are not shared: totalCus minus sharedCus. */
  maxNotShared: number;
  /** maxNotShared can no longer reach minNotShared. Advice only, never a filter. */
  atRisk: boolean;
}

export interface DerivedBlocks {
  open: Block[];
  finished: Block[];
  headings: Heading[];
  needsSelection: Placeholder[];
  nonCourse: NonCourseItem[];
  secondMajors: SecondMajorState[];
  ignored: IgnoredGroup[];
}
