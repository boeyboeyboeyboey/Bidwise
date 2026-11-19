"""Distribution calibration of the bid forecaster: a fill classifier and spread exponents.

Two learned pieces change what the simulator reports (the price level stays as correction.py sets it):

* fill probability: a gradient-boosted classifier (same features and hyperparameters as the price regressor, seeds 0/1/2
  averaged, trained on all sections with seats > 0 of terms strictly before the target term) replaces the simulator's
  share of replays that filled ("variant A" of the lab). It feeds `SimParams.fillProb`.
* spread: the conditional clearing bid (filled replays) is stretched or squeezed around its median, c' = max(floor,
  m * (c / m) ** s), with s = spreadHi above the median and spreadLo below. The exponents are learned per cell (forecast band
  of the conditional median x one seat or several) by minimising pinball loss at u = 0.9 (cond p90) and u = 0.1 (cond p10)
  against the actual clearing bid of FILLED sections. The transform is monotone, so the transformed quantile is the
  transform of the quantile: learning needs only cond_p10/p50/p90, not the replays.

`backtest_distcal` judges the pair on a held-out term (exponents learned on the test term, as correction learns f on
earlier terms) and writes the figures and the bid levels the site can show. The levels (Cheap / Balanced / Safe) are picked
on both terms cross-fit (each term's rows scored with the exponents learned on the other term), pooled and per window
group, with an out-of-sample measured win rate per window group x forecast band x style. Nothing here is imported by the site build;
numpy, pandas and scikit-learn are optional exactly as in correction.py.

Everything is leak-free the same way correction is: the classifier of term T sees only terms before T plus earlier windows
of T (through the shared feature builder).
"""
from __future__ import annotations

import bisect
import json
import math
import os
import time
from dataclasses import replace

try:  # optional, like correction.py
    from sklearn.ensemble import HistGradientBoostingClassifier
except Exception:  # noqa: BLE001
    HistGradientBoostingClassifier = None  # type: ignore[assignment]

from . import correction as C
from . import fit

try:  # evalscore needs numpy, which is optional here like in correction.py
    from . import evalscore as S
except Exception:  # noqa: BLE001
    S = None  # type: ignore[assignment]

np, pd = C.np, C.pd
CorrectionError = C.CorrectionError

# 19 Nov 2026: nCourses / effCourses guard fields added beside measuredWin's upper (optional; same version)
DISTCAL_VERSION = "distcal-a2"  # classifier variant A + S4 spread cells + per-window-group bid levels
DISTCAL_FILE = "distcal.json"
# Payloads the site build still accepts: a1 differs only in having no per-window-group levels (the site then uses the pooled ones).
COMPATIBLE_VERSIONS = (DISTCAL_VERSION, "distcal-a1")

BAND_EDGES = (15, 25, 40, 60)  # e$ of the conditional median: <15, 15-25, 25-40, 40-60, 60+
N_BANDS = len(BAND_EDGES) + 1
MIN_CELL = 100  # filled rows needed for a cell (or a band) to keep its own pair
BOOT_N, BOOT_SEED, BOOT_Q = 1000, 20261119, 0.95  # course-cluster bootstrap behind measuredWin's `upper`
GRID_LO, GRID_HI, GRID_STEP = 0.30, 2.00, 0.05
S_GRID = [round(GRID_LO + i * GRID_STEP, 2) for i in range(int(round((GRID_HI - GRID_LO) / GRID_STEP)) + 1)]
QLEVELS = (0.5, 0.8, 0.9, 0.95)  # unconditional quantile levels of the pinball metric
LEVEL_GRID = [round(0.30 + 0.005 * i, 3) for i in range(140)]  # 0.300 .. 0.995 for the bid level table
CHEAP_LOSS, BALANCED_LOSS, SAFE_LOSS = 0.30, 0.15, 0.10  # max share of filled sections a style may lose (70 / 85 / 90% win)
STYLE_LOSS = {"cheap": CHEAP_LOSS, "balanced": BALANCED_LOSS, "safe": SAFE_LOSS}
STYLES = tuple(STYLE_LOSS)
GROUPS = ("R1W1", "R1A", "R1B", "R2", "R2A")  # window groups (evalscore.window_group) with their own levels
COVERAGE_RANGE = (0.75, 0.85)
CQ_U = np.arange(1, 100) / 100.0 if np is not None else None  # percentile of each cq grid column


def _clf(seed: int):
    return HistGradientBoostingClassifier(
        loss="log_loss", categorical_features=[C.FEATURES.index(c) for c in C.CATEGORICAL], early_stopping=True,
        n_iter_no_change=25, max_iter=800, validation_fraction=0.15, random_state=seed, **C.GBM_PARAMS)


