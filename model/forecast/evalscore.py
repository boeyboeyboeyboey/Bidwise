"""Score evaluation-harness rows: win/loss and overpay per bid style, cluster-bootstrap CIs, fill reliability.

Pure functions, no I/O. Money in rows is integer cents; reported money is e$ (cents / 100).
"""
from __future__ import annotations

import math

import numpy as np

from .fit import WINDOWS

STYLES = ("cheap", "balanced", "safe")
BUDGET_CENTS = 12500
SEAT_CLASSES = ("1", "2-3", "4+")
WINDOW_GROUPS = ("R1W1", "R1A", "R1B", "R2", "R2A")
BAND_LABELS = ("<15", "15-25", "25-40", "40-60", "60+")
SPLITS = ("window_group", "seat_class", "band", "school", "term", "window")


def _r(x):
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) else round(x, 4)


def seat_class(seats: int) -> str:
    return "1" if seats <= 1 else "2-3" if seats <= 3 else "4+"


def window_group(window: str) -> str:
    try:
        i = WINDOWS.index(window)
    except ValueError:
        return "other"
    return "R1W1" if i == 0 else "R1A" if i <= 3 else "R1B" if i <= 5 else "R2" if i <= 8 else "R2A"


def band_label(band: int) -> str:
    return BAND_LABELS[int(band)]


def split_key(row: dict, by: str) -> str:
    if by == "window_group":
        return window_group(row["window"])
    if by == "seat_class":
        return seat_class(int(row["seats"]))
    if by == "band":
        return band_label(row["band"])
    if by == "school":
        return row.get("school") or "(none)"
    if by in ("term", "window"):
        return str(row[by])
    raise ValueError(f"unknown split: {by}")


def _sort_order(by: str, key: str):
    fixed = {"window_group": WINDOW_GROUPS + ("other",), "seat_class": SEAT_CLASSES, "band": BAND_LABELS}.get(by)
    return (fixed.index(key), "") if fixed else (0, key)


def _arrays(rows, variant, style):
    col = f"bid_{variant}_{style}"
    bid = np.array([r[col] for r in rows], dtype=float)
    act = np.array([r["act"] for r in rows], dtype=float)
    filled = np.array([int(r["filled"]) == 1 for r in rows], dtype=bool)
    return bid, act, filled


def _mean(a):
    return _r(a.mean()) if a.size else None


def style_metrics(rows, variant: str, style: str) -> dict:
    rows = list(rows)
    bid, act, filled = _arrays(rows, variant, style)
    win = bid >= act
    n, nf = len(rows), int(filled.sum())
    won_f = filled & win
    over_won = (bid[won_f] - act[won_f]) / 100
    win_f = _mean(win[filled].astype(float))
    return {
        "n": n,
        "nFilled": nf,
        "winFilled": win_f,
        "lossFilled": None if win_f is None else _r(1 - win[filled].mean()),
        "winAll": _mean(win.astype(float)),
        "overpayAllMean": _mean(np.maximum(bid - act, 0) / 100),
        "overpayWonFilled": {
            "n": int(won_f.sum()),
            "mean": _mean(over_won),
            "median": _r(np.median(over_won)) if over_won.size else None,
            "p90": _r(np.percentile(over_won, 90)) if over_won.size else None,
        },
        "bidMean": _mean(bid / 100),
        "bidMedian": _r(np.median(bid / 100)) if n else None,
        "bidMeanFilled": _mean(bid[filled] / 100),
        "budgetShareMean": _mean(bid / BUDGET_CENTS),
        "budgetShareFilled": _mean(bid[filled] / BUDGET_CENTS),
        "budgetShareWon": _mean(bid[win] / BUDGET_CENTS),  # lost bids are refunded, so only won bids consume e$
        "shareOverBudget": _mean((bid > BUDGET_CENTS).astype(float)),
    }


