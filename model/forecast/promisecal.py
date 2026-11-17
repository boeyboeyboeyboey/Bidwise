"""Promise calibration (Phase 2, evaluation only; nothing here is shipped).

Each bid style promises a win rate *if the section fills* (Cheap 70%, Balanced 85%, Safe 95%). This module sets each style's
bid as a split-conformal multiplier on the forecast's conditional price, learned per group from the two previous terms'
backtest rows, so that the promise holds out of sample.

For style s with target tau and base percentile p (cheap 70, balanced 85, safe 95), on FILLED calibration rows:

    scale = max(cq[p-1] - floor, MIN_SCALE)        cq: the row's 99-point conditional quantile grid (cents)
    score = (act - floor) / scale
    m     = the ceil((n+1)*tau)-th smallest score  (weighted: the smallest score whose cumulative weight reaches
                                                    tau * (total weight + weight of a new row))
    bid   = site_round(floor + m * scale, floor)    a row with no cq bids site_round(floor)

Groups: window group (R1W1, R1A, R1B, R2, R2A) x seat class (1, 2-3, 4+), optionally x forecast band. A cell's multiplier is
shrunk towards its parent (global for the 2-axis cells, the 2-axis cell for band cells):
m_cell = (n_cell * m_raw + K * m_parent) / (n_cell + K), n_cell = filled calibration rows in the cell.

Recency: rows of the nearer calibration term carry NEAR_WEIGHT, the older term weight 1 (`weighted=False` treats all alike).
A scored term t is calibrated only on terms t-1 and t-2 (`rolled_table`); nothing from t is read.
"""
from __future__ import annotations

import math

from . import distcal as D
from . import evalscore as S

STYLES = ("cheap", "balanced", "safe")
TARGETS = {"cheap": 0.70, "balanced": 0.85, "safe": 0.95}
BASE_PCT = {"cheap": 70, "balanced": 85, "safe": 95}
K_SHRINK = 100.0
MIN_SCALE = 100  # cents: e$1, so a forecast that sits on the floor still gets a usable scale
NEAR_WEIGHT = 2.0
USE_BAND = True  # chosen 17 Nov on the harness: the 2-axis cells missed band 60+ and R2A by 7-10 points
VERSION = 1


def _site_round(raw_cents: float, floor_cents: float) -> int:
    from .evalharness import site_round  # lazy: evalharness imports this module
    return site_round(raw_cents, floor_cents)


def row_band(r: dict) -> int:
    m = r.get("cond_p50")
    return D._band(m) if m else 0


def cell_key(r: dict, use_band: bool = False) -> tuple:
    k = (S.window_group(r["window"]), S.seat_class(int(r["seats"])))
    return k + (row_band(r),) if use_band else k


def scale(r: dict, pct: int) -> float | None:
    cq = r.get("cq")
    if not cq:
        return None
    return float(max(cq[pct - 1] - r["floor"], MIN_SCALE))


def score(r: dict, pct: int) -> float | None:
    sc = scale(r, pct)
    return None if sc is None else (r["act"] - r["floor"]) / sc


def conformal_quantile(scores, tau: float, weights=None, w_new: float | None = None) -> float | None:
    """Split-conformal quantile. Unweighted: the ceil((n+1)*tau)-th smallest score (the largest when that exceeds n).
    Weighted: the smallest score whose cumulative weight reaches tau * (sum of weights + w_new), w_new defaulting to the
    largest weight; with equal weights this is the unweighted rule. None for no scores."""
    n = len(scores)
    if n == 0:
        return None
    if weights is None:
        k = min(max(math.ceil((n + 1) * tau), 1), n)
        return float(sorted(scores)[k - 1])
    pairs = sorted(zip(scores, weights))
    w_new = max(weights) if w_new is None else w_new
    need = tau * (sum(weights) + w_new)
    cum = 0.0
    for s, w in pairs:
        cum += w
        if cum >= need - 1e-9:
            return float(s)
    return float(pairs[-1][0])


