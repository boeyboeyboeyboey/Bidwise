"""Forecast correction (b2): a gradient-boosted p50 rescales the simulator's price level.

Per section and window, the GBM predicts the clearing bid (p50, filled sections). The site keeps its simulator (spread,
chance-of-a-seat curve, groups, swaps) but each section/window's `priceLevelCents` is multiplied by
    f * gbm_p50 / simulated_conditional_p50
so the simulator's own median lands on the (level-corrected) GBM. Demand (`demandMean`) and pFill are unchanged.
f = sum(actual) / sum(GBM p50) over the filled sections of the previous (up to) two terms, using those terms'
out-of-sample GBM predictions (each trained only on terms before it). Nothing from the target term enters f.

Everything is leak-free by construction: features of a row use only terms before its term, plus results of strictly earlier
windows of its own term. Deterministic: fixed seeds (0, 1, 2) and hyperparameters, no wall clock.

numpy, pandas and scikit-learn are optional: if the import fails, `IMPORT_ERROR` is set and callers must fall back to the
uncorrected params (`try_apply_correction` does). Nothing here is imported by the site build unless the correction runs.

CLI (accuracy figures for the corrected model, written next to backtest.json; see MERGE-CORRECTION.md):
    cd model && python3 -m forecast.correction backtest --csv <bids_with_schedule.csv> --fit-out forecast/out
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import zlib
from collections import defaultdict
from dataclasses import replace

try:  # optional dependencies: a failure here must never break the site build
    import numpy as np
    import pandas as pd
    from sklearn.ensemble import HistGradientBoostingRegressor
    IMPORT_ERROR: BaseException | None = None
except Exception as _e:  # noqa: BLE001 (ImportError, or a broken binary wheel)
    np = pd = HistGradientBoostingRegressor = None  # type: ignore[assignment]
    IMPORT_ERROR = _e

from . import fit

MODEL_VERSION = "fit+gbm-b2"
BASE_VERSION = "fit"
CORRECTED_BACKTEST = "backtest-corrected.json"

GBM_PARAMS = dict(learning_rate=0.03, max_leaf_nodes=24, min_samples_leaf=20, l2_regularization=1.0)
SEEDS = (0, 1, 2)
FIRST_TRAIN_TERM = "2023-24 Term 1"  # earliest term used as a training target (earlier terms are history only)
FACTOR_TERMS = 2  # previous terms whose out-of-sample predictions set f
SIM_RUNS = 1500

# Gate. A row whose rescale factor is missing, non-finite or outside ROW_HARD keeps its fitted price (skipped). Rows outside
# ROW_RATIO are still rescaled (the lab found that skipping them costs about e$0.5 MAE on the test term: those are
# hot sections the fit badly underprices), but if more than MAX_OUTSIDE_SHARE of rows fall outside it, or more than
# MAX_SKIPPED_SHARE are skipped, or f is outside F_RANGE, the whole correction is dropped.
F_RANGE = (0.5, 2.0)
ROW_RATIO = (0.3, 3.0)
ROW_HARD = (0.1, 10.0)
MAX_OUTSIDE_SHARE = 0.05
MAX_SKIPPED_SHARE = 0.10

WI = {w: i for i, w in enumerate(fit.WINDOWS)}
DECAY, CROSS = 0.7, 0.5
KEYSETS = {"ciw": ["course", "instr", "window"], "cw": ["course", "window"], "sw": ["subject", "window"], "w": ["window"],
           "ci": ["course", "instr"], "c": ["course"], "i": ["instr"], "s": ["subject"]}
CATEGORICAL = ["slot_c", "subj_c"]
FEATURES = (
    ["widx", "seats"]
    + [f"{k}_{s}" for k in ("ciw", "cw") for s in ("n", "ws", "fill", "lact", "lactf", "lseat", "lbid", "last_lact", "last_gap")]
    + [f"{k}_{s}" for k in ("sw", "w", "ci", "c", "i", "s") for s in ("n", "ws", "fill", "lact", "lactf", "lseat", "lbid")]
    + ["ws_nprev", "ws_nfilled", "ws_last_fill", "ws_last_seats", "ws_last_succ", "ws_lastf_lact", "ws_lastf_gap",
       "ws_lastf_seats", "ws_first_seats", "wc_lact", "wc_gap", "wc_nfilled", "wc_fillrate",
       "inst_new", "lseats", "lcap", "seat_ratio", "round_grp", "term_type"]
    + CATEGORICAL
)


class CorrectionError(Exception):
    """The correction cannot be computed or failed its gate; callers fall back to the uncorrected params."""


def require_deps() -> None:
    if IMPORT_ERROR is not None:
        raise CorrectionError(f"numpy/pandas/scikit-learn unavailable: {IMPORT_ERROR!r}")


# ----------------------------------------------------------------------------- frames and features
def first_train_tidx() -> int:
    return fit.term_index(FIRST_TRAIN_TERM)[0]


def obs_frame(rows: list[dict], floors: dict | None = None, extra: list[dict] | None = None):
    """One row per usable observation (section x window with seats offered), as in fit.build_obs, plus section capacity.

    `extra` are outcome-free target rows (current-term sections for windows that have not run): dicts with term, window,
    cls, course, section, instr, slot, seats, cap. They never feed history or within-term features, only get featurised.
    """
    require_deps()
    floors = floors or fit.course_floors(rows)
    cap = {(r["term"], r["class_number"], r["window"]): int(r["vacancy"] or 0) for r in rows}
    recs = []
    for o in fit.build_obs(rows, floors):
        recs.append(dict(term=o.term, tidx=o.tidx, ttype=int(o.ttype), window=o.window, widx=WI[o.window], cls=o.cls,
                         course=o.course, subject=o.subject, section=o.section, instr=o.instr, seats=o.seats, succ=o.succ,
                         filled=int(o.filled), mn=o.mn, floor=o.floor, slot=o.slot, cap=cap.get((o.term, o.cls, o.window), 0)))
    df = pd.DataFrame(recs)
    df["act"] = np.where(df.filled == 1, df.mn, df.floor).astype(float)
    df["lact"] = np.log(df.act)
    return df


def _cat_maps(df, extra_subjects=(), extra_slots=()):
    subs = sorted(set(df.subject) | set(extra_subjects))
    slots = sorted(set(df.slot) | set(extra_slots) | set(fit.SLOTS))
    return {s: i for i, s in enumerate(subs)}, {s: i for i, s in enumerate(slots)}


def _hist_feats(df, tgt, T):
    """Recency-weighted aggregates from terms strictly before T, merged onto tgt."""
    h = df[df.tidx < T].copy()
    h["w"] = DECAY ** ((T - h.tidx) / 2.0) * np.where((h.tidx % 2) == (T % 2), 1.0, CROSS)
    h["wf"] = h.w * h.filled
    h["w_la"] = h.w * h.lact
    h["wf_la"] = h.wf * h.lact
    h["w_ls"] = h.w * np.log(h.seats)
    h["w_lb"] = h.w * np.log1p(h.succ)
    out = tgt
    for nm, keys in KEYSETS.items():
        g = h.groupby(keys).agg(n=("w", "size"), ws=("w", "sum"), wf=("wf", "sum"), w_la=("w_la", "sum"),
                                wf_la=("wf_la", "sum"), w_ls=("w_ls", "sum"), w_lb=("w_lb", "sum"))
        f = pd.DataFrame({f"{nm}_n": g.n, f"{nm}_ws": g.ws, f"{nm}_fill": g.wf / g.ws, f"{nm}_lact": g.w_la / g.ws,
                          f"{nm}_lactf": np.where(g.wf > 0, g.wf_la / g.wf.replace(0, np.nan), np.nan),
                          f"{nm}_lseat": g.w_ls / g.ws, f"{nm}_lbid": g.w_lb / g.ws}, index=g.index)
        if nm in ("ciw", "cw"):  # latest earlier term with a filled result
            hf = h[h.filled == 1]
            last = hf.groupby(keys).tidx.max().rename("lt").reset_index()
            m = hf.merge(last, on=keys)
            m = m[m.tidx == m["lt"]].groupby(keys).agg(ll=("lact", "mean")).reset_index().set_index(keys)
            f[f"{nm}_last_lact"] = m["ll"].reindex(f.index)
            f[f"{nm}_last_gap"] = (T - last.set_index(keys)["lt"]).reindex(f.index)
        out = out.merge(f.reset_index(), on=keys, how="left")
    return out


def _within_feats(real, tgt):
    """Same-term features. `real` = rows of this term that have outcomes; for each tgt row only real rows of strictly
    earlier windows are read. (For training, real and tgt are the same rows.)"""
    by_cls, by_crs = defaultdict(list), defaultdict(list)
    for r in real.itertuples():
        by_cls[r.cls].append(r)
        by_crs[r.course].append(r)
    nan = float("nan")
    cols = defaultdict(list)
    for r in tgt.itertuples():
        pr = [p for p in by_cls.get(r.cls, ()) if p.widx < r.widx]
        pf = [p for p in pr if p.filled]
        cols["ws_nprev"].append(len(pr))
        cols["ws_nfilled"].append(len(pf))
        last = max(pr, key=lambda p: p.widx) if pr else None
        lastf = max(pf, key=lambda p: p.widx) if pf else None
        cols["ws_last_fill"].append(nan if last is None else last.filled)
        cols["ws_last_seats"].append(nan if last is None else last.seats)
        cols["ws_last_succ"].append(nan if last is None else last.succ)
        cols["ws_lastf_lact"].append(nan if lastf is None else lastf.lact)
        cols["ws_lastf_gap"].append(nan if lastf is None else r.widx - lastf.widx)
        cols["ws_lastf_seats"].append(nan if lastf is None else lastf.seats)
        cols["ws_first_seats"].append(nan if not pr else min(pr, key=lambda p: p.widx).seats)
        pc = [p for p in by_crs.get(r.course, ()) if p.widx < r.widx and p.cls != r.cls]
        pcf = [p for p in pc if p.filled]
        if pcf:
            lw = max(p.widx for p in pcf)
            sel = [p for p in pcf if p.widx == lw]
            cols["wc_lact"].append(float(np.median([p.lact for p in sel])))
            cols["wc_gap"].append(r.widx - lw)
        else:
            cols["wc_lact"].append(nan)
            cols["wc_gap"].append(nan)
        cols["wc_nfilled"].append(len(pcf))
        cols["wc_fillrate"].append(nan if not pc else float(np.mean([p.filled for p in pc])))
    for k, v in cols.items():
        tgt[k] = v
    return tgt


def features_for(df, T: int, tgt=None, cats=None):
    """Feature table for term index T. tgt defaults to df's rows of that term (rows with outcomes)."""
    require_deps()
    real = df[df.tidx == T]
    t = (real if tgt is None else tgt).reset_index(drop=True).copy()
    t = _hist_feats(df, t, T)
    t = _within_feats(real, t)
    seen = df[df.tidx < T][["course", "instr"]].drop_duplicates()
    seen_pairs = set(zip(seen.course, seen.instr))
    new = [int((c, i) not in seen_pairs) for c, i in zip(t.course, t.instr)]
    t["inst_new"] = new
    t["lseats"] = np.log(t.seats)
    t["lcap"] = np.log(t.cap.clip(lower=1))
    t["seat_ratio"] = t.seats / t.cap.clip(lower=1)
    t["round_grp"] = t.widx.map(lambda i: 0 if i == 0 else 1 if i <= 2 else 2 if i <= 4 else 3 if i <= 7 else 4)
    t["term_type"] = t.ttype.astype(int)
    subj, slot = cats if cats else _cat_maps(df)
    t["subj_c"] = t.subject.map(subj).fillna(-1).astype(int)
    t["slot_c"] = t.slot.map(slot).fillna(-1).astype(int)
    return t


