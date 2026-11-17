"""Evaluation harness: does each bid style (Cheap / Balanced / Safe) win as often as promised, and at what overpay?

Read-only towards the model: it calls the existing backtest functions and writes only under model/forecast/eval/ (private,
gitignored; dirs 0700, files 0600). It never writes under model/forecast/out/ (it reads calibration.json and distcal.json there).

Rolling origin: every term the corrected model can be backtested on is simulated once (distcal.rows_for_term: fit on earlier
terms, GBM features from earlier terms plus earlier windows of the same term) and cached. Each scored term then gets bids under
three settings ("variants"):

* as_scored  what distcal.json's level table measured: exponents learned on the previous term only, the levels in
             distcal.json, bids NOT rounded. On the held-out term this reproduces distcal.json's `levels` figures.
* shipped    what the site ships today: distcal.json's `exponents` and `levels`, bids rounded the site's way.
* rolled     the production procedure replayed with no look-ahead: exponents learned on the two previous terms, levels picked
             (distcal.pick_levels) on the previous term with exponents from the term before it, bids rounded.

Only `rolled` is out-of-sample on every term. distcal.json's levels were picked on its held-out term and its exponents learned
on its test and held-out terms, so as_scored and shipped look ahead on every term up to and including that held-out term
(`settings[term]["lookAhead"]`); they are honest only on later terms. The pooled report therefore scores `rolled` alone.

Known approximations (they apply to every variant alike): the fit Config and the GBM hyperparameters are today's (tuned on
2024-25 Term 2 and 2025-26 Term 2), not re-tuned per fold; a bid is the mixture quantile on the 99-point conditional grid of
1,500 replays (distcal._uq), where the site inverts a 30,000-run win curve; a row with no simulated fill (no conditional
median; its bid is the floor) is counted in the lowest forecast band. The simulation cache is keyed on the dataset, the config
and the model source files, so it is rebuilt after any change to them.

    python -m model.forecast.evalharness run [--terms N] [--procs N] [--boot N]
    python -m model.forecast.evalharness report            # rebuild the report from the cached simulations
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import math
import os
import time

from . import correction as C
from . import distcal as D
from . import evalscore as S
from . import fit

np = C.np
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")  # read only
EVAL_DIR = os.path.join(HERE, "eval")
STYLES = ("cheap", "balanced", "safe")
VARIANTS = ("as_scored", "shipped", "rolled")
CQ_COLS = (5, 10, 25, 50, 75, 90, 95, 99)  # conditional percentiles kept per row (uncalibrated grid, cents)


# ----------------------------------------------------------------------------- bids
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


def bids_for(rows, table, levels: dict, rounded: bool) -> dict:
    """{style: [bid cents per row]} with distcal's own mixture quantile (p_clf, exponents from `table`)."""
    Q, p, floor, _, _ = D._arrays(rows, table, True)
    out = {}
    for st in STYLES:
        raw = D._uq(Q, p, floor, float(levels[st]))
        out[st] = [site_round(b, f) if rounded else float(b) for b, f in zip(raw, floor)]
    return out


def exps_for(rows, table) -> list:
    return [D.spread_for(table, r["cond_p50"], r["seats"]) if r.get("cond_p50") else (1.0, 1.0) for r in rows]


def rolled_settings(prev: list, prev2: list | None) -> tuple:
    """(exponent table, {style: level}) the production procedure would have shipped for a term, from the rows of the term
    before it (`prev`) and the one before that (`prev2`). With no `prev2` (the first scorable fold) the exponents come from
    `prev` alone and the levels are picked in-sample on `prev`."""
    tab_test = D.learn_spread(prev2 if prev2 else prev)[0]
    tab_final = D.learn_spread((prev2 or []) + prev)[0]
    lv = D.pick_levels(D._level_table(prev, tab_test))
    return tab_final, {st: lv[st]["level"] for st in STYLES}