def shrink(m_raw: float | None, n: int, m_parent: float, k: float = K_SHRINK) -> float:
    if m_raw is None or n <= 0:
        return m_parent
    return (n * m_raw + k * m_parent) / (n + k)


def fit_table(calib: list, targets: dict | None = None, weighted: bool = True, use_band: bool = USE_BAND,
              k: float = K_SHRINK) -> dict:
    """Multiplier table from `calib` = [(rows, weight), ...]. With weighted=False every row weighs 1."""
    targets = targets or TARGETS
    items = []  # (row, weight) for filled rows that have a grid
    for rows, w in calib:
        for r in rows:
            if int(r["filled"]) == 1 and r.get("cq"):
                items.append((r, float(w) if weighted else 1.0))
    use_w = weighted and len({w for _, w in items}) > 1
    tab = {"version": VERSION, "targets": dict(targets), "basePct": dict(BASE_PCT), "k": k, "weighted": bool(weighted),
           "band": bool(use_band), "n": len(items), "global": {}, "cells": {}, "cells2": {}}

    def q(sub, st):
        sc = [score(r, BASE_PCT[st]) for r, _ in sub]
        return conformal_quantile(sc, targets[st], [w for _, w in sub] if use_w else None,
                                  NEAR_WEIGHT if use_w else None)

    groups2: dict = {}
    groups3: dict = {}
    for it in items:
        groups2.setdefault(cell_key(it[0]), []).append(it)
        if use_band:
            groups3.setdefault(cell_key(it[0], True), []).append(it)
    for st in STYLES:
        g = q(items, st)
        tab["global"][st] = max(g, 0.0) if g is not None else 1.0
    for key, sub in groups2.items():
        tab["cells2"][key] = {st: max(shrink(q(sub, st), len(sub), tab["global"][st], k), 0.0) for st in STYLES}
        tab["cells2"][key]["n"] = len(sub)
    for key, sub in groups3.items():
        parent = tab["cells2"][key[:2]]
        tab["cells"][key] = {st: max(shrink(q(sub, st), len(sub), parent[st], k), 0.0) for st in STYLES}
        tab["cells"][key]["n"] = len(sub)
    if not use_band:
        tab["cells"] = tab["cells2"]
    return tab


def multiplier(tab: dict, r: dict, st: str) -> float:
    key = cell_key(r, tab["band"])
    c = tab["cells"].get(key)
    if c is None and tab["band"]:
        c = tab["cells2"].get(key[:2])
    return c[st] if c is not None else tab["global"][st]


def bids(rows, tab: dict) -> dict:
    """{style: [bid cents per row]}, rounded the site's way, never below the floor."""
    out = {st: [] for st in STYLES}
    for r in rows:
        fl = r["floor"]
        for st in STYLES:
            sc = scale(r, BASE_PCT[st])
            raw = fl if sc is None else fl + multiplier(tab, r, st) * sc
            out[st].append(max(_site_round(raw, fl), int(fl)))
    return out


def rolled_table(prev: list, prev2: list | None, **kw) -> dict:
    """The table a scored term would get: calibrated on the term before it (`prev`, NEAR_WEIGHT) and the one before that
    (`prev2`, weight 1). Rows of the scored term are never passed in."""
    calib = [(prev, NEAR_WEIGHT)] + ([(prev2, 1.0)] if prev2 else [])
    return fit_table(calib, **kw)


def summary(tab: dict) -> dict:
    """JSON-safe view for the harness settings: global multipliers and per-cell multipliers with their row counts."""
    return {"weighted": tab["weighted"], "band": tab["band"], "k": tab["k"], "n": tab["n"], "targets": tab["targets"],
            "global": {st: round(v, 4) for st, v in tab["global"].items()},
            "cells": {"/".join(str(x) for x in key): {kk: (round(v, 4) if kk != "n" else v) for kk, v in c.items()}
                      for key, c in sorted(tab["cells"].items(), key=lambda kv: str(kv[0]))}}