def feature_tables(df, cats=None):
    """{tidx: features} for every training-eligible term present in df (history uses only earlier terms)."""
    cats = cats or _cat_maps(df)
    lo = first_train_tidx()
    return {int(T): features_for(df, int(T), cats=cats) for T in sorted(df.tidx.unique()) if T >= lo}, cats


# ----------------------------------------------------------------------------- GBM
def _reg(seed: int):
    return HistGradientBoostingRegressor(
        loss="quantile", quantile=0.5, categorical_features=[FEATURES.index(c) for c in CATEGORICAL], early_stopping=True,
        n_iter_no_change=25, max_iter=800, validation_fraction=0.15, random_state=seed, **GBM_PARAMS)


def train_predict(tables: dict, T: int, tgt_feat):
    """GBM p50 (cents) for tgt_feat's rows, trained on filled rows of every table with first_train_tidx <= tidx < T."""
    require_deps()
    tr = pd.concat([t for k, t in sorted(tables.items()) if k < T], ignore_index=True)
    tr = tr[tr.filled == 1]
    if len(tr) < 200:
        raise CorrectionError(f"only {len(tr)} filled training rows before term index {T}")
    X = tr[FEATURES].replace([np.inf, -np.inf], np.nan)
    Xt = tgt_feat[FEATURES].replace([np.inf, -np.inf], np.nan)
    preds = [np.exp(_reg(s).fit(X, tr.lact).predict(Xt)) for s in SEEDS]
    out = np.mean(preds, axis=0)
    if not np.all(np.isfinite(out)) or np.any(out <= 0):
        raise CorrectionError("GBM produced non-finite or non-positive p50")
    return out