# ----------------------------------------------------------------------------- fill classifier (lab variant A)
def train_predict_fill_multi(tables: dict, T: int, tgt_feats: list) -> list:
    """P(filled) for each frame in tgt_feats, from ONE training: classifier on ALL sections with seats > 0 of every table with
    tidx < T (tables only holds terms from correction.FIRST_TRAIN_TERM on), same features as the price regressor, mean of the
    correction.SEEDS models. Returns one array per frame, in order."""
    C.require_deps()
    if HistGradientBoostingClassifier is None:
        raise CorrectionError("scikit-learn unavailable")
    tr = pd.concat([t for k, t in sorted(tables.items()) if k < T], ignore_index=True)
    tr = tr[tr.seats > 0]
    if len(tr) < 200 or tr.filled.nunique() < 2:
        raise CorrectionError(f"too few training rows for the fill classifier before term index {T}")
    X = tr[C.FEATURES].replace([np.inf, -np.inf], np.nan)
    Xts = [f[C.FEATURES].replace([np.inf, -np.inf], np.nan) for f in tgt_feats]
    models = [_clf(s).fit(X, tr.filled.astype(int)) for s in C.SEEDS]
    return [np.mean([m.predict_proba(Xt)[:, 1] for m in models], axis=0) for Xt in Xts]


def train_predict_fill(tables: dict, T: int, tgt_feat):
    """P(filled) for tgt_feat's rows (see train_predict_fill_multi)."""
    return train_predict_fill_multi(tables, T, [tgt_feat])[0]


def one_seat_frame(tf):
    """Copy of the target feature table as if every section had 1 seat: seats, lseats and seat_ratio (the only columns derived
    from the row's own seats in correction.features_for) are reset; cap, the ws_* history and everything else stay."""
    f = tf.copy()
    f["seats"] = 1
    f["lseats"] = np.log(f.seats.astype(float))
    f["seat_ratio"] = f.seats / f.cap.clip(lower=1)
    return f


def predict_fill(df, tables, all_obs, term: str, cfg) -> dict:
    """{(class, window): P(filled)} for every section-window of `term` with seats > 0. Trained only on terms before `term`;
    features use only earlier windows of `term` and earlier terms (the shared correction feature builder).
    `all_obs` and `cfg` are unused (kept so the call matches backtest_corrected)."""
    C.require_deps()
    ti, _ = fit.term_index(term)
    if ti not in tables:
        raise CorrectionError(f"no feature table for {term}")
    tf = tables[ti]
    keys = list(zip(tf.cls, tf.window))
    if len(set(keys)) != len(keys):
        raise CorrectionError("duplicate (class, window) rows in the target term")
    p = train_predict_fill(tables, ti, tf)
    return {k: float(p[i]) for i, (k, s) in enumerate(zip(keys, tf.seats)) if s > 0}


# ----------------------------------------------------------------------------- spread exponents
def _band(cond_median_cents: float) -> int:
    return bisect.bisect_right(BAND_EDGES, cond_median_cents / 100)


def _cell(band: int, seats: int) -> str:
    return f"{band}|{1 if seats == 1 else 2}"  # 1 = a single seat, 2 = two or more


def _pin(u, act, pred):
    e = act - pred
    return np.maximum(u * e, (u - 1) * e)


def _best_exponent(q, u, m, floor, act) -> float:
    """First minimiser on S_GRID of the mean pinball loss at level u of max(floor, m * (q / m) ** s) against act (all cents)."""
    loss = [_pin(u, act, np.maximum(floor, m * (q / m) ** s)).mean() for s in S_GRID]
    return S_GRID[int(np.argmin(loss))]


def _fit_pair(a: dict, mask) -> tuple:
    if not mask.any():
        return (1.0, 1.0)
    m, fl, act = a["m"][mask], a["floor"][mask], a["act"][mask]
    return (_best_exponent(a["q10"][mask], 0.1, m, fl, act), _best_exponent(a["q90"][mask], 0.9, m, fl, act))