# ----------------------------------------------------------------------------- inputs and cache
def _private_dir(path: str) -> str:
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)
    return path


def _write(path: str, text: str | bytes) -> None:
    tmp = f"{path}.tmp{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(text if isinstance(text, bytes) else text.encode())
    os.replace(tmp, path)


def load_cfg():
    with open(os.path.join(OUT_DIR, "calibration.json")) as fh:
        return D.cfg_from_config(json.load(fh)["config"])


def load_shipped() -> dict:
    with open(os.path.join(OUT_DIR, D.DISTCAL_FILE)) as fh:
        return json.load(fh)


def _source_hash() -> str:
    h = hashlib.sha256()
    for name in ("fit.py", "sim.py", "correction.py", "distcal.py"):
        with open(os.path.join(HERE, name), "rb") as fh:
            h.update(fh.read())
    return h.hexdigest()


def cache_key(csv_path: str, cfg) -> str:
    st = os.stat(csv_path)
    ident = [os.path.abspath(csv_path), st.st_size, int(st.st_mtime), fit.asdict(cfg), C.MODEL_VERSION, D.DISTCAL_VERSION,
             C.GBM_PARAMS, list(C.SEEDS), C.FIRST_TRAIN_TERM, _source_hash()]
    return hashlib.sha256(json.dumps(ident, sort_keys=True, default=str).encode()).hexdigest()[:12]


def _cache_path(term: str, key: str) -> str:
    return os.path.join(EVAL_DIR, "cache", f"simrows-{term.replace(' ', '_')}-{key}.json.gz")


def load_cached(term: str, key: str):
    try:
        with gzip.open(_cache_path(term, key), "rt") as fh:
            rows = json.load(fh)
    except (OSError, ValueError, EOFError):
        return None
    for r in rows:
        if r["p_clf"] is None:
            r["p_clf"] = float("nan")
    return rows


def save_cached(term: str, key: str, rows) -> None:
    _private_dir(os.path.join(EVAL_DIR, "cache"))
    safe = [{k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in r.items()} for r in rows]
    _write(_cache_path(term, key), gzip.compress(json.dumps(safe, default=float).encode()))


def backtestable_terms(tables: dict, all_obs) -> list:
    """Terms with a feature table, oldest first (tables only holds terms from correction.FIRST_TRAIN_TERM on)."""
    names = {o.tidx: o.term for o in all_obs}
    return [names[k] for k in sorted(tables) if k in names]


def simulate_terms(terms, df, tables, all_obs, cfg, key: str, pool=None, log=print) -> dict:
    """{term: rows} from the cache or one distcal.rows_for_term pass each. A term the corrected model cannot be backtested on
    (too little history) is left out."""
    out = {}
    for t in terms:
        rows = load_cached(t, key)
        if rows is None:
            t0 = time.time()
            try:
                rows = D.rows_for_term(df, tables, all_obs, t, cfg, pool)
            except C.CorrectionError as e:
                log(f"  {t}: not backtestable ({e})")
                continue
            save_cached(t, key, rows)
            log(f"  {t}: simulated {len(rows)} rows in {time.time() - t0:.0f} s")
        else:
            log(f"  {t}: {len(rows)} rows from cache")
        out[t] = rows
    return out


