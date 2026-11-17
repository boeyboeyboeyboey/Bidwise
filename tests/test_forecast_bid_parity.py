"""The bid the Python evaluation scores equals the bid the site shows.

Evaluation (distcal): a section's bid at level a is distcal._uq on the 99-point conditional quantile grid `cq` of the replays that
filled (after distcal._transform's spread exponents), with fill chance p (the classifier's fillProb, else the simulated share),
then distcal.site_round. The site: suggestBid (site/src/lib/sim/presets.ts, calibrated mode) inverts the 120-point win curve of the
simulated replays (recommendBid), then raises the bid to the next whole e$ plus one cent. This test draws the same seeded
replays on both sides (model.forecast.sim.sample_cutoffs, which tests/test_forecast_sim.py ties to the TS engine) and compares the
two bids at levels from 0.50 to 0.995. tests/fixtures/forecast_bid_parity.json holds the site's bids, made by
forecast_bid_parity_gen.ts (regenerate: see that file); site/src/lib/sim/bidParity.test.ts checks the file against the live
suggestBid, so a change to either engine fails one of the two tests.

Why the two bids differ at all, and the tolerance (first principles).
  raw bid (before site rounding): the site inverts a piecewise-linear curve with step D = (hi - floor) / 119 cents, hi = last curve
  point (about 1.15 x the unconditional p99), so it can sit up to D away from the true quantile. The evaluation interpolates linearly
  between two adjacent grid percentiles, so it can sit up to that cell's width G = cq[i+1] - cq[i] away. Ties add up to a few cents
  (the site's win curve credits a bid equal to a cutoff with the tie chance, below 1), and ceil plus the odd-cent step add up to 3.
  Tolerance TOL_RAW = D + G + 3 cents. D comes from the Python port's own curve (sim.simulate), G from the transformed grid.
  site bid: both sides raise to the next whole e$ plus 1 cent, so a raw gap of d can flip at most ceil(d / 100) buckets:
  TOL_SITE = 100 * ceil(TOL_RAW / 100). At the floor the bid is left alone (1001), which stays within the same bound.

Known gap (asserted below, not hidden): the evaluation's grid stops at the 99th conditional percentile and _uq clips there. A level
a needs the conditional percentile u = (a - (1 - p)) / p, so u > 0.99, i.e. a > 1 - 0.01 p, is read at the 99th percentile instead.
For level 0.995 that is every section with p > 0.5; the site, inverting the real curve, shows the true higher tail. So at 0.995
(Round 2 / 2A Safe) the evaluation scores a lower bid than the site ships: the shipped bid is never below the evaluated one, but
the measured win rate and overpay describe a cheaper bid than users get. Levels up to 0.99 are never clipped (a <= 1 - 0.01 p holds
for every p <= 1).

Observed differences, shipped minus evaluated, over the unclipped levels (max |raw| in cents / max |site-rounded|; curve step D):
  one_seat_high_fill            99.0 / 100   D 81     many_seats_high_fill          49.5 / 100   D 78
  many_seats_low_fill           32.9 / 100   D 14     few_seats_mid_fill            22.1 / 100   D 49
  cal_high_fill_wide_upper      19.6 /   0   D 36     cal_low_fill_one_seat         21.4 / 100   D 59
  cal_mid_fill_many_seats       37.0 / 100   D 67     cal_fillprob_only_high_price 118.7 / 100   D 168
  Per case the median |raw| is 1 to 8 cents and the mean signed gap -16 to +3 cents (no bias). 8 of 72 site bids differ, each by one
  whole e$ (a bucket edge fell between the two raw values), so 89% are identical.
Clipped rows (level 0.995, u > 0.99), shipped minus evaluated, raw / site-rounded, in cents:
  one_seat_high_fill 894 / 900; cal_fillprob_only_high_price 616 / 700; many_seats_high_fill 366 / 400;
  cal_high_fill_wide_upper 299 / 300; cal_mid_fill_many_seats (u 0.9909) 103 / 100; few_seats_mid_fill (u 0.9902) 21 / 0.
  For these rows G = 0 (the evaluation returns an exact order statistic, not an interpolation), so TOL_RAW = D + 3. The rigorous bound is loose in the tail for the unclipped rows (G is large there); the median and mean checks below are the tighter regression guard.
"""
import json
import math
import statistics
import unittest
from pathlib import Path