def learn_spread(rows) -> tuple:
    """Exponents per cell from rows (dicts with cond_p10, cond_p50, cond_p90, floor, act, filled, seats; cents).
    Cell = band of the conditional median x (1 seat | 2+ seats); cells, bands and the global pair are fitted on FILLED rows with
    a conditional distribution. A cell below MIN_CELL rows takes its band's pair, a band below MIN_CELL the global pair.
    Returns (table, sizes): table is JSON-safe and complete (spread_for only looks up); sizes has the row counts and the source
    ("cell", "band", "global") of each cell and band."""
    ok = [r for r in rows if r.get("filled") and r.get("cond_p50") and r.get("cond_p10") is not None and r.get("cond_p90") is not None]
    a = {k: np.array([float(r[f]) for r in ok]) for k, f in (("q10", "cond_p10"), ("m", "cond_p50"), ("q90", "cond_p90"), ("floor", "floor"), ("act", "act"))}
    band = np.array([_band(x) for x in a["m"]], dtype=int)
    one = np.array([int(r["seats"]) == 1 for r in ok], dtype=bool)
    allmask = np.ones(len(ok), dtype=bool)
    glob = _fit_pair(a, allmask)
    bands, bsrc, bn = [], [], []
    for b in range(N_BANDS):
        mk = band == b
        bn.append(int(mk.sum()))
        if bn[-1] >= MIN_CELL:
            bands.append(_fit_pair(a, mk)); bsrc.append("band")
        else:
            bands.append(glob); bsrc.append("global")
    cells, csizes = {}, {}
    for b in range(N_BANDS):
        for o in (1, 2):
            mk = (band == b) & (one if o == 1 else ~one)
            n = int(mk.sum())
            if n >= MIN_CELL:
                cells[f"{b}|{o}"] = _fit_pair(a, mk); src = "cell"
            else:
                cells[f"{b}|{o}"] = bands[b]; src = bsrc[b]
            csizes[f"{b}|{o}"] = {"n": n, "src": src}
    table = {"version": 1, "bandEdgesE": list(BAND_EDGES), "grid": [GRID_LO, GRID_HI, GRID_STEP], "minCell": MIN_CELL,
             "global": list(glob), "bands": [list(x) for x in bands], "cells": {k: list(v) for k, v in cells.items()}}
    sizes = {"global": int(len(ok)), "bands": [{"n": n, "src": s} for n, s in zip(bn, bsrc)], "cells": csizes}
    return table, sizes


def spread_for(table: dict, cond_median_cents: float, seats: int) -> tuple:
    """(spreadLo, spreadHi) for a section whose conditional median is cond_median_cents and which has `seats` seats."""
    if not cond_median_cents or not cond_median_cents > 0:
        return tuple(table["global"])
    b = bisect.bisect_right(table["bandEdgesE"], cond_median_cents / 100)
    lo, hi = table["cells"][_cell(b, seats)]
    return (lo, hi)


def apply(params, p_clf, table: dict, cond_median_cents: float, seats: int):
    """A SimParams copy with fillProb (the classifier probability; kept as is when p_clf is missing), spreadLo and spreadHi set."""
    lo, hi = spread_for(table, cond_median_cents, seats)
    ok = p_clf is not None and not (isinstance(p_clf, float) and math.isnan(p_clf))
    return replace(params, fillProb=float(p_clf) if ok else params.fillProb, spreadLo=lo, spreadHi=hi)


# ----------------------------------------------------------------------------- rows
def rows_for_term(df, tables, all_obs, term: str, cfg, pool=None) -> list:
    """Per-row results of the CORRECTED model for `term` (one pass of correction.backtest_corrected with return_rows=True):
    pfill, p10/p50/p90, cond_p10/p50/p90, cq (99 conditional percentiles of the filled replays, cents; None when none filled),
    floor, act, filled, seats, window, course, cls, section, instr, plus p_clf (out-of-sample classifier probability, NaN
    when the row has none)."""
    summ, _ = C.backtest_corrected(df, tables, all_obs, term, cfg, pool, return_rows=True)
    return with_classifier(summ["_rows"], df, tables, all_obs, term, cfg)


def with_classifier(rows, df, tables, all_obs, term: str, cfg) -> list:
    """rows (backtest_corrected results of `term` with return_rows=True) with p_clf set in place: the out-of-sample classifier
    probability of each row's (class, window), NaN when it has none. Returns rows."""
    pc = predict_fill(df, tables, all_obs, term, cfg)
    for r in rows:
        r["p_clf"] = pc.get((r["cls"], r["window"]), float("nan"))
    return rows


# ----------------------------------------------------------------------------- applying exponents to a cq grid
def _grid(rows):
    return np.array([np.array(r["cq"], float) if r.get("cq") else np.full(99, np.nan) for r in rows])


def _exps(rows, table):
    if table is None:
        return np.ones(len(rows)), np.ones(len(rows))
    ex = np.array([spread_for(table, r["cond_p50"], r["seats"]) if r.get("cond_p50") else (1.0, 1.0) for r in rows], float)
    return ex[:, 0], ex[:, 1]


def _transform(Q, m, floor, lo, hi):
    """q'(u) = max(floor, m * (q / m) ** s) with s = hi above u = 0.5, lo below, the median column unchanged. NaN rows stay NaN."""
    out = Q.copy()
    ok = ~np.isnan(Q[:, 0]) & (m > 0)
    if not ok.any():
        return out
    ratio = Q[ok] / m[ok][:, None]
    for j, u in enumerate(CQ_U):
        if u == 0.5:
            continue
        s = (hi if u > 0.5 else lo)[ok]
        out[ok, j] = np.maximum(floor[ok], m[ok] * ratio[:, j] ** s)
    return out


