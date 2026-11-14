"""Fit SimParams per (course, instructor, window) with partial pooling, backtest, write JSON.

Run:  python -m model.forecast.fit [--csv <dataset>/bids_with_schedule.csv] --out model/forecast/out
      (--csv defaults to data/current.json's dataset + /bids_with_schedule.csv, else the 2026-11-05-full dataset)

Model (see README block at the bottom of this docstring for the facts used):
  demand   N ~ NegBin(mean lambda, dispersion r).  Unfilled section (after>0): N = successful (exact).
           Filled (after==0): N >= seats offered (right-censored).  Posterior of log(lambda) on a grid,
           log-likelihood = exact NB pmf or NB survival term, shrunk through
           global -> subject -> course -> course x instructor with log-normal priors (tau per level).
  price    a share q of bidders sits at the floor (anchorShare, anchorCents=min bid).  The rest bid
           lognormal(median m, sigma).  A filled section's clearing bid is the seats-th highest bid, so
           log(clearing) - sigma*z(seats, N_hat) ~ N(log m, s^2); clearing at the floor is left-censored.
           Posterior of log m on a grid with the same hierarchy (Tobit likelihood).
  time     optional slot effect (early <=08:30 / mid / late >=18:00) on log lambda and log m.
Terms: only "Term 1/2" are used (3A/3B are tiny); windows are matched on the exact BOSS label.
"""
from __future__ import annotations

import argparse
import bisect
import csv
import json
import math
import os
import random
import re
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, field, replace
from multiprocessing import Pool
from statistics import NormalDist

from .sim import SimParams, calibrate_filled, mixture_quantile, sample_cutoffs

ND = NormalDist()
WINDOWS = [
    "Round 1 Window 1", "Round 1A Window 1", "Round 1A Window 2", "Round 1A Window 3", "Round 1B Window 1", "Round 1B Window 2",
    "Round 2 Window 1", "Round 2 Window 2", "Round 2 Window 3",
    "Round 2A Window 1", "Round 2A Window 2", "Round 2A Window 3",
]
STEP = 0.1
LAM_GRID = [math.log(0.02) + STEP * j for j in range(108)]  # log lambda
LAMS = [math.exp(x) for x in LAM_GRID]
PSTEP = 0.05
PRICE_GRID = [math.log(500) + PSTEP * j for j in range(90)]  # log cents
SLOTS = ("early", "mid", "late", "early_fri", "mid_fri", "late_fri")  # time bucket (+ "_fri" for a Friday start)
LEVELS = ("g", "s", "c", "ci")


# ----------------------------------------------------------------------------- data
@dataclass
class Obs:
    term: str
    tidx: int
    ttype: str
    window: str
    cls: str
    course: str
    subject: str
    section: str
    instr: str
    seats: int
    succ: int
    filled: bool
    med: int  # cents, 0 when none
    mn: int
    floor: int
    slot: str  # time bucket + "_fri" when the section meets on a Friday (BOSS lists days alphabetically, so FRI is first)
    w: float = 1.0


def term_index(term: str):
    m = re.match(r"(\d{4})-\d{2} Term ([12])$", term)
    if not m:
        return None
    return 2 * int(m.group(1)) + int(m.group(2)) - 1, m.group(2)


def slot_of(start_times: str) -> str:
    first = (start_times or "").split(";")[0].strip()
    m = re.match(r"(\d{1,2}):(\d{2})", first)
    if not m:
        return "mid"
    mins = int(m.group(1)) * 60 + int(m.group(2))
    return "early" if mins <= 8 * 60 + 30 else "late" if mins >= 18 * 60 else "mid"


def slot_key(start_times: str, days: str) -> str:
    return slot_of(start_times) + ("_fri" if (days or "").split(";")[0].strip().upper() == "FRI" else "")


def subject_of(code: str) -> str:
    return re.sub(r"\d.*$", "", code)


def cents(x: str) -> int:
    return int(round(float(x) * 100)) if x not in ("", None) else 0


def course_floors(rows) -> dict:
    """Min allowed bid per course.  1000 unless the course's lowest real min bid is e$11-20 and at
    least 3 rows sit within a cent of it (e.g. the official e$11.10 example); a hot course whose
    only observed minimums are high clearing prices therefore keeps the e$10 floor."""
    vals = defaultdict(list)
    for r in rows:
        if r["no_bids"] == "0" and r["min_bid"]:
            v = cents(r["min_bid"])
            if v > 0:
                vals[r["course_code"]].append(v)
    out = {}
    for c, vs in vals.items():
        low = min(vs)
        out[c] = low if 1100 <= low <= 2000 and sum(1 for v in vs if v <= low + 1) >= 3 else 1000
    return out


