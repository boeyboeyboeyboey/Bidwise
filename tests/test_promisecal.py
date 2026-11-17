"""Promise calibration: conformal quantile, shrinkage, per-group multipliers, bids and the no-leakage fold wiring, on synthetic rows only."""
import random
import unittest

from model.forecast import correction as C

if C.IMPORT_ERROR is None:
    from model.forecast import evalharness as H
    from model.forecast import promisecal as P

from tests.test_evalharness import sim_rows

R1W1 = "Round 1 Window 1"  # window group R1W1
R2 = "Round 2 Window 1"  # window group R2
FLAT = [2000] * 99  # with floor 1000 every style's scale is 1000, so score = (act - 1000) / 1000


def row(window=R1W1, seats=1, act=1000, filled=1, cq=FLAT, floor=1000, cond_p50=1000):
    return {"window": window, "seats": seats, "floor": floor, "act": act, "filled": filled, "cond_p50": cond_p50, "cq": cq}


def scored(window, seats, score, **kw):
    """A filled row on the flat grid whose score is exactly `score`."""
    return row(window=window, seats=seats, act=int(1000 + 1000 * score), **kw)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class ConformalQuantile(unittest.TestCase):
    def test_unweighted_is_the_ceil_n_plus_1_tau_th_smallest(self):
        scores = list(range(10, 0, -1))  # 1..10, unsorted on purpose
        self.assertEqual(P.conformal_quantile(scores, 0.7), 8.0)  # ceil(11 * 0.7) = 8
        self.assertEqual(P.conformal_quantile(scores, 0.5), 6.0)  # ceil(5.5) = 6

    def test_unweighted_edges(self):
        scores = list(range(1, 11))
        self.assertEqual(P.conformal_quantile(scores, 0.95), 10.0)  # ceil(10.45) = 11 > n: the largest
        self.assertEqual(P.conformal_quantile(scores, 0.0), 1.0)  # k is at least 1
        self.assertIsNone(P.conformal_quantile([], 0.7))
        self.assertIsNone(P.conformal_quantile([], 0.7, weights=[]))

    def test_equal_weights_match_unweighted(self):
        scores = list(range(1, 11))
        for tau in (0.3, 0.7, 0.85, 0.95):
            self.assertEqual(P.conformal_quantile(scores, tau, [3.0] * 10), P.conformal_quantile(scores, tau), tau)

    def test_weighted_by_hand(self):
        # scores 1, 2, 3 with weights 1, 1, 2; the new row counts as the largest weight (2): need = tau * (4 + 2)
        self.assertEqual(P.conformal_quantile([3, 1, 2], 0.5, [2, 1, 1]), 3.0)  # need 3, cumulative 1, 2, 4
        self.assertEqual(P.conformal_quantile([3, 1, 2], 0.3, [2, 1, 1]), 2.0)  # need 1.8
        self.assertEqual(P.conformal_quantile([3, 1, 2], 0.5), 2.0)  # unweighted would give the 2nd smallest
        self.assertEqual(P.conformal_quantile([3, 1, 2], 0.5, [2, 1, 1], w_new=0), 2.0)  # need 2 exactly: cumulative 2 reaches it
        self.assertEqual(P.conformal_quantile([1, 2, 3], 0.99, [1, 1, 1]), 3.0)  # need above the total: the largest


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class Shrink(unittest.TestCase):
    def test_weighted_average_of_cell_and_parent(self):
        self.assertAlmostEqual(P.shrink(2.0, 4, 3.0, k=6), 2.6)  # (4 * 2 + 6 * 3) / 10
        self.assertAlmostEqual(P.shrink(1.0, 100, 3.0), 2.0)  # default K = 100: (100 + 300) / 200

    def test_no_rows_or_no_raw_value_gives_the_parent(self):
        self.assertEqual(P.shrink(2.0, 0, 3.0), 3.0)
        self.assertEqual(P.shrink(None, 5, 3.0), 3.0)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class FitTable(unittest.TestCase):
    # Cell A = (R1W1, seats 1): scores .5 1 1.5 2.  Cell B = (R2, seats 5): scores 1 2 4.  Global: .5 1 1 1.5 2 2 4 (n = 7).
    # Global: cheap ceil(8 * .7) = 6th -> 2, balanced ceil(6.8) = 7th -> 4, safe 8 > n -> 4.
    # Cell A (n = 4): all three styles take the largest, 2.   Cell B (n = 3): all take the largest, 4.   K = 10.
    def calib(self, band_of_a=(1000, 1000, 1000, 1000)):
        a = [scored(R1W1, 1, s, cond_p50=b) for s, b in zip((0.5, 1.0, 1.5, 2.0), band_of_a)]
        b = [scored(R2, 5, s) for s in (1.0, 2.0, 4.0)]
        return [(a + b, 1.0)]

    def test_two_axis_cells_by_hand(self):
        tab = P.fit_table(self.calib(), weighted=False, use_band=False, k=10)
        self.assertEqual(tab["n"], 7)
        self.assertEqual(tab["global"], {"cheap": 2.0, "balanced": 4.0, "safe": 4.0})
        a, b = tab["cells"][("R1W1", "1")], tab["cells"][("R2", "4+")]
        self.assertEqual((a["n"], b["n"]), (4, 3))
        self.assertAlmostEqual(a["cheap"], (4 * 2 + 10 * 2) / 14)  # 2.0
        self.assertAlmostEqual(a["balanced"], (4 * 2 + 10 * 4) / 14)  # 3.428571
        self.assertAlmostEqual(a["safe"], (4 * 2 + 10 * 4) / 14)
        self.assertAlmostEqual(b["cheap"], (3 * 4 + 10 * 2) / 13)  # 2.461538
        self.assertAlmostEqual(b["balanced"], (3 * 4 + 10 * 4) / 13)  # 4.0
        self.assertIs(tab["cells"], tab["cells2"])

    def test_unfilled_rows_and_rows_without_a_grid_are_ignored(self):
        base = P.fit_table(self.calib(), weighted=False, use_band=False, k=10)
        noise = [scored(R1W1, 1, 50.0, filled=0), scored(R2, 5, 50.0, filled=0),
                 row(window=R1W1, seats=1, act=900000, filled=1, cq=None), row(window=R2, seats=5, act=900000, filled=1, cq=None),
                 scored("Round 2A Window 1", 2, 50.0, filled=0)]
        more = P.fit_table([(self.calib()[0][0] + noise, 1.0)], weighted=False, use_band=False, k=10)
        self.assertEqual(more["n"], base["n"])
        self.assertEqual(more["global"], base["global"])
        self.assertEqual(more["cells"], base["cells"])  # and no cell appears for the noise-only group R2A

    def test_a_loss_below_the_floor_never_gives_a_negative_multiplier(self):
        # act 500 < floor 1000: score -0.5, so every raw quantile is negative; multipliers are clamped at 0
        tab = P.fit_table([([row(act=500)] * 3, 1.0)], weighted=False, use_band=False, k=10)
        self.assertEqual(tab["global"], {"cheap": 0.0, "balanced": 0.0, "safe": 0.0})
        self.assertEqual({st: tab["cells"][("R1W1", "1")][st] for st in P.STYLES}, {"cheap": 0.0, "balanced": 0.0, "safe": 0.0})

    def test_band_cell_shrinks_towards_its_two_axis_parent(self):
        # cond_p50 1000 is band 0 (< e$15), 2000 is band 1: cell A splits into scores {.5, 2} and {1, 1.5}
        tab = P.fit_table(self.calib((1000, 2000, 2000, 1000)), weighted=False, use_band=True, k=10)
        parent = tab["cells2"][("R1W1", "1")]
        self.assertAlmostEqual(parent["balanced"], (4 * 2 + 10 * 4) / 14)
        b1 = tab["cells"][("R1W1", "1", 1)]  # n = 2, scores 1 and 1.5: every style takes the largest, 1.5
        self.assertEqual(b1["n"], 2)
        self.assertAlmostEqual(b1["cheap"], (2 * 1.5 + 10 * 2.0) / 12)  # 1.916667
        self.assertAlmostEqual(b1["balanced"], (2 * 1.5 + 10 * parent["balanced"]) / 12)  # 3.107143
        b0 = tab["cells"][("R1W1", "1", 0)]  # scores .5 and 2 -> 2, same as the parent's cheap multiplier
        self.assertAlmostEqual(b0["cheap"], 2.0)

    def test_multiplier_falls_back_to_the_two_axis_cell_then_to_global(self):
        tab = P.fit_table(self.calib(), weighted=False, use_band=True, k=10)
        unseen_band = scored(R1W1, 1, 0, cond_p50=7000)  # band 4: no band cell in the table
        self.assertNotIn(("R1W1", "1", 4), tab["cells"])
        self.assertEqual(P.multiplier(tab, unseen_band, "balanced"), tab["cells2"][("R1W1", "1")]["balanced"])
        unseen_group = scored("Round 2A Window 1", 2, 0)
        self.assertEqual(P.multiplier(tab, unseen_group, "safe"), tab["global"]["safe"])

    def test_one_calibration_term_gives_the_same_table_weighted_or_not(self):
        rows = self.calib()[0][0]
        a = P.fit_table([(rows, 2.0)], weighted=True, use_band=True, k=10)
        b = P.fit_table([(rows, 2.0)], weighted=False, use_band=True, k=10)
        self.assertEqual((a["global"], a["cells"], a["cells2"]), (b["global"], b["cells"], b["cells2"]))

    def test_nearer_term_weighs_more_when_weights_differ(self):
        # one cell, k = 0 so no shrinkage; near term (weight 2): scores 5, 5; older term (weight 1): 1, 1, 1; target 0.5 for all
        near = [scored(R1W1, 1, 5.0)] * 2
        old = [scored(R1W1, 1, 1.0)] * 3
        tg = {"cheap": 0.5, "balanced": 0.5, "safe": 0.5}
        calib = [(near, 2.0), (old, 1.0)]
        w = P.fit_table(calib, targets=tg, weighted=True, use_band=False, k=0.0)
        u = P.fit_table(calib, targets=tg, weighted=False, use_band=False, k=0.0)
        self.assertEqual(w["global"]["cheap"], 5.0)  # sorted 1 1 1 5 5, weights 1 1 1 2 2, need .5 * (7 + 2) = 4.5: cumulative 5 at the 4th
        self.assertEqual(u["global"]["cheap"], 1.0)  # ceil(6 * .5) = 3rd smallest
        self.assertEqual(w["cells"][("R1W1", "1")]["cheap"], 5.0)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class Bids(unittest.TestCase):
    def table(self, calib_rows):
        return P.fit_table([(calib_rows, 1.0)], weighted=False, use_band=False, k=10)

    def test_site_rounded_from_floor_plus_multiplier_times_scale(self):
        tab = self.table([row(act=1500)])  # score .5 -> every style's multiplier is .5 (a single row, global = cell)
        r = row(cq=[3003] * 99)  # scale 2003 for every style: raw = 1000 + .5 * 2003 = 2001.5 -> odd cent 2003 -> next e$ + 1 cent
        self.assertEqual(P.bids([r], tab), {"cheap": [2101], "balanced": [2101], "safe": [2101]})

    def test_a_row_like_the_calibration_row_is_bid_at_least_its_price(self):
        cq = [2000 + 10 * k for k in range(99)]  # scales 1690 / 1840 / 1940 for p = 70 / 85 / 95
        cal = row(cq=cq, act=2840)
        b = P.bids([cal], self.table([cal]))
        self.assertEqual(b, {"cheap": [2901], "balanced": [2901], "safe": [2901]})  # raw 2840 -> 2841 -> 2901

    def test_a_zero_multiplier_or_missing_grid_bids_the_floor(self):
        tab = self.table([row(act=500)] * 3)  # multipliers 0
        for fl, want in ((1000, 1001), (1001, 1001)):  # the floor itself, site-rounded: odd cent for an even floor
            rows = [row(floor=fl, cq=[fl + 1000] * 99), row(floor=fl, cq=None)]
            got = P.bids(rows, tab)
            for st in P.STYLES:
                self.assertEqual(got[st], [want, want], (fl, st))
                self.assertEqual(got[st], [H.site_round(fl, fl)] * 2)

    def test_a_row_with_no_grid_bids_the_floor_even_with_large_multipliers(self):
        tab = self.table([scored(R1W1, 1, 8.0)])
        self.assertEqual(P.bids([row(cq=None)], tab), {st: [1001] for st in P.STYLES})

    def test_random_rows_are_odd_cent_rounded_and_never_below_floor_or_raw(self):
        rnd = random.Random(5)
        calib = [row(window=rnd.choice((R1W1, R2)), seats=rnd.choice((1, 2, 5)), floor=rnd.choice((1000, 1001, 1500)),
                     act=rnd.randint(500, 9000), filled=rnd.randint(0, 1),
                     cq=[1000 + k * rnd.choice((10, 40)) for k in range(99)]) for _ in range(80)]
        tab = P.fit_table([(calib, 1.0)], weighted=False, use_band=True, k=10)
        test = [row(window=rnd.choice((R1W1, R2)), seats=rnd.choice((1, 2, 5)), floor=fl, cq=[fl + k * 20 for k in range(99)],
                    cond_p50=fl + 980) for fl in (1000, 1001, 1500) for _ in range(20)]
        out = P.bids(test, tab)
        for st in P.STYLES:
            for r, b in zip(test, out[st]):
                self.assertGreaterEqual(b, r["floor"])
                self.assertEqual(b % 2, 1)
                self.assertGreaterEqual(b, r["floor"] + P.multiplier(tab, r, st) * P.scale(r, P.BASE_PCT[st]) - 1e-6)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class NoLeakage(unittest.TestCase):
    def setUp(self):
        self.order = ["2001-02 Term 1", "2001-02 Term 2", "2002-03 Term 1", "2002-03 Term 2"]
        self.sim = {t: sim_rows(t, 240, i, scale=1.0 + 0.4 * i) for i, t in enumerate(self.order)}
        self.shipped = {"exponents": H.D.learn_spread(self.sim[self.order[1]] + self.sim[self.order[2]])[0],
                        "levels": {"cheap": {"level": 0.9}, "balanced": {"level": 0.975}, "safe": {"level": 0.99}},
                        "terms": {"test": self.order[1], "heldOut": self.order[2]}}

    def run_eval(self, sim):
        return H.eval_rows(sim, self.order, self.shipped, {}, 6)

    @staticmethod
    def promise_bids(rows, term):
        return [[r[f"bid_promise_{st}"] for st in P.STYLES] for r in rows if r["term"] == term]

    def test_a_scored_terms_table_ignores_that_terms_own_outcomes(self):
        rows, settings = self.run_eval(self.sim)
        changed = dict(self.sim)
        changed[self.order[3]] = sim_rows("x", 240, 99, scale=5.0)  # other act / filled values in the last term only (same grids)
        for r_old, r_new in zip(self.sim[self.order[3]], changed[self.order[3]]):
            r_new["cq"], r_new["cond_p50"], r_new["seats"], r_new["floor"] = r_old["cq"], r_old["cond_p50"], r_old["seats"], r_old["floor"]
        self.assertNotEqual([r["act"] for r in self.sim[self.order[3]]], [r["act"] for r in changed[self.order[3]]])
        rows2, settings2 = self.run_eval(changed)
        for t in self.order[1:]:
            self.assertEqual(settings[t]["promise"], settings2[t]["promise"], t)
        for t in self.order[1:3]:  # earlier terms' bids are untouched too
            self.assertEqual(self.promise_bids(rows, t), self.promise_bids(rows2, t), t)
        # the last term is calibrated on the two before it, nothing else, and its bids (same grids) do not move either
        want = P.summary(P.rolled_table(self.sim[self.order[2]], self.sim[self.order[1]]))
        self.assertEqual(settings[self.order[3]]["promise"], want)
        self.assertEqual(self.promise_bids(rows, self.order[3]), self.promise_bids(rows2, self.order[3]))

    def test_a_table_uses_only_the_two_terms_before_it(self):
        _, settings = self.run_eval(self.sim)
        changed = dict(self.sim)
        changed[self.order[0]] = sim_rows("x", 240, 77, scale=5.0)
        _, settings2 = self.run_eval(changed)
        # order[0] is two terms before order[2] and one before order[1], but three before order[3]
        self.assertNotEqual(settings[self.order[1]]["promise"], settings2[self.order[1]]["promise"])
        self.assertNotEqual(settings[self.order[2]]["promise"], settings2[self.order[2]]["promise"])
        self.assertEqual(settings[self.order[3]]["promise"], settings2[self.order[3]]["promise"])

    def test_every_promise_bid_in_the_harness_is_odd_and_at_least_the_floor(self):
        rows, _ = self.run_eval(self.sim)
        self.assertEqual(len(rows), 240 * 3)
        for r in rows:
            for st in P.STYLES:
                self.assertGreaterEqual(r[f"bid_promise_{st}"], r["floor"])
                self.assertEqual(r[f"bid_promise_{st}"] % 2, 1)


if __name__ == "__main__":
    unittest.main()