def _uq(Q, p, floor, a):
    """Unconditional quantile at level a of the mixture (1 - p at the floor, p over the conditional grid), linear on the grid.
    `a` is one level or an array with one level per row."""
    nan = np.isnan(Q[:, 0])
    floor_mass = ((1 - p) >= a - 1e-12) | nan | np.isnan(p)
    u = (a - (1 - p)) / np.where(p > 0, p, 1.0)
    pos = np.clip(u * 100 - 1, 0, 98)
    i0 = np.minimum(np.floor(pos).astype(int), 97)
    fr = pos - i0
    r = np.arange(len(p))
    Qn = np.where(nan[:, None], 0.0, Q)
    v = Qn[r, i0] * (1 - fr) + Qn[r, i0 + 1] * fr
    return np.where(floor_mass, floor, v)


def _arrays(rows, table, use_clf: bool):
    """(Q, p, floor, act, filled) for rows. table None = uncalibrated (simulator pfill and untransformed grid)."""
    Q = _grid(rows)
    floor = np.array([float(r["floor"]) for r in rows])
    act = np.array([float(r["act"]) for r in rows])
    filled = np.array([int(r["filled"]) for r in rows])
    m = np.array([float(r["cond_p50"]) if r.get("cond_p50") else np.nan for r in rows])
    if table is not None:
        lo, hi = _exps(rows, table)
        Q = _transform(Q, m, floor, lo, hi)
    p = np.array([float(r["p_clf"]) if use_clf else float(r["pfill"]) for r in rows])
    return Q, p, floor, act, filled


def _score(rows, table, use_clf: bool) -> dict:
    Q, p, floor, act, filled = _arrays(rows, table, use_clf)
    pin = {str(a): float(_pin(a, act / 100, _uq(Q, p, floor, a) / 100).mean()) for a in QLEVELS}
    pin["mean"] = float(np.mean([pin[str(a)] for a in QLEVELS]))
    fc = (filled == 1) & ~np.isnan(Q[:, 0])
    cov = float(((Q[fc, 9] <= act[fc]) & (act[fc] <= Q[fc, 89])).mean()) if fc.any() else None
    return {"pinball": pin, "coverage": cov, "nFilled": int(fc.sum())}


def _brier(rows) -> dict:
    ok = [r for r in rows if not math.isnan(r["p_clf"])]
    y = np.array([int(r["filled"]) for r in ok], float)
    return {"pClf": float(np.mean((np.array([r["p_clf"] for r in ok]) - y) ** 2)),
            "pFill": float(np.mean((np.array([r["pfill"] for r in ok]) - y) ** 2)), "n": len(ok)}


def site_round(raw_cents: float, floor_cents: float) -> int:
    """The site's calibrated bid from a raw quantile (site/src/lib/sim: recommendBid's oddCents, then presets.ts bidFor):
    the next odd cent, kept as is at the floor, otherwise raised to the next whole e$ plus 1 cent."""
    b = int(math.ceil(raw_cents - 1e-9))
    if b % 2 == 0:
        b += 1
    fl = int(floor_cents)
    if b <= (fl + 1 if fl % 2 == 0 else fl):
        return b
    return int(math.ceil((b - 1) / 100)) * 100 + 1


def _level_table_arr(Q, p, floor, act, filled) -> list:
    out = []
    fm = filled == 1
    for a in LEVEL_GRID:
        bid = _uq(Q, p, floor, a)
        lose = bid < act
        above = bid > floor
        out.append({"level": a,
                    "lossFilled": float(lose[fm].mean()) if fm.any() else None,
                    "lossAll": float(lose.mean()) if len(lose) else None,
                    "winAboveFloor": float((~lose[above]).mean()) if above.any() else None,
                    "meanOverpay": float((np.maximum(bid - act, 0) / 100).mean()) if len(lose) else None})
    return out


def _level_table(rows, table) -> list:
    return _level_table_arr(*_arrays(rows, table, True))


def pick_levels(table: list) -> dict:
    """Per style, the smallest level of the table whose lossFilled is within the style's STYLE_LOSS (cheap 0.30, balanced 0.15,
    safe 0.10), reached True; the highest level with reached False when none is."""
    def at(limit):
        for row in table:
            if row["lossFilled"] is not None and row["lossFilled"] <= limit:
                return {**row, "reached": True}
        return {**table[-1], "reached": False}
    return {st: at(STYLE_LOSS[st]) for st in STYLES}