def bootstrap_ci(rows, variant: str, style: str, n_boot: int = 1000, seed: int = 0, level: float = 0.90) -> dict:
    """Cluster bootstrap: whole courses are resampled with replacement, so all of a course's rows move together."""
    rows = list(rows)
    courses = sorted({r["course"] for r in rows})
    out = {"winFilled": None, "winAll": None, "overpayAllMean": None, "nCourses": len(courses)}
    if not rows:
        return out
    idx = {c: i for i, c in enumerate(courses)}
    ci = np.array([idx[r["course"]] for r in rows])
    bid, act, filled = _arrays(rows, variant, style)
    win = (bid >= act).astype(float)
    k = len(courses)
    sums = {
        "wf": np.bincount(ci, win * filled, k), "nf": np.bincount(ci, filled.astype(float), k),
        "w": np.bincount(ci, win, k), "n": np.bincount(ci, None, k).astype(float),
        "ov": np.bincount(ci, np.maximum(bid - act, 0) / 100, k),
    }
    rng = np.random.default_rng(seed)
    W = rng.multinomial(k, np.full(k, 1.0 / k), size=n_boot).astype(float)
    ws = {key: W @ v for key, v in sums.items()}
    q = [(1 - level) / 2 * 100, (1 + level) / 2 * 100]

    def interval(num, den):
        d = ws[den]
        ok = d > 0
        if not ok.any():
            return None
        lo, hi = np.percentile(ws[num][ok] / d[ok], q)
        return [_r(lo), _r(hi)]

    out["winFilled"] = interval("wf", "nf")
    out["winAll"] = interval("w", "n")
    out["overpayAllMean"] = interval("ov", "n")
    return out


def fill_reliability(rows, bins: int = 10) -> dict:
    pairs = [(float(r["p_fill"]), int(r["filled"])) for r in rows
             if r.get("p_fill") is not None and not math.isnan(float(r["p_fill"]))]
    if not pairs:
        return {"n": 0, "brier": None, "ece": None, "bins": []}
    p = np.array([a for a, _ in pairs])
    y = np.array([b for _, b in pairs], dtype=float)
    b = np.minimum(np.floor(p * bins).astype(int), bins - 1)
    out_bins, ece = [], 0.0
    for i in range(bins):
        m = b == i
        if not m.any():
            continue
        mp, ob = p[m].mean(), y[m].mean()
        ece += m.sum() * abs(mp - ob)
        out_bins.append({"lo": _r(i / bins), "hi": _r((i + 1) / bins), "n": int(m.sum()), "meanPred": _r(mp), "observed": _r(ob)})
    return {"n": len(p), "brier": _r(((p - y) ** 2).mean()), "ece": _r(ece / len(p)), "bins": out_bins}


def fill_by(rows, by: str) -> list[dict]:
    """Fill-chance calibration per split key: mean predicted vs observed fill rate, Brier and ECE."""
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(split_key(r, by), []).append(r)
    out = []
    for key in sorted(groups, key=lambda k: _sort_order(by, k)):
        f = fill_reliability(groups[key])
        n = f["n"]
        pred = sum(b["meanPred"] * b["n"] for b in f["bins"]) / n if n else None
        obs = sum(b["observed"] * b["n"] for b in f["bins"]) / n if n else None
        out.append({"key": key, "n": n, "meanPred": _r(pred), "observed": _r(obs), "brier": f["brier"], "ece": f["ece"]})
    return out


def split_report(rows, variant: str, by: str, min_filled: int = 0, n_boot: int = 0, seed: int = 0) -> list[dict]:
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(split_key(r, by), []).append(r)
    out = []
    for key in sorted(groups, key=lambda k: _sort_order(by, k)):
        g = groups[key]
        entry = {"key": key, **{s: style_metrics(g, variant, s) for s in STYLES}}
        if entry[STYLES[0]]["nFilled"] < min_filled:
            entry["small"] = True
        if n_boot > 0:
            entry["ci"] = {s: bootstrap_ci(g, variant, s, n_boot, seed) for s in STYLES}
        out.append(entry)
    return out