# ----------------------------------------------------------------------------- evaluation rows
def eval_rows(sim: dict, order: list, shipped: dict, schools: dict, n_terms: int) -> tuple:
    """(rows, settings): one flat row per section-window of the last `n_terms` scorable terms (a term is scorable when the
    term before it was simulated), with every variant's bids; settings records what each variant used per term."""
    have = [t for t in order if t in sim]
    scorable = [t for t in have if order.index(t) > 0 and order[order.index(t) - 1] in sim][-n_terms:]
    ship_levels = {st: shipped["levels"][st]["level"] for st in STYLES}
    held = (shipped.get("terms") or {}).get("heldOut")
    held_i = order.index(held) if held in order else len(order)
    out, settings = [], {}
    for t in scorable:
        i = order.index(t)
        prev = sim[order[i - 1]]
        prev2 = sim.get(order[i - 2]) if i >= 2 else None
        tab_as = D.learn_spread(prev)[0]
        tab_roll, lv_roll = rolled_settings(prev, prev2)
        use = {"as_scored": (tab_as, ship_levels, False), "shipped": (shipped["exponents"], ship_levels, True),
               "rolled": (tab_roll, lv_roll, True)}
        rows = sim[t]
        bids = {v: bids_for(rows, *use[v]) for v in VARIANTS}
        exps = {v: exps_for(rows, use[v][0]) for v in VARIANTS}
        ahead = i <= held_i  # distcal.json's levels and exponents come from this term or later ones
        settings[t] = {"n": len(rows), "windows": sorted({r["window"] for r in rows}, key=fit.WINDOWS.index), "lookAhead": {"as_scored": ahead, "shipped": ahead, "rolled": False}, "rolledExponentTerms": [x for x in (order[i - 2] if prev2 else None, order[i - 1]) if x],
                       "rolledLevelsPickedOn": order[i - 1], "rolledLevelsInSample": prev2 is None,
                       "levels": {"as_scored": ship_levels, "shipped": ship_levels, "rolled": lv_roll},
                       "globalExponents": {v: use[v][0]["global"] for v in VARIANTS}}
        for j, r in enumerate(rows):
            m = r.get("cond_p50")
            row = {"term": t, "window": r["window"], "course": r["course"], "section": r["section"], "cls": r["cls"],
                   "seats": int(r["seats"]), "school": schools.get((t, r["cls"])) or schools.get(r["course"], ""),
                   "band": D._band(m) if m else 0, "p_fill": r["p_clf"], "p_sim": r["pfill"], "filled": int(r["filled"]),
                   "act": int(r["act"]), "floor": int(r["floor"])}
            cq = r.get("cq")
            for c in CQ_COLS:
                row[f"cq{c:02d}"] = cq[c - 1] if cq else None
            for v in VARIANTS:
                row[f"lo_{v}"], row[f"hi_{v}"] = exps[v][j]
                for st in STYLES:
                    row[f"bid_{v}_{st}"] = bids[v][st][j]
            out.append(row)
    return out, settings


def school_map(csv_rows) -> dict:
    """{(term, class number): school} plus {course: school} as a fallback (the last one seen)."""
    m = {}
    for r in csv_rows:
        if r.get("school"):
            m[(r["term"], r["class_number"])] = r["school"]
            m[r["course_code"]] = r["school"]
    return m


def write_rows_csv(path: str, rows) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    w.writeheader()
    for r in rows:
        w.writerow({k: ("" if v is None or (isinstance(v, float) and math.isnan(v)) else v) for k, v in r.items()})
    _write(path, buf.getvalue())