def level_factor(df, tables: dict, T: int, n_prev: int = FACTOR_TERMS):
    """f from the previous <= n_prev terms' out-of-sample predictions; uses only terms before T. Returns (f, info)."""
    lo = first_train_tidx()
    prevs = sorted([t for t in tables if lo < t < T])[-n_prev:]
    if not prevs:
        raise CorrectionError("no earlier term to learn the level factor from")
    act = pred = 0.0
    used = []
    for P in prevs:
        tp = tables[P]
        g = train_predict(tables, P, tp)
        m = (tp.filled == 1).to_numpy()
        act += float(tp.act.to_numpy()[m].sum())
        pred += float(g[m].sum())
        used.append(int(P))
    if pred <= 0:
        raise CorrectionError("level factor denominator is zero")
    return act / pred, {"fromTermIndexes": used}


# ----------------------------------------------------------------------------- rescale
def _row_seed(cn: str, w: str) -> int:
    return 1000 + zlib.crc32(f"{cn}|{w}".encode()) % 1_000_000


def _sim_job(job):
    return fit._sim_one(job)


def rescale_scales(g50: list, base_cond_p50: list, f: float):
    """Per-row multiplier f * g50 / base_cond_p50, or None for rows that cannot be corrected. Returns
    (scales, skipped, outside): skipped = rows with a simulated median whose GBM p50 or factor is unusable (non-finite, outside
    ROW_HARD); outside = rescaled rows beyond ROW_RATIO. Rows with no simulated median (the fit says they never fill) get None
    and count as neither: there is no level to move."""
    scales, skipped, outside = [], 0, 0
    for g, b in zip(g50, base_cond_p50):
        if not b:
            scales.append(None)
            continue
        s = f * g / b if g is not None and math.isfinite(g) and g > 0 else None
        if s is None or not math.isfinite(s) or not (ROW_HARD[0] <= s <= ROW_HARD[1]):
            scales.append(None)
            skipped += 1
            continue
        scales.append(s)
        outside += not (ROW_RATIO[0] <= s <= ROW_RATIO[1])
    return scales, skipped, outside