def build_report(rows, variants: list[str], n_boot: int = 1000, seed: int = 0, targets: dict | None = None,
                 min_filled: int = 30) -> dict:
    rows = list(rows)
    rep = {
        "n": len(rows),
        "nFilled": sum(int(r["filled"]) == 1 for r in rows),
        "terms": sorted({str(r["term"]) for r in rows}),
        "fill": fill_reliability(rows),
        "variants": {},
    }
    if targets:
        rep["displayed"] = {s: _r(v) for s, v in targets.items()}
    names = {"byTerm": "term", "byWindowGroup": "window_group", "bySeatClass": "seat_class", "byBand": "band", "bySchool": "school"}
    rep["fillBy"] = {name: fill_by(rows, by) for name, by in names.items()}
    for v in variants:
        vr = {"overall": {s: {**style_metrics(rows, v, s), "ci": bootstrap_ci(rows, v, s, n_boot, seed)} for s in STYLES}}
        for name, by in names.items():
            vr[name] = split_report(rows, v, by, min_filled=min_filled, n_boot=n_boot, seed=seed)
        rep["variants"][v] = vr
    return rep


def _pct(x):
    return "-" if x is None else f"{x * 100:.1f}"


def _money(x):
    return "-" if x is None else f"{x:.2f}"


def _with_ci(x, ci, fmt):
    return fmt(x) if not ci else f"{fmt(x)} ({fmt(ci[0])}-{fmt(ci[1])})"


def _table(head, rows):
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    return lines + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]


def render_markdown(report: dict, title: str = "") -> str:
    out = [f"# {title}", ""] if title else []
    disp = report.get("displayed") or {}
    out.append(f"Rows {report['n']}, filled {report['nFilled']}, terms {', '.join(report['terms'])}.")
    for v, vr in report["variants"].items():
        out += ["", f"## {v}", ""]
        head = (["style"] + (["displayed %"] if disp else []) +
                ["win filled % (CI)", "win all % (CI)", "loss filled %", "overpay all e$ (CI)",
                 "overpay won mean e$", "median e$", "p90 e$", "mean bid e$", "share of e$125 %", "share on won bids %"])
        body = []
        for s in STYLES:
            m = vr["overall"][s]
            ci = m.get("ci") or {}
            ow = m["overpayWonFilled"]
            body.append([s] + ([_pct(disp.get(s))] if disp else []) + [
                _with_ci(m["winFilled"], ci.get("winFilled"), _pct), _with_ci(m["winAll"], ci.get("winAll"), _pct),
                _pct(m["lossFilled"]), _with_ci(m["overpayAllMean"], ci.get("overpayAllMean"), _money),
                _money(ow["mean"]), _money(ow["median"]), _money(ow["p90"]), _money(m["bidMean"]), _pct(m["budgetShareMean"]), _pct(m.get("budgetShareWon"))])
        out += _table(head, body)
        for name in ("byTerm", "byWindowGroup", "bySeatClass", "byBand", "bySchool"):
            head = ["key", "n", "nFilled"] + [f"{s} {c}" for s in STYLES for c in ("win filled %", "overpay e$")]
            body = []
            for e in vr[name]:
                first = e[STYLES[0]]
                body.append([e["key"] + ("*" if e.get("small") else ""), first["n"], first["nFilled"]] +
                            [x for s in STYLES for x in (_pct(e[s]["winFilled"]), _money(e[s]["overpayAllMean"]))])
            out += ["", f"### {name}", ""] + _table(head, body)
        if any(e.get("small") for name in ("byTerm", "byWindowGroup", "bySeatClass", "byBand", "bySchool") for e in vr[name]):
            out += ["", "* few filled rows"]
    f = report["fill"]
    out += ["", "## Fill reliability", "", f"n {f['n']}, Brier {_r(f['brier'])}, ECE {_r(f['ece'])}", ""]
    out += _table(["bin", "n", "predicted %", "observed %"],
                  [[f"{b['lo']:.1f}-{b['hi']:.1f}", b["n"], _pct(b["meanPred"]), _pct(b["observed"])] for b in f["bins"]])
    for name, entries in (report.get("fillBy") or {}).items():
        out += ["", f"### fill {name}", ""]
        out += _table(["key", "n", "predicted %", "observed %", "Brier", "ECE"],
                      [[e["key"], e["n"], _pct(e["meanPred"]), _pct(e["observed"]), e["brier"], e["ece"]] for e in entries])
    return "\n".join(out) + "\n"
