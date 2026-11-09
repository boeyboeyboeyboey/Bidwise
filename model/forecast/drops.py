"""Drop chance: how likely a section that is full now gets a seat back in a later window of the same term.

Only collected BOSS results are used (no user-submitted data). A "case" is one class in one term that was full in the
current window w.  While w is open, "full" means it started full (before_process_vacancy == 0: bids only use seats when
the window is processed, so the seats a student sees are the window's before_process_vacancy).  Between windows it means
the previous window ended full (after_process_vacancy == 0).  The two behave very differently (for Round 1B Window 1,
a seat is offered again in Round 1B Window 2 for 15% of the first group and 40% of those that sold out during the window),
so they are never mixed.  The seat "opens" by window k if any observed window after w and up to k offered
seats again (before_process_vacancy > 0): a dropped seat reappears and can be taken in the same window, so it counts
from the first window that offers it.  Cases are taken per current window w, so only classes that were full in exactly that window count.

Pooling.  The raw rate of a course is noisy (a few sections, a few terms), so it is shrunk toward its parent:
    p_course  = (x_c + K * p_subject) / (n_c + K)
    p_subject = (x_s + K * p_all)     / (n_s + K)
with K = 5 pseudo-cases (the same n / (n + K) form as fit.pool_weight).  A course with no cases gets its subject's
rate; K = 5 means a course needs about five of its own cases before its own record counts as much as its subject's.
Cumulative values are then made non-decreasing across later windows.

The sample size reported is the case count of the narrowest level that has at least MIN_OWN cases (course, then
subject, then all).  It is a count of (class, term) cases, not of independent events: sections of one course in one
term are correlated.
"""
from __future__ import annotations

import re
from collections import defaultdict

KAPPA = 5.0
MIN_OWN = 5


def subject_of(code: str) -> str:
    return re.sub(r"\d.*$", "", code)


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def collect_counts(rows, window_order: list[str], base: str, targets: list[str], skip_term: str | None = None,
                   full_at: str = "before"):
    """Count cases full in `base` (full_at "before": started full; "after": ended full) and whether a seat was offered again by each target window.

    rows: dicts with term, window, class_number, course_code, before_process_vacancy, after_process_vacancy.
    window_order: every window label in the order BOSS runs them within a term.
    Returns {k: {("g",): [n, x], ("s", subject): [n, x], ("c", course): [n, x]}} for each target k.
    """
    rank = {w: i for i, w in enumerate(window_order)}
    if base not in rank:
        return {}
    series: dict[tuple, dict[int, tuple[int, int]]] = defaultdict(dict)
    owner: dict[tuple, str] = {}
    for r in rows:
        w = r["window"]
        if w not in rank or r["term"] == skip_term:
            continue
        before, after = _int(r["before_process_vacancy"]), _int(r["after_process_vacancy"])
        if before is None or after is None:
            continue
        key = (r["term"], r["class_number"])
        series[key][rank[w]] = (before, after)
        owner[key] = r["course_code"]
    rb = rank[base]
    col = 0 if full_at == "before" else 1
    out: dict[str, dict[tuple, list[int]]] = {k: defaultdict(lambda: [0, 0]) for k in targets if k in rank and rank[k] > rb}
    for key, s in series.items():
        at = s.get(rb)
        if at is None or at[col] != 0:
            continue
        course = owner[key]
        for k, bucket in out.items():
            rk = rank[k]
            opened = any(b > 0 for i, (b, _) in s.items() if rb < i <= rk)
            if not opened and rk not in s:
                continue  # never saw the target window and no seat before it: unknown, not a "no"
            for lv in (("g",), ("s", subject_of(course)), ("c", course)):
                cell = bucket[lv]
                cell[0] += 1
                cell[1] += opened
    return out


def estimate(bucket: dict, course: str, kappa: float = KAPPA, min_own: int = MIN_OWN):
    """(p, n, level) for one course and one target window from the counts, or None when there are no cases at all."""
    ng, xg = bucket.get(("g",), (0, 0))
    if ng == 0:
        return None
    pg = xg / ng
    sub = subject_of(course)
    ns, xs = bucket.get(("s", sub), (0, 0))
    nc, xc = bucket.get(("c", course), (0, 0))
    ps = (xs + kappa * pg) / (ns + kappa)
    pc = (xc + kappa * ps) / (nc + kappa)
    if nc >= min_own:
        return pc, nc, "c"
    if ns >= min_own:
        return pc, ns, "s"
    return pc, ng, "g"


def drop_chances(rows, courses, window_order: list[str], base: str, targets: list[str], skip_term: str | None = None,
                 kappa: float = KAPPA, full_at: str = "before") -> dict:
    """{course: [{"w": window, "p": cumulative chance 0..1 (3 dp), "n": cases, "l": "c"|"s"|"g"}, ...]} in target order.

    Cumulative chance by each target window for a section of that course that is full in `base` (see collect_counts).
    """
    counts = collect_counts(rows, window_order, base, targets, skip_term, full_at)
    out = {}
    for course in courses:
        steps, best = [], 0.0
        for k in targets:
            bucket = counts.get(k)
            e = estimate(bucket, course, kappa) if bucket is not None else None
            if e is None:
                continue
            best = max(best, e[0])
            steps.append({"w": k, "p": round(best, 3), "n": e[1], "l": e[2]})
        if steps:
            out[course] = steps
    return out