def gate_check(f: float, scales: list, skipped: int, n_jobs: int, outside: int = 0) -> None:
    """n_jobs = rows that have a simulated median (the ones a rescale is attempted on)."""
    lo, hi = F_RANGE
    if not math.isfinite(f) or not (lo <= f <= hi):
        raise CorrectionError(f"level factor {f!r} outside {F_RANGE}")
    if n_jobs == 0:
        raise CorrectionError("no section/window rows to correct")
    if skipped / n_jobs > MAX_SKIPPED_SHARE:
        raise CorrectionError(f"{skipped}/{n_jobs} rows have no usable rescale (GBM p50 or factor outside {ROW_HARD})")
    if outside / n_jobs > MAX_OUTSIDE_SHARE:
        raise CorrectionError(f"{outside}/{n_jobs} rows rescale by a factor outside {ROW_RATIO}")
    if not any(s is not None for s in scales):
        raise CorrectionError("no row could be rescaled")


def apply_scales(params: dict, keys: list, scales: list) -> dict:
    """Deep copy of params with priceLevelCents multiplied per (class, window); the original value goes to
    priceLevelCentsBase. Nothing else changes."""
    out = json.loads(json.dumps(params))
    for (cn, w), s in zip(keys, scales):
        if s is None:
            continue
        d = out["classes"][cn]["windows"][w]
        d["priceLevelCentsBase"] = d["priceLevelCents"]
        d["priceLevelCents"] = d["priceLevelCents"] * s
    return out