def default_csv() -> str:
    """data/current.json's dataset + /bids_with_schedule.csv; the old fixed dataset only if current.json is missing."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    try:
        with open(os.path.join(root, "data/current.json")) as f:
            return os.path.join(root, json.load(f)["dataset"], "bids_with_schedule.csv")
    except (OSError, ValueError, KeyError, TypeError):
        return os.path.join(root, "data/derived-captures-2026-11-05-full/bids_with_schedule.csv")


def load_rows(path: str) -> list:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def build_obs(rows, floors=None) -> list:
    floors = floors or course_floors(rows)
    out = []
    for r in rows:
        ti = term_index(r["term"])
        if ti is None or r["window"] not in WINDOWS:
            continue
        try:
            before, after = int(r["before_process_vacancy"]), int(r["after_process_vacancy"])
        except ValueError:
            continue
        if before <= 0 or after < 0 or after > before:
            continue
        filled = after == 0
        if filled and r["no_bids"] == "1":
            continue  # inconsistent row (none observed in practice)
        out.append(Obs(
            term=r["term"], tidx=ti[0], ttype=ti[1], window=r["window"], cls=r["class_number"],
            course=r["course_code"], subject=subject_of(r["course_code"]), section=r["section"],
            instr=r["instructor"].strip(), seats=before, succ=before - after, filled=filled,
            med=cents(r["median_bid"]), mn=cents(r["min_bid"]) if r["no_bids"] == "0" else 0,
            floor=floors.get(r["course_code"], 1000), slot=slot_key(r["start_times"], r.get("days")),
        ))
    return out


# ----------------------------------------------------------------------------- pooling primitives
def pool_weight(n: float, kappa: float) -> float:
    """Share of a group's own estimate in a shrinkage average: n / (n + kappa)."""
    return n / (n + kappa) if n + kappa > 0 else 0.0


def obs_weight(age_years: float, same_type: bool, decay: float, cross_w: float) -> float:
    return (decay ** max(0.0, age_years)) * (1.0 if same_type else cross_w)


def censored_demand(o: Obs):
    """('exact', N) for an unfilled section; ('atleast', seats) when it filled (N >= seats)."""
    return ("atleast", o.seats) if o.filled else ("exact", o.succ)


class Post:
    __slots__ = ("mean_x", "sd_x", "mean_exp", "n", "wsum")

    def __init__(self, mean_x, sd_x, mean_exp, n=0, wsum=0.0):
        self.mean_x, self.sd_x, self.mean_exp, self.n, self.wsum = mean_x, sd_x, mean_exp, n, wsum


def grid_posterior(ll, grid, mu, tau, n=0, wsum=0.0) -> Post:
    lp = [l - 0.5 * ((x - mu) / tau) ** 2 for l, x in zip(ll, grid)]
    mx = max(lp)
    w = [math.exp(v - mx) for v in lp]
    z = sum(w)
    mean = sum(wi * x for wi, x in zip(w, grid)) / z
    var = sum(wi * (x - mean) ** 2 for wi, x in zip(w, grid)) / z
    me = sum(wi * math.exp(x) for wi, x in zip(w, grid)) / z
    return Post(mean, math.sqrt(var), me, n, wsum)


class NBTables:
    """Log pmf / log survival of NegBin(lambda_j, r) over the lambda grid, cached per count."""

    def __init__(self, r: float):
        self.r = r
        self._pm, self._sf = {}, {}

    def logpmf(self, c: int):
        v = self._pm.get(c)
        if v is None:
            r = self.r
            lg = math.lgamma(c + r) - math.lgamma(r) - math.lgamma(c + 1)
            v = [lg + r * math.log(r / (r + l)) + c * math.log(l / (r + l)) for l in LAMS]
            self._pm[c] = v
        return v

    def logsf(self, s: int):
        """log P(N >= s)."""
        v = self._sf.get(s)
        if v is None:
            r = self.r
            v = []
            for l in LAMS:
                p0 = (r / (r + l)) ** r
                ratio = l / (r + l)
                cdf, p = 0.0, p0
                for j in range(s):
                    cdf += p
                    p *= (j + r) / (j + 1) * ratio
                v.append(math.log(max(1.0 - cdf, 1e-300)))
            self._sf[s] = v
        return v


def nb_tail_mean(lam: float, r: float, s: int) -> float:
    """E[N | N >= s] for NegBin(lam, r)."""
    ratio = lam / (r + lam)
    p = (r / (r + lam)) ** r
    num = den = 0.0
    cdf = 0.0
    for j in range(s):
        cdf += p
        p *= (j + r) / (j + 1) * ratio
    sf = max(1.0 - cdf, 1e-12)
    j = s
    for _ in range(2000):
        num += j * p
        den += p
        p *= (j + r) / (j + 1) * ratio
        j += 1
        if den >= sf * 0.9999 or p < 1e-14:
            break
    return num / den if den > 0 else float(s)


# ----------------------------------------------------------------------------- config
@dataclass
class Config:
    decay: float = 0.7  # per year
    cross_w: float = 0.5  # weight of the other term type (T1 when predicting T2)
    tau_d: tuple = (3.0, 1.0, 0.9, 0.7)  # prior sd of log lambda around parent: g, s, c, ci
    tau_p: tuple = (3.0, 0.5, 0.4, 0.3)  # same for log price level
    dispersion: float = 1.0  # NB size r
    obs_sd: float = 0.0  # 0 -> estimate from data
    price_scale: float = 1.0
    level_sd: float = 0.2  # extra term-to-term sd of the price level (-> anchorSigma)
    use_slot: bool = True
    anchor_share: float = -1.0  # <0 -> estimate per window
    runs: int = 1000