def _cal_arrays(cal):
    """(Q, p, floor, act, filled, window group per row) stacked over cal = [(rows, exponent table), ...]; each pair is scored
    with its own table. A pair with no rows is skipped."""
    parts = [(_arrays(rs, tab, True), [S.window_group(r["window"]) for r in rs]) for rs, tab in cal if rs]
    arrs = tuple(np.concatenate([a[i] for a, _ in parts]) for i in range(5))
    return arrs + (np.array([g for _, gs in parts for g in gs]),)


def own_groups(row_sets) -> set:
    """The window groups that get their own levels: at least MIN_CELL filled rows over all of `row_sets` together. The shipped
    pick (calibrate_levels on both terms) and the measurement (measured_win, one term per fold) both use this, so a group is
    measured at the kind of level it ships with."""
    n = {}
    for rows in row_sets:
        for r in rows:
            if int(r["filled"]) == 1:
                g = S.window_group(r["window"])
                n[g] = n.get(g, 0) + 1
    return {g for g in GROUPS if n.get(g, 0) >= MIN_CELL}


def calibrate_levels(cal, own: set | None = None) -> tuple:
    """(level table, pooled levels, levels by group) for cal = [(rows, exponent table), ...] pooled. Pooled levels: pick_levels of
    the table over all rows ({style: {level, lossFilled, lossAll, winAboveFloor, meanOverpay, reached}}). By group: for each of
    GROUPS the levels picked on that group's rows when it is in `own` (default: own_groups of cal's rows, i.e. at least MIN_CELL
    filled) and has any filled row here, else the pooled level ({group: {style: {level, lossFilled, reached, nFilled, own}}}; a
    fallback keeps the pooled lossFilled and reached, own False)."""
    Q, p, floor, act, filled, grp = _cal_arrays(cal)
    table = _level_table_arr(Q, p, floor, act, filled)
    pooled = pick_levels(table)
    if own is None:
        own = own_groups([rs for rs, _ in cal])
    by_group = {}
    for g in GROUPS:
        mk = grp == g
        nf = int(filled[mk].sum())
        is_own = g in own and nf > 0
        lv = pick_levels(_level_table_arr(Q[mk], p[mk], floor[mk], act[mk], filled[mk])) if is_own else pooled
        by_group[g] = {st: {"level": lv[st]["level"], "lossFilled": lv[st]["lossFilled"], "reached": bool(lv[st]["reached"]),
                            "nFilled": nf, "own": is_own} for st in STYLES}
    return table, pooled, by_group


def row_levels(rows, by_group: dict, pooled: dict, style: str):
    """Level of `style` per row: its window group's level in by_group ({group: {style: level or {"level": ...}}}, None for none),
    else (a group not in it, or the window outside GROUPS) the pooled one ({style: level or {"level": ...}})."""
    def lv(x):
        return float(x["level"] if isinstance(x, dict) else x)
    base = lv(pooled[style])
    if not by_group:
        return np.full(len(rows), base)
    by = {g: lv(d[style]) for g, d in by_group.items()}
    return np.array([by.get(S.window_group(r["window"]), base) for r in rows], float)


def _course_ids_ok(course_ids) -> bool:
    """True when every course id is a non-blank string. None, a number or a blank string means the course is unknown."""
    return all(isinstance(c, str) and c.strip() for c in course_ids)


def _course_counts(course_ids) -> tuple:
    """(nCourses, effCourses): the distinct courses, and (sum n_i)^2 / sum n_i^2 over their row counts n_i, as a full float. It is not
    rounded: the page compares it with the 20 threshold, and rounding to 1 dp shipped 19.96676 (sizes 11, 22 and 28 courses of size 4)
    as 20.0 (H10, 19 Nov 2026)."""
    cnt = {}
    for c in course_ids:
        cnt[c] = cnt.get(c, 0) + 1
    tot = sum(cnt.values())
    return len(cnt), tot * tot / sum(v * v for v in cnt.values())


def upper_bounds(wins: dict, course_ids, n_boot: int = BOOT_N, seed: int = BOOT_SEED, q: float = BOOT_Q):
    """One-sided upper bound (the q-th percentile, as a fraction rounded to 4 places) of each style's win rate from a course-cluster
    bootstrap: whole courses are resampled with replacement and the rate recomputed, so a course's rows move together (the same
    resampling as evalscore.bootstrap_ci, one-sided). `wins` {style: 0/1 array over the rows of the population}, `course_ids` one
    non-blank string per row (see _course_ids_ok). The same resamples serve every style. Deterministic for a seed.
    Returns None, with no bounds at all, when any course id is missing or invalid."""
    if not _course_ids_ok(course_ids):
        return None
    ci = np.unique(np.asarray(course_ids, dtype=str), return_inverse=True)[1]
    k = int(ci.max()) + 1
    n = np.bincount(ci, None, k).astype(float)
    W = np.random.default_rng(seed).multinomial(k, np.full(k, 1.0 / k), size=n_boot).astype(float)
    den = W @ n  # every course has at least one row, so a resample is never empty
    return {st: round(float(np.percentile((W @ np.bincount(ci, np.asarray(v, float), k)) / den, q * 100)), 4) for st, v in wins.items()}


