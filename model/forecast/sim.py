"""Python port of site/src/lib/sim/{rng,index}.ts.

The RNG (xoshiro128** seeded by splitmix32) and the sampling order are mirrored
line by line so that, for the same seed and parameters, results are identical to
the TypeScript engine up to libm differences in log/exp/cos/sin (tests allow
1 cent on percentiles).  Stdlib only.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field

M32 = 0xFFFFFFFF
HIST_BINS = 40
GRID_POINTS = 120


@dataclass
class SimParams:
    demandMean: float
    demandDispersion: float
    priceLevelCents: float
    priceSigma: float
    anchorSigma: float
    anchorShare: float
    anchorCents: float

    def to_dict(self) -> dict:
        return asdict(self)


def _rotl(x: int, k: int) -> int:
    return ((x << k) | (x >> (32 - k))) & M32


def _lgamma(x: float) -> float:
    if x < 10:
        prod = 1.0
        while x < 10:
            prod *= x
            x += 1
        return _lgamma(x) - math.log(prod)
    x2 = x * x
    return (x - 0.5) * math.log(x) - x + 0.9189385332046727 + 1 / (12 * x) - 1 / (360 * x * x2) + 1 / (1260 * x2 * x2 * x)


def js_round(x: float) -> int:
    """Math.round: ties go toward +infinity."""
    return math.floor(x + 0.5)


class Rng:
    def __init__(self, seed: int):
        s = seed & M32

        def nxt() -> int:
            nonlocal s
            s = (s + 0x9E3779B9) & M32
            z = s
            z = ((z ^ (z >> 16)) * 0x85EBCA6B) & M32
            z = ((z ^ (z >> 13)) * 0xC2B2AE35) & M32
            return (z ^ (z >> 16)) & M32

        self.a, self.b, self.c, self.d = nxt(), nxt(), nxt(), nxt()
        if (self.a | self.b | self.c | self.d) == 0:
            self.a = 1
        self.spare = math.nan
        self.z0 = 0.0
        self.z1 = 0.0

    def u32(self) -> int:
        m5 = (self.b * 5) & M32
        result = (_rotl(m5, 7) * 9) & M32
        t = (self.b << 9) & M32
        self.c ^= self.a
        self.d ^= self.b
        self.b ^= self.c
        self.a ^= self.d
        self.c ^= t
        self.d = _rotl(self.d, 11)
        return result

    def uniform(self) -> float:
        return self.u32() / 4294967296

    def uniform_open(self) -> float:
        return (self.u32() + 1) / 4294967296

    def normal_pair(self) -> None:
        r = math.sqrt(-2 * math.log(self.uniform_open()))
        th = 6.283185307179586 * self.uniform()
        self.z0 = r * math.cos(th)
        self.z1 = r * math.sin(th)

    def normal(self) -> float:
        if not math.isnan(self.spare):
            v = self.spare
            self.spare = math.nan
            return v
        r = math.sqrt(-2 * math.log(self.uniform_open()))
        th = 2 * math.pi * self.uniform()
        self.spare = r * math.sin(th)
        return r * math.cos(th)

    def gamma(self, shape: float) -> float:
        if shape < 1:
            g = self.gamma(shape + 1)
            return g * math.pow(self.uniform_open(), 1 / shape)
        d = shape - 1 / 3
        c = 1 / math.sqrt(9 * d)
        while True:
            while True:
                x = self.normal()
                v = 1 + c * x
                if v > 0:
                    break
            v = v * v * v
            u = self.uniform_open()
            if u < 1 - 0.0331 * x * x * x * x:
                return d * v
            if math.log(u) < 0.5 * x * x + d * (1 - v + math.log(v)):
                return d * v

    def poisson(self, lam: float) -> int:
        if not lam > 0:
            return 0
        if lam < 12:
            L = math.exp(-lam)
            k = 0
            p = 1.0
            while True:
                k += 1
                p *= self.uniform()
                if not p > L:
                    break
            return k - 1
        slam = math.sqrt(lam)
        loglam = math.log(lam)
        b = 0.931 + 2.53 * slam
        a = -0.059 + 0.02483 * b
        invalpha = 1.1239 + 1.1328 / (b - 3.4)
        vr = 0.9277 - 3.6224 / (b - 2)
        while True:
            U = self.uniform() - 0.5
            V = self.uniform_open()
            us = 0.5 - abs(U)
            k = math.floor(((2 * a) / us + b) * U + lam + 0.43)
            if us >= 0.07 and V <= vr:
                return k
            if k < 0 or (us < 0.013 and V > us):
                continue
            if math.log(V) + math.log(invalpha) - math.log(a / (us * us) + b) <= -lam + k * loglam - _lgamma(k + 1):
                return k

    def neg_bin(self, mean: float, size: float) -> int:
        if not mean > 0:
            return 0
        if not size > 0 or math.isinf(size):
            return self.poisson(mean)
        return self.poisson(self.gamma(size) * (mean / size))


def sample_cutoffs(seats: int, group: int, min_bid: int, p: SimParams, runs: int, seed: int):
    """Return (cutoffs, filled_count, filled_flags).  Mirrors the loop in simulate()."""
    rng = Rng(seed)
    k = seats - group + 1
    cutoffs = [0] * runs
    flags = [False] * runs
    filled = 0
    exp, rnd = math.exp, js_round
    share, ac, ps = p.anchorShare, p.anchorCents, p.priceSigma
    for r in range(runs):
        n = rng.neg_bin(p.demandMean, p.demandDispersion)
        if n < k or (k <= 0 and n == 0):
            cutoffs[r] = min_bid
            if n >= k:
                filled += 1
                flags[r] = True
            continue
        filled += 1
        flags[r] = True
        m = p.priceLevelCents * exp(p.anchorSigma * rng.normal())
        buf = [0] * n
        for i in range(0, n, 2):
            rng.normal_pair()
            z0, z1 = rng.z0, rng.z1
            bid = ac + rng.uniform() * 200 if rng.uniform() < share else m * exp(ps * z0)
            bid = rnd(bid)
            buf[i] = min_bid if bid < min_bid else bid
            if i + 1 < n:
                bid = ac + rng.uniform() * 200 if rng.uniform() < share else m * exp(ps * z1)
                bid = rnd(bid)
                buf[i + 1] = min_bid if bid < min_bid else bid
        if k <= 0:
            cutoffs[r] = min_bid
        else:
            buf.sort()
            cutoffs[r] = buf[n - k]
    return cutoffs, filled, flags


def _pct(sorted_c, q):
    return sorted_c[min(len(sorted_c) - 1, math.floor(q * len(sorted_c)))]


def simulate(seats: int, group: int, min_bid: int, params: SimParams, runs: int = 30000, seed: int = 12345) -> dict:
    runs = max(1, math.floor(runs))
    cutoffs, filled, _ = sample_cutoffs(seats, group, min_bid, params, runs, seed)
    s = sorted(cutoffs)
    pc = {"p50": _pct(s, 0.5), "p80": _pct(s, 0.8), "p90": _pct(s, 0.9), "p95": _pct(s, 0.95), "p99": _pct(s, 0.99)}
    hi = max(min_bid + 100, math.ceil(pc["p99"] * 1.15))
    bw = max(1, math.ceil((hi - min_bid) / HIST_BINS))
    counts = [0] * HIST_BINS
    for c in cutoffs:
        b = min(HIST_BINS - 1, math.floor((c - min_bid) / bw))
        counts[0 if b < 0 else b] += 1

    import bisect

    bids, pin = [], []
    step = max(1.0, (hi - min_bid) / (GRID_POINTS - 1))
    prev = -math.inf
    for i in range(GRID_POINTS):
        b = hi if i == GRID_POINTS - 1 else js_round(min_bid + i * step)
        if b <= prev:
            continue
        prev = b
        lt = bisect.bisect_left(s, b)
        le = bisect.bisect_left(s, b + 1)
        bids.append(b)
        pin.append((lt + 0.5 * (le - lt)) / runs)
    return {
        "runs": runs,
        "pFill": filled / runs,
        "percentilesCents": pc,
        "histogram": {"startCents": min_bid, "binWidthCents": bw, "counts": counts},
        "curve": {"bidCents": bids, "pIn": pin},
    }


def quantiles(sorted_c, qs):
    return [_pct(sorted_c, q) for q in qs]


def p_in_at(result: dict, bid: float) -> float:
    """Chance a bid gets a seat: linear interpolation on the curve (same as pInAt in site/src/lib/sim/index.ts)."""
    xs, ys = result["curve"]["bidCents"], result["curve"]["pIn"]
    n = len(xs)
    if bid <= xs[0]:
        return ys[0]
    if bid >= xs[n - 1]:
        return ys[n - 1]
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) >> 1
        if xs[mid] <= bid:
            lo = mid
        else:
            hi = mid
    t = (bid - xs[lo]) / (xs[hi] - xs[lo])
    return ys[lo] + t * (ys[hi] - ys[lo])


def recommend_bid(result: dict, target_p: float) -> int:
    """Smallest odd-cent bid reaching target_p (same as recommendBid in site/src/lib/sim/index.ts)."""
    xs, ys = result["curve"]["bidCents"], result["curve"]["pIn"]
    n = len(xs)
    if ys[0] >= target_p:
        bid = xs[0]
    elif ys[n - 1] < target_p:
        bid = xs[n - 1]
    else:
        i = 1
        while ys[i] < target_p:
            i += 1
        t = (target_p - ys[i - 1]) / (ys[i] - ys[i - 1])
        bid = math.ceil(xs[i - 1] + t * (xs[i] - xs[i - 1]))
        while bid < xs[i] and p_in_at(result, bid) < target_p:
            bid += 1
    return bid + 1 if bid % 2 == 0 else bid