def target_rows(rows: list[dict], term: str, sections: dict, first_window: str, params: dict):
    """Outcome-free target rows: one per current section (with seats left) and window from first_window on."""
    cur = fit.current_sections(rows, term)
    if first_window not in WI:  # a typo or new window name must not silently mean "correct every window"
        raise CorrectionError(f"unknown first window {first_window!r}")
    start = WI[first_window]
    out = []
    for cn, sec in sorted(sections.items()):
        r = cur.get(cn)
        seats, total = sec.get("seats"), sec.get("total")
        if r is None or cn not in params["classes"] or seats is None or seats <= 0:
            continue
        ti, tt = fit.term_index(term)
        for w in fit.WINDOWS[start:]:
            if w not in params["classes"][cn]["windows"]:
                continue
            out.append(dict(term=term, tidx=ti, ttype=int(tt), window=w, widx=WI[w], cls=cn, course=r["course_code"],
                            subject=fit.subject_of(r["course_code"]), section=r["section"], instr=r["instructor"].strip(),
                            slot=fit.slot_key(r["start_times"], r.get("days")), seats=int(seats),
                            cap=int(total or 0), floor=int(params["classes"][cn]["minBidCents"])))
    return out


def apply_correction(params: dict, rows: list[dict], term: str, sections: dict, first_window: str,
                     pool_map=None, runs: int = SIM_RUNS, log=print):
    """Rescale priceLevelCents per section/window. Returns (new_params, info). Raises CorrectionError (gate, data, deps).

    sections: {class_number: {"seats": offered seats now, "total": section capacity}} (the seats the site shows).
    first_window: earlier windows are over, so they stay as fitted.
    pool_map: optional map(fn, jobs) (e.g. Pool.map) for the simulator step; serial by default.
    """
    require_deps()
    t0 = time.perf_counter()
    ti, _ = fit.term_index(term)
    tgt = target_rows(rows, term, sections, first_window, params)
    if not tgt:
        raise CorrectionError("no target rows")
    df = obs_frame(rows)
    cats = _cat_maps(df, [t["subject"] for t in tgt], [t["slot"] for t in tgt])
    tables, _ = feature_tables(df[df.tidx < ti], cats)  # earlier terms only
    # the live term's own earlier-window results enter only through `real` inside features_for
    tf = features_for(df, ti, tgt=pd.DataFrame(tgt), cats=cats)
    f, finfo = level_factor(df, tables, ti)
    g50 = train_predict(tables, ti, tf)
    keys = list(zip(tf.cls, tf.window))
    jobs = [(int(r.seats), int(r.floor), {k: params["classes"][r.cls]["windows"][r.window][k] for k in _SIM_KEYS}, runs,
             _row_seed(r.cls, r.window), 0) for r in tf.itertuples()]
    res = (pool_map or map)(_sim_job, jobs)
    base = [x["cond_p50"] for x in res]
    scales, skipped, outside = rescale_scales(list(g50), base, f)
    nofill = sum(1 for b in base if not b)
    gate_check(f, scales, skipped, len(jobs) - nofill, outside)
    new = apply_scales(params, keys, scales)
    used = [s for s in scales if s is not None]
    info = {"modelVersion": MODEL_VERSION, "f": f, "rows": len(jobs), "rescaled": len(used), "skipped": skipped, "noSimulatedFill": nofill, "outsideSoftBounds": outside,
            "scaleMin": min(used), "scaleMax": max(used), **finfo}
    log(f"correction: f={f:.4f}, rescaled {len(used)}/{len(jobs)} section-windows (skipped {skipped}), "
        f"scale range {info['scaleMin']:.3f}-{info['scaleMax']:.3f}, {nofill} without a simulated fill, "
        f"{outside} beyond {ROW_RATIO}, {time.perf_counter() - t0:.0f} s")
    return new, info


_SIM_KEYS = ("demandMean", "demandDispersion", "priceLevelCents", "priceSigma", "anchorSigma", "anchorShare", "anchorCents")


