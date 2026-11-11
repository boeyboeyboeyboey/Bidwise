import type { GradIndex, IndexDegree, IndexTrack, PickedView, PickResult, Selection, ViewKind } from './types';

/** The degree entry of the index, or null. */
export function findDegree(index: GradIndex, degreeId: string): IndexDegree | null {
  for (const s of index.schools) {
    const d = s.degrees.find((x) => x.id === degreeId);
    if (d) return d;
  }
  return null;
}

/**
 * The view ids a selection needs: the degree view, then the major, the track and the second major for the intake.
 * A part with no view for that intake is listed in `missing` and skipped. A second major with variants: the chosen
 * variant, else the entries without a variant; several left with nothing to tell them apart are all returned
 * and `ambiguousSecond` is set.
 */
export function pickViews(index: GradIndex, sel: Selection): PickResult {
  const views: PickedView[] = [];
  const missing: ViewKind[] = [];
  let ambiguousSecond = false;
  const degree = findDegree(index, sel.degree);
  if (!degree) return { ids: [], views, missing: ['degree'], ambiguousSecond };

  const dv = degree.views[sel.intake];
  if (dv) views.push({ kind: 'degree', id: dv });
  else missing.push('degree');

  const major = sel.major ? degree.majors?.find((m) => m.id === sel.major) : undefined;
  if (sel.major) {
    const mv = major?.views[sel.intake];
    if (mv) views.push({ kind: 'major', id: mv });
    else missing.push('major');
  }

  if (sel.track) {
    const pool: IndexTrack[] = [...(major?.tracks ?? []), ...(degree.tracks ?? [])];
    const tv = pool.find((t) => t.id === sel.track)?.views[sel.intake];
    if (tv) views.push({ kind: 'track', id: tv });
    else missing.push('track');
  }

  if (sel.secondMajor) {
    const entries = degree.secondMajors?.find((m) => m.id === sel.secondMajor)?.views[sel.intake] ?? [];
    let chosen = entries;
    if (sel.secondView) {
      chosen = entries.filter((e) => e.id === sel.secondView);
    } else if (sel.secondVariant) {
      const hit = entries.filter((e) => e.variant === sel.secondVariant);
      chosen = hit.length ? hit : entries.filter((e) => !e.variant);
    } else if (entries.some((e) => !e.variant)) {
      chosen = entries.filter((e) => !e.variant);
    }
    if (!chosen.length) missing.push('second');
    for (const e of chosen) views.push({ kind: 'second', id: e.id, ...(e.variant ? { variant: e.variant } : {}) });
    if (chosen.length > 1) ambiguousSecond = true;
  }

  return { ids: views.map((v) => v.id), views, missing, ambiguousSecond };
}