# ----------------------------------------------------------------------------- report
def build_reports(rows, settings: dict, shipped: dict, n_boot: int) -> tuple:
    """(json dict, markdown). Pooled over all scored terms, then per term (variant in-sample flags are in `settings`)."""
    displayed = {st: shipped["levels"][st]["level"] for st in STYLES}
    held = (shipped.get("terms") or {}).get("heldOut")
    most = max(len(s["windows"]) for s in settings.values())
    partial = sorted(t for t, s in settings.items() if len(s["windows"]) < most)  # a term still in progress: early windows only
    for t, s in settings.items():
        s["partial"] = t in partial
    # rolled is the only variant with no look-ahead on every term; partial terms would tilt the pool towards Round 1
    pooled = S.build_report([r for r in rows if r["term"] not in partial], ["rolled"], n_boot=n_boot)
    rep = {"createdAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "modelVersion": C.MODEL_VERSION, "distcalVersion": D.DISTCAL_VERSION,
           "shippedGateOk": bool(shipped.get("ok")), "settings": settings, "pooledExcludes": partial, "pooled": pooled, "terms": {}}
    md = [S.render_markdown(pooled, "Complete scored terms pooled, rolled settings only (no look-ahead in exponents or levels; the fit config "
                            "and GBM hyperparameters are today's, tuned on terms inside the pool; levels differ per term)")]
    if partial:
        md.append(f"Left out of the pool (not all windows have results yet): {', '.join(partial)}.")
    if not shipped.get("ok"):
        md.insert(0, "distcal.json failed its gate: the site ships the plain fit, not the `shipped` settings scored here.")
    for t in sorted(settings, key=lambda x: fit.term_index(x)[0], reverse=True):
        tr = S.build_report([r for r in rows if r["term"] == t], list(VARIANTS), n_boot=n_boot)
        rep["terms"][t] = tr
        ahead = [v for v in VARIANTS if settings[t]["lookAhead"][v]]
        note = (" (partial term)" if settings[t]["partial"] else "") + (" (held-out term of distcal.json)" if t == held else "") + (f"; look-ahead: {', '.join(ahead)}" if ahead else "; all variants out-of-sample")
        md.append(S.render_markdown(tr, f"{t}{note}") + "\n\nLevels: as_scored and shipped " + json.dumps(displayed) + "; rolled " + json.dumps(settings[t]["levels"]["rolled"]))
    return rep, "\n\n".join(md) + "\n"


def run(n_terms: int = 6, procs: int | None = None, n_boot: int = 1000, simulate: bool = True, log=print) -> dict:
    os.umask(0o077)
    C.require_deps()
    _private_dir(EVAL_DIR)
    cfg, shipped = load_cfg(), load_shipped()
    csv_path = fit.default_csv()
    csv_rows = fit.load_rows(csv_path)
    floors = fit.course_floors(csv_rows)
    all_obs = fit.build_obs(csv_rows, floors)
    df = C.obs_frame(csv_rows, floors)
    tables, _ = C.feature_tables(df)
    order = backtestable_terms(tables, all_obs)
    key = cache_key(csv_path, cfg)
    log(f"dataset {csv_path}\ncache key {key}; terms {order}")
    want = order[-(n_terms + 2):]  # the scored terms plus the two before, for the rolled exponents
    if simulate:
        from multiprocessing import Pool
        with Pool(procs or os.cpu_count() or 1) as pool:
            sim = simulate_terms(want, df, tables, all_obs, cfg, key, pool, log)
    else:
        sim = {t: r for t in want if (r := load_cached(t, key)) is not None}
    rows, settings = eval_rows(sim, order, shipped, school_map(csv_rows), n_terms)
    if not rows:
        raise SystemExit("no scorable term (run with simulation first)")
    stamp = time.strftime("%Y%m%dT%H%M%S")
    rep, md = build_reports(rows, settings, shipped, n_boot)
    rep.update(dataset=csv_path, cacheKey=key)
    paths = {k: os.path.join(EVAL_DIR, f"{k}-{stamp}.{ext}") for k, ext in (("rows", "csv"), ("report", "json"), ("report-md", "md"))}
    write_rows_csv(paths["rows"], rows)
    _write(paths["report"], json.dumps(rep, indent=1))
    _write(paths["report-md"], md)
    log(f"{len(rows)} rows over {list(settings)} -> {paths['rows']}\nreport -> {paths['report-md']}")
    return {"paths": paths, "report": rep}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=("run", "report"))
    ap.add_argument("--terms", type=int, default=6, help="how many of the latest scorable terms to score")
    ap.add_argument("--procs", type=int, default=None)
    ap.add_argument("--boot", type=int, default=1000, help="bootstrap replicates (over courses)")
    a = ap.parse_args(argv)
    run(a.terms, a.procs, a.boot, simulate=a.cmd == "run")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