from model.forecast import correction as C
from model.forecast.sim import SimParams, recommend_bid, sample_cutoffs, simulate

if C.IMPORT_ERROR is None:
    from model.forecast import distcal as D

FIXTURE = Path(__file__).parent / "fixtures" / "forecast_bid_parity.json"

# Observed shipped-minus-evaluated site gap (cents) at the clipped level 0.995, per case, rounded up. The assertion allows 25% on top
# plus the unclipped tolerance, so it fails if the gap grows; it also fails if the gap closes (see test_known_gap_is_real).
KNOWN_GAP_SITE = {
    "one_seat_high_fill": 900,
    "many_seats_high_fill": 400,
    "cal_high_fill_wide_upper": 300,
    "cal_fillprob_only_high_price": 700,
    "cal_mid_fill_many_seats": 100,
    "few_seats_mid_fill": 0,
}
MIN_EXACT_SHARE = 0.8  # share of unclipped rows whose site bids are identical (observed 0.89)


def evaluated_bids(c: dict):
    """The evaluation's bids for case c at each fixture level: [(raw cents, site_round cents, clipped, grid cell width G)], and the
    curve step D of the Python port's win curve. Built the way distcal builds a row: cq from the replays that filled, cond_p50, p."""
    import numpy as np

    p = SimParams(**c["params"])
    floor = c["minBidCents"]
    cut, filled, flags = sample_cutoffs(c["seats"], c["group"], floor, p, c["runs"], c["seed"])
    fc = sorted(x for x, f in zip(cut, flags) if f)
    nf = len(fc)
    cq = [fc[min(nf - 1, int(k / 100 * nf))] for k in range(1, 100)]  # fit._sim_one's cq
    fill = p.fillProb if p.fillProb is not None and 0 < p.fillProb < 1 else filled / c["runs"]
    fl = np.array([float(floor)])
    Q = D._transform(np.array([cq], float), np.array([float(fc[nf // 2])]), fl, np.array([p.spreadLo]), np.array([p.spreadHi]))
    sim = simulate(c["seats"], c["group"], floor, p, c["runs"], c["seed"])
    step = (sim["curve"]["bidCents"][-1] - floor) / 119
    rows = []
    for a in c["levels"]:
        raw = float(D._uq(Q, np.array([fill]), fl, a)[0])
        u = (a - (1 - fill)) / fill
        pos = min(max(u * 100 - 1, 0), 98)
        i0 = min(int(math.floor(pos)), 97)
        clipped = a > 1 - fill + 0.99 * fill + 1e-12  # u > 0.99: _uq returns the 99th grid column, an exact order statistic (no cell)
        rows.append((raw, D.site_round(raw, floor), clipped, 0.0 if clipped else float(Q[0, i0 + 1] - Q[0, i0])))
    return rows, step, sim


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class BidParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads(FIXTURE.read_text())
        cls.evals = {c["name"]: evaluated_bids(c) for c in cls.cases}

    def test_fixture_covers_the_required_levels_and_shapes(self):
        for lv in (0.8, 0.9, 0.965, 0.985, 0.995):
            for c in self.cases:
                self.assertIn(lv, c["levels"])
        self.assertTrue(any(c["seats"] == 1 for c in self.cases))
        self.assertTrue(any(c["seats"] >= 25 for c in self.cases))
        self.assertTrue(all(c["minBidCents"] == 1000 for c in self.cases))
        fills = [c["pFill"] for c in self.cases]
        self.assertTrue(min(fills) < 0.4 and max(fills) > 0.85)
        cal = [c for c in self.cases if "fillProb" in c["params"]]
        self.assertTrue(any("spreadLo" in c["params"] and "spreadHi" in c["params"] for c in cal))
        self.assertTrue(any("spreadLo" not in c["params"] for c in cal))

    def test_python_port_inverts_the_win_curve_to_the_same_bid_as_the_site(self):
        # same replays, same curve, same inversion: this isolates the engine parity from the evaluation's grid
        for c in self.cases:
            with self.subTest(case=c["name"]):
                sim = self.evals[c["name"]][2]
                self.assertEqual([recommend_bid(sim, a) for a in c["levels"]], c["tsRaw"])
                self.assertAlmostEqual(sim["pFill"], c["pFill"], places=12)

    def test_evaluated_bid_matches_shipped_bid_below_the_grid_clip(self):
        exact = total = 0
        worst = {}
        for c in self.cases:
            rows, step, _ = self.evals[c["name"]]
            for a, (raw, site, clipped, g), ts_raw, ts_site in zip(c["levels"], rows, c["tsRaw"], c["tsSite"]):
                if clipped:
                    continue
                tol_raw = step + g + 3
                tol_site = 100 * math.ceil(tol_raw / 100)
                with self.subTest(case=c["name"], level=a):
                    self.assertLessEqual(abs(ts_raw - raw), tol_raw, f"raw: site {ts_raw}, evaluated {raw:.1f}")
                    self.assertLessEqual(abs(ts_site - site), tol_site, f"site: shipped {ts_site}, evaluated {site}")
                    self.assertEqual(ts_site % 100 == 1 or ts_site <= c["minBidCents"] + 1, True)
                total += 1
                exact += ts_site == site
                w = worst.setdefault(c["name"], [0.0, 0])
                w[0], w[1] = max(w[0], abs(ts_raw - raw)), max(w[1], abs(ts_site - site))
        self.assertGreaterEqual(exact / total, MIN_EXACT_SHARE, f"only {exact}/{total} site bids identical; worst {worst}")

    def test_no_systematic_offset_below_the_grid_clip(self):
        # the per-row bound above is rigorous but wide in the tail; these catch a shifted level or a wrong rounding (observed: median
        # |gap| <= 8.4 cents, |mean gap| <= 15.7, against D / 4 + 3 and D / 2 + 3, i.e. 23 to 87 for the cases here)
        for c in self.cases:
            rows, step, _ = self.evals[c["name"]]
            d = [ts - r[0] for r, ts in zip(rows, c["tsRaw"]) if not r[2]]
            with self.subTest(case=c["name"]):
                self.assertLessEqual(statistics.median(abs(x) for x in d), step / 4 + 3)
                self.assertLessEqual(abs(statistics.mean(d)), step / 2 + 3)

    def test_clipped_rows_are_read_at_the_99th_conditional_percentile(self):
        # documents the mechanism of the known gap: _uq returns the 99th grid column for every u > 0.99
        seen = 0
        for c in self.cases:
            rows, _, _ = self.evals[c["name"]]
            for a, (raw, _, clipped, _) in zip(c["levels"], rows):
                if clipped:
                    seen += 1
                    self.assertEqual(a, 0.995, "only the top level can be clipped for fill chances up to 1")
        self.assertGreater(seen, 0)

    def test_known_gap_at_level_0995_shipped_bid_is_never_below_evaluated(self):
        for c in self.cases:
            rows, step, _ = self.evals[c["name"]]
            for a, (raw, site, clipped, g), ts_raw, ts_site in zip(c["levels"], rows, c["tsRaw"], c["tsSite"]):
                if not clipped:
                    continue
                with self.subTest(case=c["name"], level=a):
                    tol_raw = step + g + 3
                    self.assertGreaterEqual(ts_raw, raw - tol_raw, "shipped bid fell below the evaluated one")
                    gap = ts_site - site
                    self.assertLessEqual(gap, KNOWN_GAP_SITE[c["name"]] * 1.25 + 100 * math.ceil(tol_raw / 100),
                                         f"the known gap grew: shipped {ts_site}, evaluated {site}")

    def test_known_gap_is_real(self):
        # fails when the evaluation's grid is extended past the 99th percentile (or the clip is otherwise removed): then drop the
        # known-gap handling above and let test_evaluated_bid_matches_shipped_bid_below_the_grid_clip cover level 0.995 too
        big = []
        for c in self.cases:
            rows, step, _ = self.evals[c["name"]]
            for a, (raw, site, clipped, g), ts_raw in zip(c["levels"], rows, c["tsRaw"]):
                if clipped and ts_raw - raw > step + g + 3:
                    big.append((c["name"], round(ts_raw - raw)))
        self.assertGreaterEqual(len(big), 3, f"known gap no longer shows: {big}")


if __name__ == "__main__":
    unittest.main()