# ----------------------------------------------------------------------------- model
class Model:
    def __init__(self, train, target_tidx: int, target_ttype: str, cfg: Config):
        self.cfg = cfg
        self.target_tidx = target_tidx
        self.train = []
        for o in train:
            if o.tidx >= target_tidx:
                continue
            o = replace(o, w=obs_weight((target_tidx - o.tidx) / 2, o.ttype == target_ttype, cfg.decay, cfg.cross_w))
            if o.w > 1e-3:
                self.train.append(o)
        self.tabs = NBTables(cfg.dispersion)
        self.beta_d, self.beta_p = ({s: 0.0 for s in SLOTS}, {s: 0.0 for s in SLOTS})
        self.beta_w = {}  # window -> (beta_d, beta_p)
        if cfg.use_slot:
            self.beta_d, self.beta_p = estimate_slot_effects(self.train)
            self.beta_w = estimate_slot_effects_by_window(self.train, self.beta_d, self.beta_p)
        self.groups = defaultdict(list)
        for o in self.train:
            for lv in LEVELS:
                self.groups[self.key(lv, o.window, o.subject, o.course, o.instr)].append(o)
        self._dpost, self._ppost, self._zc = {}, {}, {}
        self._fit_price_globals()

    @staticmethod
    def key(lv, window, subject, course, instr):
        if lv == "g":
            return ("g", window)
        if lv == "s":
            return ("s", window, subject)
        if lv == "c":
            return ("c", window, course)
        return ("ci", window, course, instr)

    @staticmethod
    def parent(k, subject_of_course):
        if k[0] == "ci":
            return ("c", k[1], k[2])
        if k[0] == "c":
            return ("s", k[1], subject_of(k[2]))
        if k[0] == "s":
            return ("g", k[1])
        return None

    def _beta_d(self, slot, window):
        return self.beta_w.get(window, (self.beta_d, self.beta_p))[0].get(slot, 0.0)

    def _beta_p(self, slot, window):
        return self.beta_w.get(window, (self.beta_d, self.beta_p))[1].get(slot, 0.0)

    def _shift(self, slot, window):
        return int(round(self._beta_d(slot, window) / STEP))

    # ---- demand
    def dpost(self, k) -> Post:
        p = self._dpost.get(k)
        if p is not None:
            return p
        lv = k[0]
        par = self.parent(k, None)
        mu = math.log(5.0) if par is None else self.dpost(par).mean_x
        ll = [0.0] * len(LAM_GRID)
        obs = self.groups.get(k, [])
        G = len(LAM_GRID)
        for o in obs:
            kind, v = censored_demand(o)
            tab = self.tabs.logpmf(v) if kind == "exact" else self.tabs.logsf(v)
            sh = self._shift(o.slot, o.window)
            for j in range(G):
                jj = j + sh
                ll[j] += o.w * tab[0 if jj < 0 else G - 1 if jj >= G else jj]
        p = grid_posterior(ll, LAM_GRID, mu, self.cfg.tau_d[LEVELS.index(lv)], len(obs), sum(o.w for o in obs))
        self._dpost[k] = p
        return p

    # ---- price
    def _nhat_z(self, o: Obs, q: float):
        ck = (o.window, o.course, o.seats, q)
        hit = self._zc.get(ck)
        if hit is None:
            hit = self._zc[ck] = self._nhat_z_raw(o, q)
        return hit

    def _nhat_z_raw(self, o: Obs, q: float):
        lam = self.dpost(self.key("c", o.window, o.subject, o.course, o.instr)).mean_exp
        nh = max(float(o.seats), nb_tail_mean(lam, self.cfg.dispersion, o.seats))
        ns = (1 - q) * nh
        pz = lambda k: ND.inv_cdf(min(0.98, max(0.02, (ns - k + 0.625) / (ns + 0.25))))
        return pz(o.seats), pz((o.seats + 1) / 2)

    def _fit_price_globals(self):
        self.sigma, self.q, self.sd = {}, {}, {}
        by_w = defaultdict(list)
        for o in self.train:
            by_w[o.window].append(o)
        for w in WINDOWS:
            obs = by_w.get(w, [])
            # floor share q: P(median of an unfilled section's bids is within the floor band)
            un = [o for o in obs if not o.filled and o.succ >= 3 and o.med > 0]
            if self.cfg.anchor_share >= 0:
                self.q[w] = self.cfg.anchor_share
            elif len(un) < 30:
                self.q[w] = 0.3
            else:
                f = sum(o.w for o in un if o.med <= o.floor + 200) / sum(o.w for o in un)
                best = (9, 0.0)
                for qq in [i / 20 for i in range(0, 19)]:
                    g = sum(o.w * binom_ge(o.succ, qq, (o.succ + 1) // 2) for o in un) / sum(o.w for o in un)
                    best = min(best, (abs(g - f), qq))
                self.q[w] = best[1]
            num = den = 0.0
            for o in obs:
                if o.filled and o.mn > o.floor + 200 and o.med > o.mn:
                    zs, zm = self._nhat_z(o, self.q[w])
                    if zm > zs:
                        num += o.w * math.log(o.med / o.mn)
                        den += o.w * (zm - zs)
            self.sigma[w] = min(0.9, max(0.15, num / den)) if den > 3 else 0.4
        # residual sd of y within course x instructor x window
        if self.cfg.obs_sd > 0:
            self.sd_all = self.cfg.obs_sd
        else:
            res = []
            for k, obs in self.groups.items():
                if k[0] != "ci":
                    continue
                ys = [self._y(o) for o in obs if o.filled and o.mn > o.floor + 200]
                if len(ys) >= 2:
                    m = sum(ys) / len(ys)
                    res.append((sum((y - m) ** 2 for y in ys), len(ys) - 1))
            dof = sum(d for _, d in res)
            self.sd_all = max(0.2, math.sqrt(sum(s for s, _ in res) / dof)) if dof > 10 else 0.4

    def _y(self, o: Obs) -> float:
        zs, _ = self._nhat_z(o, self.q[o.window])
        return math.log(max(o.mn, 1)) - self.sigma[o.window] * zs

    def ppost(self, k) -> Post:
        p = self._ppost.get(k)
        if p is not None:
            return p
        par = self.parent(k, None)
        mu = math.log(2000.0) if par is None else self.ppost(par).mean_x
        obs = [o for o in self.groups.get(k, []) if o.filled]
        ll = [0.0] * len(PRICE_GRID)
        s = self.sd_all
        for o in obs:
            sig, q = self.sigma[o.window], self.q[o.window]
            zs, _ = self._nhat_z(o, q)
            adj = self._beta_p(o.slot, o.window)
            if o.mn <= o.floor + 200:  # censored: cutoff hidden in the floor band
                yc = math.log(o.floor + 200) - sig * zs - adj
                ll = [l + o.w * math.log(max(ND.cdf((yc - x) / s), 1e-12)) for l, x in zip(ll, PRICE_GRID)]
            else:
                y = math.log(o.mn) - sig * zs - adj
                ll = [l - o.w * 0.5 * ((y - x) / s) ** 2 for l, x in zip(ll, PRICE_GRID)]
        p = grid_posterior(ll, PRICE_GRID, mu, self.cfg.tau_p[LEVELS.index(k[0])], len(obs), sum(o.w for o in obs))
        self._ppost[k] = p
        return p

    # ---- prediction
    def params_for(self, course, instr, window, slot, floor):
        subject = subject_of(course)
        kci = self.key("ci", window, subject, course, instr)
        kc = self.key("c", window, subject, course, instr)
        ks = self.key("s", window, subject, course, instr)
        d = self.dpost(kci)
        pr = self.ppost(kci)
        lam = d.mean_exp * math.exp(self._beta_d(slot, window))
        m = math.exp(pr.mean_x + self._beta_p(slot, window)) * self.cfg.price_scale
        n_eff = pr.wsum
        anchor_sigma = math.sqrt(self.cfg.level_sd ** 2 + pr.sd_x ** 2)
        n_ci = len([o for o in self.groups.get(kci, [])])
        n_c = len(self.groups.get(kc, []))
        n_s = len(self.groups.get(ks, []))
        lvl = "course×instructor" if n_ci else "course" if n_c else "subject" if n_s else "global"
        sp = SimParams(
            demandMean=round(lam, 4), demandDispersion=self.cfg.dispersion,
            priceLevelCents=round(max(m, floor), 1), priceSigma=round(self.sigma[window], 4),
            anchorSigma=round(anchor_sigma, 4), anchorShare=round(self.q[window], 3), anchorCents=float(floor),
        )
        return sp, {"pooledLevel": lvl, "nObs": n_ci, "weights": {"ci": round(pool_weight(d.wsum, 2.0), 3)}}


def binom_ge(n: int, p: float, k: int) -> float:
    if p <= 0:
        return 1.0 if k <= 0 else 0.0
    return sum(math.comb(n, j) * p ** j * (1 - p) ** (n - j) for j in range(k, n + 1))


def _slot_contrasts(train):
    """Within course x term x window contrasts vs 'mid' sections: ({key: demand diffs}, {key: price diffs})."""
    cells = defaultdict(list)
    for o in train:
        cells[(o.term, o.window, o.course)].append(o)
    dd, dp = defaultdict(list), defaultdict(list)
    for obs in cells.values():
        mids = [o for o in obs if o.slot == "mid"]
        if not mids:
            continue
        # demand proxy: log(1 + lower bound of N / seats); price proxy: log clearing for filled
        md = sum(math.log1p((o.seats if o.filled else o.succ) / o.seats) for o in mids) / len(mids)
        mp = [math.log(o.mn) for o in mids if o.filled and o.mn > 0]
        for o in obs:
            if o.slot == "mid":
                continue
            dd[o.slot].append(math.log1p((o.seats if o.filled else o.succ) / o.seats) - md)
            if o.filled and mp:
                dp[o.slot].append(math.log(o.mn) - sum(mp) / len(mp))
    return dd, dp


def estimate_slot_effects(train):
    """Contrasts vs 'mid' for every non-mid key, shrunk by n/(n+30). Returns (beta_d, beta_p)."""
    dd, dp = _slot_contrasts(train)
    bd = {s: 0.0 for s in SLOTS}
    bp = {s: 0.0 for s in SLOTS}
    for s in set(dd) | set(dp):
        if dd[s]:
            bd[s] = sum(dd[s]) / len(dd[s]) * pool_weight(len(dd[s]), 30) * 2.0  # proxy is compressed; x2 on the log-lambda scale
        if dp[s]:
            bp[s] = sum(dp[s]) / len(dp[s]) * pool_weight(len(dp[s]), 30)
    bd = {s: round(v / STEP) * STEP for s, v in bd.items()}
    return bd, bp


def estimate_slot_effects_by_window(train, pooled_d, pooled_p, min_n=30):
    """{window: (beta_d, beta_p)}; a key with fewer than min_n contrasts in that window takes the pooled value."""
    out = {}
    for w in {o.window for o in train}:
        wt = [o for o in train if o.window == w]
        dd, dp = _slot_contrasts(wt)
        bd, bp = estimate_slot_effects(wt)
        for s in set(pooled_d) | set(pooled_p):
            if len(dd[s]) < min_n:
                bd[s] = pooled_d.get(s, 0.0)
            if len(dp[s]) < min_n:
                bp[s] = pooled_p.get(s, 0.0)
        out[w] = (bd, bp)
    return out


# ----------------------------------------------------------------------------- backtest
def _sim_one(args):
    seats, floor, pd, runs, seed, act = args[:6]
    want_cq = len(args) > 6 and bool(args[6])  # optional 7th job element: also return cq, the conditional quantile grid (plain path only)
    sp = SimParams(**pd)
    cut, filled, flags = sample_cutoffs(seats, 1, floor, sp, runs, seed)
    cal = calibrate_filled(cut, flags, floor, sp, 1)  # None unless the params carry fillProb / spreads (and some replay filled)
    if cal is not None:
        p_fill, _, fvals = cal
        fc = sorted(fvals)
        nf = len(fc)
        lt = (1 - p_fill) * (floor < act) + p_fill * bisect.bisect_left(fc, act) / nf
        le = (1 - p_fill) * (floor <= act) + p_fill * bisect.bisect_right(fc, act) / nf
        return {
            "pfill": p_fill, "lt": lt, "le": le, "p10": mixture_quantile(fc, p_fill, floor, 0.1),
            "p50": mixture_quantile(fc, p_fill, floor, 0.5), "p90": mixture_quantile(fc, p_fill, floor, 0.9),
            "cond_p10": fc[min(nf - 1, int(0.1 * nf))], "cond_p50": fc[nf // 2], "cond_p90": fc[min(nf - 1, int(0.9 * nf))],
        }
    s = sorted(cut)
    n = len(s)
    lt = sum(1 for c in cut if c < act) / n
    le = sum(1 for c in cut if c <= act) / n
    q = lambda f: s[min(n - 1, int(f * n))]
    fc = sorted(c for c, fl in zip(cut, flags) if fl)
    res = {
        "pfill": filled / runs, "lt": lt, "le": le, "p10": q(0.1), "p50": q(0.5), "p90": q(0.9),
        "cond_p10": fc[min(len(fc) - 1, int(0.1 * len(fc)))] if fc else None,
        "cond_p50": fc[len(fc) // 2] if fc else None,
        "cond_p90": fc[min(len(fc) - 1, int(0.9 * len(fc)))] if fc else None,
    }
    if want_cq:
        res["cq"] = [fc[min(len(fc) - 1, int(k / 100 * len(fc)))] for k in range(1, 100)] if fc else None
        res["n_fc"] = len(fc)
    return res


def predict_all(model: Model, targets, pool=None, runs=None):
    runs = runs or model.cfg.runs
    jobs, metas = [], []
    for i, o in enumerate(targets):
        sp, meta = model.params_for(o.course, o.instr, o.window, o.slot, o.floor)
        jobs.append((o.seats, o.floor, sp.to_dict(), runs, 1000 + i, actual_cutoff(o)))
        metas.append(meta)
    res = pool.map(_sim_one, jobs, chunksize=40) if pool else [_sim_one(j) for j in jobs]
    return res


def naive_baseline(train, targets):
    """Last term's clearing bid for the same section (course+section), else course+instructor, else course."""
    idx = defaultdict(list)
    for o in train:
        idx[("s", o.window, o.course, o.section)].append(o)
        idx[("i", o.window, o.course, o.instr)].append(o)
        idx[("c", o.window, o.course)].append(o)
    out = []
    for t in targets:
        pick = None
        for k in (("s", t.window, t.course, t.section), ("i", t.window, t.course, t.instr), ("c", t.window, t.course)):
            cand = [o for o in idx.get(k, []) if o.tidx < t.tidx]
            if cand:
                best = max(o.tidx for o in cand if o.ttype == t.ttype) if any(o.ttype == t.ttype for o in cand) else max(o.tidx for o in cand)
                pick = [o for o in cand if o.tidx == best][0]
                break
        out.append(pick)
    return out


def actual_cutoff(o: Obs) -> int:
    return o.mn if o.filled else o.floor


def backtest(all_obs, target_term: str, cfg: Config, pool=None, runs=None):
    ti, tt = term_index(target_term)
    targets = [o for o in all_obs if o.term == target_term]
    train = [o for o in all_obs if o.tidx < ti]
    model = Model(train, ti, tt, cfg)
    preds = predict_all(model, targets, pool, runs)
    base = naive_baseline(train, targets)
    clim = {}
    for w in WINDOWS:
        ws = [o for o in model.train if o.window == w]
        clim[w] = (sum(o.w * o.filled for o in ws) / sum(o.w for o in ws)) if ws else 0.2
    return summarize(targets, preds, base, clim, target_term), model


def reliability(ps, ys, bins=10):
    out = []
    for b in range(bins):
        sel = [(p, y) for p, y in zip(ps, ys) if (min(int(p * bins), bins - 1) == b)]
        out.append({"bin": f"{b / bins:.1f}-{(b + 1) / bins:.1f}", "n": len(sel),
                    "meanPred": round(sum(p for p, _ in sel) / len(sel), 4) if sel else None,
                    "meanObs": round(sum(y for _, y in sel) / len(sel), 4) if sel else None})
    return out


def pair_order(rows):
    """Within course x term x window, over filled sections with different slot keys and unequal actual clearing:
    (percent of pairs where the conditional-on-filled median prediction orders them like the actual, ties count 0.5; pair count)."""
    cells = defaultdict(list)
    for r in rows:
        if r["filled"] and r["cond_p50"] is not None:
            cells[(r["term"], r["window"], r["course"])].append(r)
    hit = n = 0.0
    for rs in cells.values():
        for i, a in enumerate(rs):
            for b in rs[i + 1:]:
                if a["slot"] == b["slot"] or a["act"] == b["act"]:
                    continue
                n += 1
                d = (a["cond_p50"] - b["cond_p50"]) * (a["act"] - b["act"])
                hit += 1.0 if d > 0 else 0.5 if d == 0 else 0.0
    return (round(100 * hit / n, 2) if n else None), int(n)


def _agg(rows, base_rows):
    n = len(rows)
    if not n:
        return {"samples": 0}
    inside_lit = sum(1 for r in rows if r["p10"] <= r["act"] <= r["p90"])
    inside = sum(1 for r in rows if 0.1 <= r["pit"] <= 0.9)  # randomized PIT: exact 80% if calibrated
    f = [r for r in rows if r["filled"]]
    inside_f = sum(1 for r in f if r["p10"] <= r["act"] <= r["p90"])
    inside_cond = sum(1 for r in f if r["cond_p10"] is not None and r["cond_p10"] <= r["act"] <= r["cond_p90"])
    ae = sorted(abs(r["p50"] - r["act"]) for r in rows)
    aef = sorted(abs(r["cond_p50"] - r["act"]) for r in f if r["cond_p50"] is not None)
    brier = sum((r["pfill"] - r["filled"]) ** 2 for r in rows) / n
    b = [r for r in base_rows if r is not None]
    out = {
        "samples": n, "filled": len(f),
        "coverage80": round(inside / n, 4), "coverage80Literal": round(inside_lit / n, 4), "coverage80Filled": round(inside_f / len(f), 4) if f else None,
        "coverage80FilledConditional": round(inside_cond / len(f), 4) if f else None,
        "maeCents": round(sum(ae) / n, 2), "medianAbsErrCents": ae[n // 2],
        "maeFilledCondCents": round(sum(aef) / len(aef), 2) if aef else None,
        "medianAbsErrFilledCondCents": aef[len(aef) // 2] if aef else None,
        "brier": round(brier, 5),
        "pairOrder": None, "pairOrderPairs": 0,
        "baseline": None,
    }
    out["pairOrder"], out["pairOrderPairs"] = pair_order(rows)
    if b:
        bn = len(b)
        bf = [r for r in b if r["filled"]]
        out["baseline"] = {
            "samples": bn,
            "maeCents": round(sum(abs(r["bp"] - r["act"]) for r in b) / bn, 2),
            "maeFilledCents": round(sum(abs(r["bp"] - r["act"]) for r in bf) / len(bf), 2) if bf else None,
            "brierHard": round(sum((r["bfill"] - r["filled"]) ** 2 for r in b) / bn, 5),
            "brierClimatology": round(sum((r["clim"] - r["filled"]) ** 2 for r in b) / bn, 5),
            "modelMaeOnSameSamples": round(sum(abs(r["p50"] - r["act"]) for r in b) / bn, 2),
            "modelMaeFilledCondOnSameSamples": round(sum(abs(r["cond_p50"] - r["act"]) for r in bf if r["cond_p50"] is not None) / max(1, sum(1 for r in bf if r["cond_p50"] is not None)), 2) if bf else None,
            "modelBrierOnSameSamples": round(sum((r["pfill"] - r["filled"]) ** 2 for r in b) / bn, 5),
        }
    return out


def summarize(targets, preds, base, clim, term):
    rows = []
    for i, (o, p, b) in enumerate(zip(targets, preds, base)):
        r = dict(p)
        r["pit"] = p["lt"] + random.Random(i).random() * (p["le"] - p["lt"])
        r.update(window=o.window, term=o.term, course=o.course, slot=o.slot, filled=int(o.filled), act=actual_cutoff(o), clim=clim[o.window])
        if b is not None:
            r.update(bp=actual_cutoff(b), bfill=int(b.filled))
        r["has_base"] = b is not None
        rows.append(r)
    by = {}
    for w in WINDOWS:
        sel = [r for r in rows if r["window"] == w]
        by[w] = _agg(sel, [r if r["has_base"] else None for r in sel])
    overall = _agg(rows, [r if r["has_base"] else None for r in rows])
    overall["byWindow"] = by
    overall["calibration"] = reliability([r["pfill"] for r in rows], [r["filled"] for r in rows])
    overall["term"] = term
    overall["_rows"] = rows
    return overall


def pit_shift(rows):
    """Median log(actual / conditional p50) over filled samples: used to calibrate price_scale."""
    v = sorted(math.log(max(r["act"], 1) / r["cond_p50"]) for r in rows if r["filled"] and r["cond_p50"])
    return v[len(v) // 2] if v else 0.0


# ----------------------------------------------------------------------------- calibration on the validation term
VALIDATION_TERM = "2024-25 Term 2"
TEST_TERM = "2025-26 Term 2"
HELD_OUT_TERM = "2026-27 Term 1"


def calibrate(all_obs, pool, log=print):
    cfg = Config(runs=500)
    trace = []

    def run(c, tag):
        res, _ = backtest(all_obs, VALIDATION_TERM, c, pool)
        trace.append({"tag": tag, "brier": res["brier"], "cov": res["coverage80"], "covFilled": res["coverage80Filled"],
                      "maeFilledCond": res["maeFilledCondCents"], "pairOrder": res["pairOrder"], "shift": round(pit_shift(res["_rows"]), 3)})
        log("  calib", trace[-1])
        return res

    best, bres = None, None
    for r in (0.4, 1.0, 2.5):
        res = run(replace(cfg, dispersion=r), f"r={r}")
        if best is None or res["brier"] < bres["brier"]:
            best, bres = replace(cfg, dispersion=r), res
    cfg = best
    for xw in (0.0, 1.0):
        res = run(replace(cfg, cross_w=xw), f"cross_w={xw}")
        if res["brier"] < bres["brier"] - 1e-4:
            cfg, bres = replace(cfg, cross_w=xw), res
    for td in ((3.0, 1.5, 1.2, 1.0), (3.0, 2.5, 2.0, 1.5), (3.0, 2.0, 1.5, 1.0)):
        res = run(replace(cfg, tau_d=td), f"tau_d={td}")
        if res["brier"] < bres["brier"] - 1e-4:
            cfg, bres = replace(cfg, tau_d=td), res
    # price scale from the median conditional PIT shift on filled samples (validation only)
    for _ in range(2):
        sh = pit_shift(bres["_rows"])
        cfg = replace(cfg, price_scale=cfg.price_scale * math.exp(sh))
        bres = run(cfg, f"price_scale={cfg.price_scale:.3f}")
    # level sd: pick the one whose filled-conditional 80% coverage is closest to 0.8
    bestsd = None
    for sd in (0.1, 0.25, 0.4):
        res = run(replace(cfg, level_sd=sd), f"level_sd={sd}")
        gap = abs((res["coverage80FilledConditional"] or 0) - 0.8)
        if bestsd is None or gap < bestsd[0]:
            bestsd = (gap, sd, res)
    cfg = replace(cfg, level_sd=bestsd[1])
    bres = bestsd[2]
    # time-of-day on/off: the raw data shows a clear slot/Friday effect (log, 8 Nov 2026), so keep it unless it
    # clearly hurts: same-course section ordering down >2 pts (about one paired SE at ~900 pairs and 500 runs)
    # or Brier worse by >0.0002 (seed noise ~0.0001)
    off = run(replace(cfg, use_slot=False), "slot=off")
    no_pairs = bres["pairOrder"] is None or off["pairOrder"] is None
    slot_helps = (no_pairs or bres["pairOrder"] - off["pairOrder"] >= -2.0) and bres["brier"] <= off["brier"] + 0.0002
    cfg = replace(cfg, use_slot=slot_helps)
    summ = lambda r: {"brier": r["brier"], "maeFilledCond": r["maeFilledCondCents"], "pairOrder": r["pairOrder"], "pairOrderPairs": r["pairOrderPairs"]}
    return cfg, {"trace": trace, "slotOn": summ(bres), "slotOff": summ(off), "slotKept": slot_helps}


# ----------------------------------------------------------------------------- output for the current term
def current_sections(rows, term):
    seen = {}
    for r in rows:
        if r["term"] == term and r["class_number"] not in seen:
            seen[r["class_number"]] = r
    return seen


def make_params_json(rows, all_obs, cfg, term, floors):
    ti, tt = term_index(term)
    model = Model([o for o in all_obs if o.tidx < ti], ti, tt, cfg)
    classes = {}
    for cn, r in current_sections(rows, term).items():
        slot = slot_key(r["start_times"], r.get("days"))
        floor = floors.get(r["course_code"], 1000)
        wins = {}
        for w in WINDOWS:
            sp, meta = model.params_for(r["course_code"], r["instructor"].strip(), w, slot, floor)
            d = sp.to_dict()
            d.update(pooledLevel=meta["pooledLevel"], nObs=meta["nObs"])
            wins[w] = d
        classes[cn] = {"course": r["course_code"], "section": r["section"], "instructor": r["instructor"],
                       "minBidCents": floor, "slot": slot, "windows": wins}
    return classes, model


def _dump(path, obj, **kw):
    with open(path, "w") as f:
        json.dump(obj, f, **kw)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=default_csv())
    ap.add_argument("--out", required=True)
    ap.add_argument("--current-term", default="2026-27 Term 2")
    ap.add_argument("--reuse-calibration", action="store_true")
    ap.add_argument("--procs", type=int, default=os.cpu_count() or 1)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    rows = load_rows(a.csv)
    floors = course_floors(rows)
    all_obs = build_obs(rows, floors)
    print(f"{len(rows)} csv rows -> {len(all_obs)} usable observations", flush=True)
    calp = os.path.join(a.out, "calibration.json")
    with Pool(a.procs) as pool:
        if a.reuse_calibration and os.path.exists(calp):
            with open(calp) as fh:
                blob = json.load(fh)
            cfg = Config(**{**blob["config"], "tau_d": tuple(blob["config"]["tau_d"]), "tau_p": tuple(blob["config"]["tau_p"])})
        else:
            cfg, info = calibrate(all_obs, pool)
            blob = {"validationTerm": VALIDATION_TERM, "config": asdict(cfg), "info": info}
            _dump(calp, blob, indent=1)
        cfg = replace(cfg, runs=1500)
        print("config", cfg, flush=True)
        test, _ = backtest(all_obs, TEST_TERM, cfg, pool)
        held, _ = backtest(all_obs, HELD_OUT_TERM, cfg, pool)
        alt, _ = backtest(all_obs, TEST_TERM, replace(cfg, use_slot=not cfg.use_slot), pool)
    for r in (test, held, alt):
        r.pop("_rows", None)
    b = test["baseline"]
    covered = 0.75 <= test["coverage80"] <= 0.85 and 0.70 <= (test["coverage80Filled"] or 0) <= 0.90
    beats = bool(b) and b["modelMaeOnSameSamples"] < b["maeCents"] and (b["modelMaeFilledCondOnSameSamples"] or 1e9) < (b["maeFilledCents"] or 0) \
        and b["modelBrierOnSameSamples"] < min(b["brierHard"], b["brierClimatology"])
    ok = bool(covered and beats)
    report = {
        "forecasts_ok": ok, "coverageInRange": covered, "beatsBaseline": beats,
        "coverage80": test["coverage80"], "maeCents": test["maeCents"], "pairOrder": test["pairOrder"], "medianAbsErrCents": test["medianAbsErrCents"],
        "samples": test["samples"], "byWindow": test["byWindow"], "calibration": test["calibration"],
        "baseline": test["baseline"], "term": TEST_TERM, "config": asdict(cfg),
        "overall": {k: v for k, v in test.items() if k not in ("byWindow", "calibration")},
        "heldOut": held, "slotAlternative": {"useSlot": not cfg.use_slot, "result": {k: v for k, v in alt.items() if k not in ("byWindow", "calibration")}},
        "calibrationInfo": blob.get("info"),
    }
    _dump(os.path.join(a.out, "backtest.json"), report, indent=1)
    classes, _ = make_params_json(rows, all_obs, cfg, a.current_term, floors)
    payload = {"forecasts_ok": ok, "term": a.current_term, "windows": WINDOWS, "config": asdict(cfg), "classes": classes}
    name = "params-2026-27-term-2.json" if ok else "params-2026-27-term-2.rejected.json"
    for stale in ("params-2026-27-term-2.json", "params-2026-27-term-2.rejected.json"):
        if stale != name and os.path.exists(os.path.join(a.out, stale)):
            os.remove(os.path.join(a.out, stale))
    _dump(os.path.join(a.out, name), payload)
    print(f"forecasts_ok={ok} coverage80={test['coverage80']} filled={test['coverage80Filled']} -> {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