def measured_win(rt, rh, tab_test, tab_held) -> dict:
    """Out-of-sample win rate on FILLED sections of the per-group procedure, from two folds: levels picked on `rt` (scored with
    the exponents of the other term, tab_held) applied to `rh` scored with tab_test, and levels picked on `rh` (scored with
    tab_test) applied to `rt` scored with tab_held. Bids are rounded the way the site rounds them (site_round). Which groups get
    their own level is decided once on both terms (own_groups), as in the shipped pick, so a group with MIN_CELL filled rows over
    both terms is measured at a level picked on its own rows of one term, however few (since 17 Nov; before, each fold applied
    MIN_CELL to its one term, so a thin group such as R2A was measured at the pooled level while the site shipped its own). Rows of
    both folds are pooled; per (window group, forecast band) a cell with at least MIN_CELL filled rows uses its own rate, else the
    group's pooled rate (when the group has MIN_CELL), else the rate over all rows. nFilled and `upper` always describe the rows
    the rate came from (`source`). upper (since 19 Nov, optional): the one-sided 95% upper bound of each rate from a course-cluster
    bootstrap over those rows (upper_bounds). nCourses (distinct courses) and effCourses (see _course_counts) are emitted with it,
    under the same condition; all three are absent when any row of the population has a missing or blank course id.
    {group: {str(band): {cheap, balanced, safe, nFilled, source: "cell" | "group" | "all"[, upper: {style: bound}, nCourses, effCourses]}},
    "overall": {style: rate}}."""
    grp, band, win, crs = [], [], {st: [] for st in STYLES}, []
    own = own_groups([rt, rh])
    for pick_rows, pick_tab, app_rows, app_tab in ((rt, tab_held, rh, tab_test), (rh, tab_test, rt, tab_held)):
        _, pooled, by_group = calibrate_levels([(pick_rows, pick_tab)], own)
        Q, p, floor, act, filled = _arrays(app_rows, app_tab, True)
        fm = filled == 1
        grp += [S.window_group(r["window"]) for r, f in zip(app_rows, fm) if f]
        band += [_band(r["cond_p50"]) if r.get("cond_p50") else 0 for r, f in zip(app_rows, fm) if f]
        crs += [r.get("course") for r, f in zip(app_rows, fm) if f]
        for st in STYLES:
            raw = _uq(Q, p, floor, row_levels(app_rows, by_group, pooled, st))
            bid = np.array([site_round(b, f) for b, f in zip(raw[fm], floor[fm])], float)
            win[st] += list((bid >= act[fm]).astype(float))
    grp, band = np.array(grp), np.array(band, dtype=int)
    win = {st: np.array(v) for st, v in win.items()}

    def rate(mk, source):
        n = int(mk.sum())
        cell = {**{st: round(float(win[st][mk].mean()), 4) if n else None for st in STYLES}, "nFilled": n, "source": source}
        # course ids of the rows; any missing or blank id on a filled row leaves the cell without upper, nCourses and effCourses
        ids = [c for c, m in zip(crs, mk) if m] if n else []
        if n and _course_ids_ok(ids):
            up = upper_bounds({st: win[st][mk] for st in STYLES}, ids)
            cell["upper"] = {st: max(up[st], cell[st]) for st in STYLES}  # a percentile can sit just under the observed rate
            cell["nCourses"], cell["effCourses"] = _course_counts(ids)
        return cell
    everyone = np.ones(len(grp), dtype=bool)
    out = {}
    for g in GROUPS:
        gm = grp == g
        out[g] = {}
        for b in range(N_BANDS):
            cm = gm & (band == b)
            out[g][str(b)] = (rate(cm, "cell") if cm.sum() >= MIN_CELL else rate(gm, "group") if gm.sum() >= MIN_CELL else rate(everyone, "all"))
    out["overall"] = {st: round(float(win[st].mean()), 4) if len(grp) else None for st in STYLES}
    return out


