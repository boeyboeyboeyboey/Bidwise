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
earlier terms) and writes the figures and the bid levels the site can show. Nothing here is imported by the site build;
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

np, pd = C.np, C.pd
CorrectionError = C.CorrectionError

DISTCAL_VERSION = "distcal-a1"  # classifier variant A + S4 spread cells
DISTCAL_FILE = "distcal.json"

BAND_EDGES = (15, 25, 40, 60)  # e$ of the conditional median: <15, 15-25, 25-40, 40-60, 60+
N_BANDS = len(BAND_EDGES) + 1
MIN_CELL = 100  # filled rows needed for a cell (or a band) to keep its own pair
GRID_LO, GRID_HI, GRID_STEP = 0.30, 2.00, 0.05
S_GRID = [round(GRID_LO + i * GRID_STEP, 2) for i in range(int(round((GRID_HI - GRID_LO) / GRID_STEP)) + 1)]
QLEVELS = (0.5, 0.8, 0.9, 0.95)  # unconditional quantile levels of the pinball metric
LEVEL_GRID = [round(0.90 + 0.005 * i, 3) for i in range(19)]  # 0.900 .. 0.990 for the bid level table
BALANCED_LOSS, SAFE_LOSS = 0.16, 0.10  # max share of filled sections the level may lose
COVERAGE_RANGE = (0.75, 0.85)
CQ_U = np.arange(1, 100) / 100.0 if np is not None else None  # percentile of each cq grid column


def _clf(seed: int):
    return HistGradientBoostingClassifier(
        loss="log_loss", categorical_features=[C.FEATURES.index(c) for c in C.CATEGORICAL], early_stopping=True,
        n_iter_no_change=25, max_iter=800, validation_fraction=0.15, random_state=seed, **C.GBM_PARAMS)


# ----------------------------------------------------------------------------- fill classifier (lab variant A)
def train_predict_fill(tables: dict, T: int, tgt_feat):
    """P(filled) for tgt_feat's rows: classifier on ALL sections with seats > 0 of every table with tidx < T (tables only holds
    terms from correction.FIRST_TRAIN_TERM on), same features as the price regressor, mean of the correction.SEEDS models."""
    C.require_deps()
    if HistGradientBoostingClassifier is None:
        raise CorrectionError("scikit-learn unavailable")
    tr = pd.concat([t for k, t in sorted(tables.items()) if k < T], ignore_index=True)
    tr = tr[tr.seats > 0]
    if len(tr) < 200 or tr.filled.nunique() < 2:
        raise CorrectionError(f"too few training rows for the fill classifier before term index {T}")
    X = tr[C.FEATURES].replace([np.inf, -np.inf], np.nan)
    Xt = tgt_feat[C.FEATURES].replace([np.inf, -np.inf], np.nan)
    return np.mean([_clf(s).fit(X, tr.filled.astype(int)).predict_proba(Xt)[:, 1] for s in C.SEEDS], axis=0)


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
    """Unconditional quantile at level a of the mixture (1 - p at the floor, p over the conditional grid), linear on the grid."""
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


def _level_table(rows, table) -> list:
    Q, p, floor, act, filled = _arrays(rows, table, True)
    out = []
    for a in LEVEL_GRID:
        bid = _uq(Q, p, floor, a)
        lose = bid < act
        above = bid > floor
        fm = filled == 1
        out.append({"level": a,
                    "lossFilled": float(lose[fm].mean()) if fm.any() else None,
                    "lossAll": float(lose.mean()),
                    "winAboveFloor": float((~lose[above]).mean()) if above.any() else None,
                    "meanOverpay": float((np.maximum(bid - act, 0) / 100).mean())})
    return out


def pick_levels(table: list) -> dict:
    """cheap = 0.90; balanced / safe = the smallest level whose lossFilled is within BALANCED_LOSS / SAFE_LOSS (the highest
    level, reached False, when none is)."""
    def at(pred):
        for row in table:
            if row["lossFilled"] is not None and pred(row):
                return {**row, "reached": True}
        return {**table[-1], "reached": False}
    return {"cheap": {**table[0], "reached": True}, "balanced": at(lambda r: r["lossFilled"] <= BALANCED_LOSS),
            "safe": at(lambda r: r["lossFilled"] <= SAFE_LOSS)}


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
    optional) reuses rows_for_term results instead of simulating again. Final exponents (for live use) are learned on both terms."""
    C.require_deps()
    t0 = time.time()
    rows = rows or {}
    rt = rows.get(test_term) or rows_for_term(df, tables, all_obs, test_term, cfg, pool)
    rh = rows.get(held_term) or rows_for_term(df, tables, all_obs, held_term, cfg, pool)
    tab_test, size_test = learn_spread(rt)
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
    lt = _level_table(rh, tab_test)
    return {"ok": bool(ok), "reasons": reasons, **_identifiers(cfg), "terms": {"test": test_term, "heldOut": held_term},
            "exponents": tab_final, "exponentsTestOnly": tab_test, "cellSizes": size_final, "cellSizesTestOnly": size_test,
            "metrics": metrics, "levelTable": lt, "levels": pick_levels(lt), "classifier": "HistGradientBoostingClassifier, variant A (probability alone)",
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
    log(f"distcal: ok={payload['ok']} held-out coverage={payload['metrics']['held']['coverage']['calibrated']:.3f} "
        f"levels cheap/balanced/safe={lv['cheap']['level']}/{lv['balanced']['level']}/{lv['safe']['level']} "
        f"({payload['seconds']} s) -> {path}" + ("" if payload["ok"] else f"; gate: {payload['reasons']}"))
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
    if payload.get("distcalVersion") != DISTCAL_VERSION:
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