def try_apply_correction(params: dict, *args, log=print, **kw):
    """apply_correction that never raises: any failure (import, training, gate, bad data) warns and returns the uncorrected params."""
    try:
        new, info = apply_correction(params, *args, log=log, **kw)
        return new, info
    except Exception as e:  # noqa: BLE001 the site build must never fail because of the correction
        print(f"WARNING: forecast correction skipped, using uncorrected params: {type(e).__name__}: {e}", file=sys.stderr)
        return params, None


# ----------------------------------------------------------------------------- backtest of the corrected model
def backtest_corrected(df, tables, all_obs, target_term: str, cfg, pool=None, runs=None):
    """fit.backtest, but with priceLevelCents rescaled by f * gbm_p50 / simulated cond p50 (one step, same seeds as predict_all).
    Returns (summary like fit.summarize, info). Rows outside the rescale bounds keep their fitted price (counted in info)."""
    require_deps()
    runs = runs or cfg.runs
    ti, tt = fit.term_index(target_term)
    targets = [o for o in all_obs if o.term == target_term]
    train = [o for o in all_obs if o.tidx < ti]
    model = fit.Model(train, ti, tt, cfg)
    tf = tables[ti]
    idx = {(c, w): i for i, (c, w) in enumerate(zip(tf.cls, tf.window))}
    if len(idx) != len(tf):
        raise CorrectionError("duplicate (class, window) rows in the target term")
    f, finfo = level_factor(df, tables, ti)
    g_all = train_predict(tables, ti, tf)
    g50 = [float(g_all[idx[(o.cls, o.window)]]) for o in targets]
    sps = [model.params_for(o.course, o.instr, o.window, o.slot, o.floor)[0] for o in targets]
    mapper = pool.map if pool else map
    chunk = {"chunksize": 40} if pool else {}
    base_jobs = [(o.seats, o.floor, sp.to_dict(), runs, 1000 + i, fit.actual_cutoff(o)) for i, (o, sp) in enumerate(zip(targets, sps))]
    base = list(mapper(fit._sim_one, base_jobs, **chunk))
    scales, skipped, outside = rescale_scales(g50, [b["cond_p50"] for b in base], f)
    todo = [i for i, s in enumerate(scales) if s is not None]
    done = list(mapper(fit._sim_one, [(targets[i].seats, targets[i].floor, replace(sps[i], priceLevelCents=sps[i].priceLevelCents * scales[i]).to_dict(),
                                       runs, 1000 + i, fit.actual_cutoff(targets[i])) for i in todo], **chunk))
    preds = list(base)
    for i, r in zip(todo, done):
        preds[i] = r
    nbase = fit.naive_baseline(train, targets)
    clim = {}
    for w in fit.WINDOWS:
        ws = [o for o in model.train if o.window == w]
        clim[w] = (sum(o.w * o.filled for o in ws) / sum(o.w for o in ws)) if ws else 0.2
    summ = fit.summarize(targets, preds, nbase, clim, target_term)
    nofill = sum(1 for b in base if not b["cond_p50"])
    return summ, {"f": f, "rows": len(targets) - nofill, "skipped": skipped, "outside": outside, "noSimulatedFill": nofill, **finfo}