def gate(metrics: dict) -> tuple:
    """(ok, reasons): classifier Brier below pfill's on both terms, held-out cond 10-90 coverage in COVERAGE_RANGE, held-out
    mean pinball below the uncalibrated one."""
    reasons = []
    for t in ("test", "held"):
        b = metrics["brier"][t]
        if not b["pClf"] < b["pFill"]:
            reasons.append(f"classifier Brier {b['pClf']:.4f} is not below pfill Brier {b['pFill']:.4f} on the {t} term")
    h = metrics["held"]
    cov = h["coverage"]["calibrated"]
    if cov is None or not COVERAGE_RANGE[0] <= cov <= COVERAGE_RANGE[1]:
        reasons.append(f"held-out 10-90 coverage {cov} is outside {list(COVERAGE_RANGE)}")
    pc, pu = h["pinball"]["calibrated"]["mean"], h["pinball"]["uncalibrated"]["mean"]
    if not pc < pu:
        reasons.append(f"held-out mean pinball {pc:.4f} is not below the uncalibrated {pu:.4f}")
    return not reasons, reasons


def _identifiers(cfg) -> dict:
    return {"modelVersion": C.MODEL_VERSION, "distcalVersion": DISTCAL_VERSION, "sourceConfig": json.loads(json.dumps(fit.asdict(cfg))),
            "gbmParams": C.GBM_PARAMS, "seeds": list(C.SEEDS), "firstTrainTerm": C.FIRST_TRAIN_TERM}


