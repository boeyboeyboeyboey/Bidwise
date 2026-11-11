import type { GradGroup, GradView, LoadedView } from './types';

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Does `candidate` restate the whole programme that `degree` describes? Some majors and tracks ship as a full programme
 * view (the same groups as the degree view) rather than only their own part. Full means the same total CUs, or a group
 * for every additive group of the degree.
 */
export function isFullProgramme(candidate: GradView, degree: GradView): boolean {
  if (candidate.totalCus > 0 && candidate.totalCus === degree.totalCus) return true;
  const additive = degree.groups.filter((g) => g.role === 'additive');
  if (!additive.length) return false;
  const names = new Set(candidate.groups.map((g) => norm(g.name)));
  return additive.every((g) => names.has(norm(g.name)));
}

/**
 * When a selected major or track view is a full programme view, it replaces the degree view; otherwise counting the
 * degree view as well would list every block twice. A partial major or track is kept beside the degree view.
 */
export function withoutCoveredDegree(views: readonly LoadedView[]): LoadedView[] {
  const degree = views.find((v) => v.kind === 'degree');
  if (!degree) return [...views];
  const covered = views.some((v) => (v.kind === 'major' || v.kind === 'track') && isFullProgramme(v.view, degree.view));
  return covered ? views.filter((v) => v !== degree) : [...views];
}

const inIntake = (x: { intakes?: readonly string[] }, intake: string): boolean => !x.intakes || x.intakes.includes(intake);

/** Course codes a group counts for the intake (hints are examples, so they are left out). */
function codesOf(g: GradGroup, intake: string): Set<string> {
  const out = new Set<string>();
  if (!inIntake(g, intake)) return out;
  for (const m of g.members) if (m.code && m.cls !== 'hint' && inIntake(m, intake)) out.add(m.code);
  return out;
}

/**
 * The base group that a track view restates: the additive or component group (not free electives) whose CUs equal the
 * track's total, in which at least half of the track's courses sit. With several, the best fit (overlap over union) wins,
 * so a long catch-all list beside it stays. Null when the track states no total (a track that only narrows a major,
 * as in BBM) or nothing matches.
 */
function restatedGroup(base: GradView, track: GradView, members: ReadonlySet<string>, intake: string): GradGroup | null {
  const total = track.totalCus ?? 0;
  if (!(total > 0)) return null;
  let best: GradGroup | null = null;
  let bestScore = 0;
  for (const g of base.groups) {
    if (g.role === 'overlay' || g.role === 'alternative' || g.type === 'free_elective' || g.type === 'non_course') continue;
    if ((g.cus ?? 0) !== total) continue;
    const c = codesOf(g, intake);
    if (!c.size) continue;
    let hit = 0;
    for (const code of members) if (c.has(code)) hit++;
    if (hit < members.size * 0.5) continue;
    const score = hit / (c.size + members.size - hit);
    if (score > bestScore) {
      best = g;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How a selected track fits the programme.
 * - It restates a base group (SCIS: "Track Courses" holds the same CUs): that group is dropped and the track's groups
 *   keep their roles in the programme pool in its place, so each course is allocated once (track blocks, being the
 *   smaller lists, before the long electives list, then free electives).
 * - It does not (BBM: the data does not say track courses sit inside the major): every base group stays and the track's
 *   groups become overlays, so a course counts for the major's blocks as normal and the track shows what is left of it.
 */
export function applyTracks(views: readonly LoadedView[], intake: string): LoadedView[] {
  const tracks = views.filter((v) => v.kind === 'track');
  if (!tracks.length) return [...views];
  const dropped = new Map<LoadedView, Set<string>>();
  const replacing = new Set<LoadedView>();
  for (const t of tracks) {
    const members = new Set<string>();
    for (const g of t.view.groups) for (const c of codesOf(g, intake)) members.add(c);
    if (!members.size) continue;
    for (const v of views) {
      if (v.kind !== 'degree' && v.kind !== 'major') continue;
      const g = restatedGroup(v.view, t.view, members, intake);
      if (g) {
        dropped.set(v, (dropped.get(v) ?? new Set()).add(g.id));
        replacing.add(t);
      }
    }
  }
  return views.map((v) => {
    if (v.kind === 'track') {
      if (replacing.has(v)) return v;
      return { ...v, view: { ...v.view, groups: v.view.groups.map((g) => (g.role === 'additive' || g.role === 'component' ? { ...g, role: 'overlay' as const } : g)) } };
    }
    const ids = dropped.get(v);
    return ids ? { ...v, view: { ...v.view, groups: v.view.groups.filter((g) => !ids.has(g.id)) } } : v;
  });
}