def build_corrected_backtest(rows, backtest: dict, cfg, pool=None, log=print) -> dict:
    """A backtest.json-shaped dict for the corrected model: the fitted backtest with its test-term and held-out figures replaced.
    Gate fields mirror fit.main's forecasts_ok on the test term. Held-out is the honest figure; the test term was also used
    to tune the GBM hyperparameters (see MODEL-IMPROVEMENT-2026-11-09.md), so its figures are optimistic."""
    require_deps()
    floors = fit.course_floors(rows)
    all_obs = fit.build_obs(rows, floors)
    df = obs_frame(rows, floors)
    tables, _ = feature_tables(df)
    out = json.loads(json.dumps(backtest))
    infos = {}
    summ = {}
    for key, term in (("test", backtest["term"]), ("held", (backtest.get("heldOut") or {}).get("term"))):
        if not term:
            raise CorrectionError("backtest.json has no held-out term")
        s, info = backtest_corrected(df, tables, all_obs, term, cfg, pool)
        gate_check(info["f"], [1.0], info["skipped"], info["rows"], info["outside"])  # same sanity gate as the live path
        s.pop("_rows", None)
        summ[key], infos[key] = s, info
        log(f"  corrected backtest {term}: f={info['f']:.4f} mae={s['maeCents']} filledCondMae={s['maeFilledCondCents']} cov80={s['coverage80']} "
            f"covFilled={s['coverage80Filled']} skipped={info['skipped']} outsideSoft={info['outside']}/{info['rows']}")
    test, held = summ["test"], summ["held"]
    b = test["baseline"]
    covered = 0.75 <= test["coverage80"] <= 0.85 and 0.70 <= (test["coverage80Filled"] or 0) <= 0.90
    beats = bool(b) and b["modelMaeOnSameSamples"] < b["maeCents"] and (b["modelMaeFilledCondOnSameSamples"] or 1e9) < (b["maeFilledCents"] or 0)
    for k in ("coverage80", "maeCents", "pairOrder", "medianAbsErrCents", "samples", "byWindow", "calibration", "baseline"):
        out[k] = test[k]
    out["overall"] = {k: v for k, v in test.items() if k not in ("byWindow", "calibration")}
    out["heldOut"] = held
    out["slotAlternative"] = None
    out["calibrationInfo"] = None
    out["modelVersion"] = MODEL_VERSION
    out["correctionOk"] = bool(covered and beats)
    out["correctionGate"] = {"coverageInRange": covered, "beatsBaseline": beats}
    out["correctionInfo"] = {"testTerm": backtest["term"], "heldOutTerm": held["term"], "factors": {k: round(v["f"], 4) for k, v in infos.items()},
                              "gbmParams": GBM_PARAMS, "seeds": list(SEEDS), "firstTrainTerm": FIRST_TRAIN_TERM,
                              "note": "held-out figures are the honest ones; the test term also tuned the GBM hyperparameters"}
    out["sourceConfig"] = backtest.get("config")
    return out


def corrected_backtest_usable(corr: dict | None, backtest: dict) -> str | None:
    """None when the corrected backtest matches the fitted one and passed its gate, else the reason it cannot be used."""
    if not corr:
        return "no corrected backtest"
    if corr.get("modelVersion") != MODEL_VERSION:
        return f"corrected backtest is for {corr.get('modelVersion')!r}, code is {MODEL_VERSION!r}"
    if not corr.get("correctionOk"):
        return "corrected backtest failed its gate"
    if corr.get("term") != backtest.get("term") or (corr.get("heldOut") or {}).get("term") != (backtest.get("heldOut") or {}).get("term"):
        return "corrected backtest covers other terms than backtest.json"
    if corr.get("sourceConfig") != backtest.get("config"):
        return "corrected backtest was made with a different fit config than backtest.json"
    if (corr.get("correctionInfo") or {}).get("gbmParams") != GBM_PARAMS:
        return "corrected backtest used other GBM hyperparameters"
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("backtest", help="write backtest-corrected.json (test and held-out terms) next to backtest.json")
    b.add_argument("--csv", default=fit.default_csv())
    b.add_argument("--fit-out", required=True, help="dir with backtest.json and calibration.json (read); output goes here too unless --out")
    b.add_argument("--out", help="output file (default <fit-out>/backtest-corrected.json)")
    b.add_argument("--procs", type=int, default=os.cpu_count() or 1)
    a = ap.parse_args(argv)
    require_deps()
    with open(os.path.join(a.fit_out, "backtest.json")) as fh:
        backtest = json.load(fh)
    with open(os.path.join(a.fit_out, "calibration.json")) as fh:
        c = json.load(fh)["config"]
    cfg = replace(fit.Config(**{**c, "tau_d": tuple(c["tau_d"]), "tau_p": tuple(c["tau_p"])}), runs=1500)
    if backtest.get("config") and backtest["config"] != json.loads(json.dumps(fit.asdict(cfg))):
        raise SystemExit("calibration.json config differs from backtest.json config; refit first")
    rows = fit.load_rows(a.csv)
    from multiprocessing import Pool
    with Pool(a.procs) as pool:
        corr = build_corrected_backtest(rows, backtest, cfg, pool)
    path = a.out or os.path.join(a.fit_out, CORRECTED_BACKTEST)
    with open(path, "w") as fh:
        json.dump(corr, fh, indent=1)
    print(f"wrote {path}: correctionOk={corr['correctionOk']} gate={corr['correctionGate']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