def backtest_distcal(df, tables, all_obs, cfg, pool, test_term: str, held_term: str, rows=None) -> dict:
    """Gate figures and bid levels for the calibration. Exponents are learned on the TEST term's rows and judged on the HELD-OUT
    term (classifier probability p_clf and the mixture formula, against the uncalibrated pfill + raw grid). `rows` ({term: rows},
    optional) reuses rows_for_term results instead of simulating again. Final exponents (for live use) are learned on both terms.
    The bid levels are calibrated on both terms cross-fit: the held-out rows scored with the test term's exponents and the test
    rows with the held-out term's, so no row is scored with exponents learned on itself (levels, levelTable: pooled;
    levelsByGroup: per window group; measuredWin: out-of-sample filled win rate, see measured_win)."""
    C.require_deps()
    t0 = time.time()
    rows = rows or {}
    rt = rows.get(test_term) or rows_for_term(df, tables, all_obs, test_term, cfg, pool)
    rh = rows.get(held_term) or rows_for_term(df, tables, all_obs, held_term, cfg, pool)
    tab_test, size_test = learn_spread(rt)
    tab_held = learn_spread(rh)[0]
    tab_final, size_final = learn_spread(rt + rh)
    metrics = {"brier": {"test": _brier(rt), "held": _brier(rh)},
               "held": {"n": len(rh), "nFilled": sum(int(r["filled"]) for r in rh),
                        "coverage": {}, "pinball": {}},
               "testInSample": {"n": len(rt), "nFilled": sum(int(r["filled"]) for r in rt), "coverage": {}, "pinball": {},
                                "note": "exponents were learned on these rows"}}
    for key, rs in (("held", rh), ("testInSample", rt)):
        cal, unc = _score(rs, tab_test, True), _score(rs, None, False)
        metrics[key]["coverage"] = {"calibrated": cal["coverage"], "uncalibrated": unc["coverage"]}
        metrics[key]["pinball"] = {"calibrated": cal["pinball"], "uncalibrated": unc["pinball"]}
    ok, reasons = gate(metrics)
    lt, levels, by_group = calibrate_levels([(rh, tab_test), (rt, tab_held)])
    return {"ok": bool(ok), "reasons": reasons, **_identifiers(cfg), "terms": {"test": test_term, "heldOut": held_term},
            "exponents": tab_final, "exponentsTestOnly": tab_test, "cellSizes": size_final, "cellSizesTestOnly": size_test,
            "metrics": metrics, "levelTable": lt, "levels": levels, "levelsByGroup": by_group,
            "measuredWin": measured_win(rt, rh, tab_test, tab_held), "bandEdges": list(BAND_EDGES),
            "classifier": "HistGradientBoostingClassifier, variant A (probability alone)",
            "seconds": round(time.time() - t0, 1), "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}


# ----------------------------------------------------------------------------- refit hook and live term
def build_and_write(keep: dict, backtest: dict, cfg, out_dir: str, log=print) -> dict:
    """The refit step after correction.build_corrected_backtest(..., keep=keep): reuses its per-row results (keep["rows"]
    {term: rows}, plus keep["df"], keep["tables"], keep["all_obs"]), adds the classifier probabilities, runs backtest_distcal on
    the corrected backtest's own test and held-out terms and writes <out_dir>/distcal.json. No extra simulation pass.
    Raises on any problem (the caller treats that as non-fatal). Returns the payload."""
    C.require_deps()
    test_term, held_term = backtest["term"], (backtest.get("heldOut") or {}).get("term")
    if not held_term:
        raise CorrectionError("backtest.json has no held-out term")
    df, tables, all_obs = keep["df"], keep["tables"], keep["all_obs"]
    rows = {t: with_classifier(keep["rows"][t], df, tables, all_obs, t, cfg) for t in (test_term, held_term)}
    payload = backtest_distcal(df, tables, all_obs, cfg, None, test_term, held_term, rows=rows)
    path = os.path.join(out_dir, DISTCAL_FILE)
    write(path, payload)
    lv = payload["levels"]
    groups = "; ".join(f"{g} " + "/".join(str(payload["levelsByGroup"][g][st]["level"]) + ("" if payload["levelsByGroup"][g][st]["own"] else "*")
                                          for st in STYLES) for g in GROUPS)
    log(f"distcal: ok={payload['ok']} held-out coverage={payload['metrics']['held']['coverage']['calibrated']:.3f} "
        f"levels cheap/balanced/safe={lv['cheap']['level']}/{lv['balanced']['level']}/{lv['safe']['level']} "
        f"by group ({groups}; * = pooled fallback) ({payload['seconds']} s) -> {path}"
        + ("" if payload["ok"] else f"; gate: {payload['reasons']}"))
    return payload


def cfg_from_config(c: dict):
    """fit.Config from a stored config dict (as in backtest.json / calibration.json), with the correction's 1500 runs."""
    return replace(fit.Config(**{**c, "tau_d": tuple(c["tau_d"]), "tau_p": tuple(c["tau_p"])}), runs=C.SIM_RUNS)


def live_predict_fill(live: dict) -> dict:
    """{(class, window): P(filled)} for the live term's target rows. `live` is what correction.apply_correction(live_out=...)
    leaves behind: the feature table of the target rows (features_for(df, ti, tgt=...): history from terms before ti plus
    results of the term's earlier windows only, exactly what the price GBM sees) and the tables of earlier terms."""
    C.require_deps()
    tf = live["tf"]
    p = train_predict_fill(live["tables"], live["ti"], tf)
    return {(c, w): float(v) for c, w, v, s in zip(tf.cls, tf.window, p, tf.seats) if s > 0}


def live_predict_fill_with_one_seat(live: dict) -> tuple[dict, dict]:
    """(current, at1): `current` is live_predict_fill's dict; `at1` is {(class, window): P(filled) as if the section had 1 seat}
    for rows with seats > 1 (the classifier fitted once, applied to the target table and to its one_seat_frame)."""
    C.require_deps()
    tf = live["tf"]
    p, p1 = train_predict_fill_multi(live["tables"], live["ti"], [tf, one_seat_frame(tf)])
    cur = {(c, w): float(v) for c, w, v, s in zip(tf.cls, tf.window, p, tf.seats) if s > 0}
    at1 = {(c, w): float(v) for c, w, v, s in zip(tf.cls, tf.window, p1, tf.seats) if s > 1}
    return cur, at1


# ----------------------------------------------------------------------------- persistence
def write(path: str, payload: dict) -> None:
    """Write payload as JSON, mode 0600, replacing path atomically."""
    tmp = f"{path}.tmp{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(payload, fh, indent=1)
    os.replace(tmp, path)


def invalid_reason(payload, cfg, terms: dict | None = None) -> str | None:
    """None when the payload passed its gate and was made by this model version, config and hyperparameters, else the reason."""
    if not payload:
        return "no distribution calibration"
    if payload.get("distcalVersion") not in COMPATIBLE_VERSIONS:
        return f"distribution calibration is for {payload.get('distcalVersion')!r}, code is {DISTCAL_VERSION!r}"
    if payload.get("modelVersion") != C.MODEL_VERSION:
        return f"distribution calibration is for {payload.get('modelVersion')!r}, code is {C.MODEL_VERSION!r}"
    if not payload.get("ok"):
        return "distribution calibration failed its gate"
    if payload.get("sourceConfig") != json.loads(json.dumps(fit.asdict(cfg))):
        return "distribution calibration was made with a different fit config"
    if payload.get("gbmParams") != C.GBM_PARAMS or payload.get("seeds") != list(C.SEEDS) or payload.get("firstTrainTerm") != C.FIRST_TRAIN_TERM:
        return "distribution calibration used other GBM hyperparameters"
    if terms is not None and payload.get("terms") != terms:
        return "distribution calibration covers other terms"
    return None


def load_valid(path: str, cfg, terms: dict | None = None):
    """The payload at path when invalid_reason is None, else None (missing or unreadable file included). `terms`, when given, is
    {"test": ..., "heldOut": ...} and must equal the payload's."""
    try:
        with open(path) as fh:
            payload = json.load(fh)
    except (OSError, ValueError):
        return None
    return payload if invalid_reason(payload, cfg, terms) is None else None
