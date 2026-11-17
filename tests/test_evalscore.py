import json
import math
import time
import unittest

import numpy as np

from model.forecast import evalscore as E
from model.forecast.fit import WINDOWS


def row(bid, act, filled=1, course="C1", seats=1, p_fill=float("nan"), window=WINDOWS[0], term="T1", band=0, school="S"):
    r = {"term": term, "window": window, "course": course, "section": "G1", "seats": seats, "school": school,
         "band": band, "p_fill": p_fill, "filled": filled, "act": act, "floor": 1000 if not filled else 500}
    for s in E.STYLES:
        r[f"bid_v_{s}"] = bid
    return r


def synth(n_courses, per_course, seed=1, dup=1):
    rng = np.random.default_rng(seed)
    rows = []
    for c in range(n_courses):
        for _ in range(per_course):
            act = int(rng.integers(1000, 4000))
            bid = act + int(rng.integers(-800, 1500))
            r = row(bid, act, filled=int(rng.random() < 0.7), course=f"C{c}")
            rows += [dict(r) for _ in range(dup)]
    return rows


class MetricsTest(unittest.TestCase):
    def test_win_loss_tie_and_overpay(self):
        rows = [
            row(2000, 2000, 1),   # tie: win, overpay 0
            row(3000, 2000, 1),   # win, overpay 10
            row(1500, 2000, 1),   # loss
            row(1600, 1000, 0),   # unfilled, beats floor: counts in all-rows overpay (6.00), not in won-filled
        ]
        m = E.style_metrics(rows, "v", "cheap")
        self.assertEqual((m["n"], m["nFilled"]), (4, 3))
        self.assertAlmostEqual(m["winFilled"], round(2 / 3, 4))
        self.assertAlmostEqual(m["lossFilled"], round(1 / 3, 4))
        self.assertAlmostEqual(m["winAll"], 0.75)
        self.assertAlmostEqual(m["overpayAllMean"], (0 + 10 + 0 + 6) / 4)
        ow = m["overpayWonFilled"]
        self.assertEqual(ow["n"], 2)
        self.assertAlmostEqual(ow["mean"], 5.0)
        self.assertAlmostEqual(ow["median"], 5.0)
        self.assertAlmostEqual(ow["p90"], 9.0)
        self.assertAlmostEqual(m["bidMean"], (20 + 30 + 15 + 16) / 4)
        self.assertAlmostEqual(m["bidMeanFilled"], 65 / 3, places=3)
        self.assertEqual(m["shareOverBudget"], 0.0)

    def test_over_budget_share(self):
        m = E.style_metrics([row(13000, 1000), row(12500, 1000)], "v", "safe")
        self.assertAlmostEqual(m["shareOverBudget"], 0.5)
        self.assertAlmostEqual(m["budgetShareMean"], (13000 + 12500) / 2 / 12500)

    def test_empty_denominators(self):
        m = E.style_metrics([row(1000, 900, 0)], "v", "balanced")
        self.assertIsNone(m["winFilled"])
        self.assertIsNone(m["lossFilled"])
        self.assertIsNone(m["overpayWonFilled"]["mean"])
        self.assertIsNone(m["bidMeanFilled"])
        e = E.style_metrics([], "v", "balanced")
        self.assertIsNone(e["winAll"])
        self.assertIsNone(e["bidMedian"])
        ci = E.bootstrap_ci([row(1000, 900, 0)], "v", "cheap", n_boot=50)
        self.assertIsNone(ci["winFilled"])
        self.assertIsNotNone(ci["winAll"])


class KeysTest(unittest.TestCase):
    def test_seat_class(self):
        self.assertEqual([E.seat_class(s) for s in (1, 2, 3, 4, 40)], ["1", "2-3", "2-3", "4+", "4+"])

    def test_window_group(self):
        got = [E.window_group(WINDOWS[i]) for i in (0, 1, 3, 4, 5, 6, 8, 9, 11)]
        self.assertEqual(got, ["R1W1", "R1A", "R1A", "R1B", "R1B", "R2", "R2", "R2A", "R2A"])
        self.assertEqual(E.window_group("Round 3 Window 1"), "other")

    def test_split_order(self):
        rows = [row(1, 1, window=WINDOWS[i], seats=s, band=b) for i, s, b in ((9, 5, 4), (0, 1, 0), (4, 2, 2))]
        self.assertEqual([e["key"] for e in E.split_report(rows, "v", "window_group")], ["R1W1", "R1B", "R2A"])
        self.assertEqual([e["key"] for e in E.split_report(rows, "v", "seat_class")], ["1", "2-3", "4+"])
        self.assertEqual([e["key"] for e in E.split_report(rows, "v", "band")], ["<15", "25-40", "60+"])
        small = E.split_report(rows, "v", "band", min_filled=2)
        self.assertTrue(all(e.get("small") for e in small))


class FillReliabilityTest(unittest.TestCase):
    def test_hand_example(self):
        rows = [row(1, 1, filled=f, p_fill=p) for p, f in ((0.05, 0), (0.15, 0), (0.15, 1), (1.0, 1), (0.95, 0))]
        rows.append(row(1, 1, filled=1, p_fill=float("nan")))
        r = E.fill_reliability(rows, bins=10)
        self.assertEqual(r["n"], 5)
        self.assertEqual([(b["lo"], b["n"]) for b in r["bins"]], [(0.0, 1), (0.1, 2), (0.9, 2)])
        last = r["bins"][-1]
        self.assertAlmostEqual(last["meanPred"], 0.975)
        self.assertAlmostEqual(last["observed"], 0.5)
        brier = (0.05 ** 2 + 0.15 ** 2 + 0.85 ** 2 + 0 + 0.95 ** 2) / 5
        self.assertAlmostEqual(r["brier"], round(brier, 4))
        ece = (1 * 0.05 + 2 * abs(0.15 - 0.5) + 2 * abs(0.975 - 0.5)) / 5
        self.assertAlmostEqual(r["ece"], round(ece, 4))

    def test_all_nan(self):
        self.assertEqual(E.fill_reliability([row(1, 1)])["brier"], None)


class BootstrapTest(unittest.TestCase):
    def test_deterministic_and_contains_point(self):
        rows = synth(60, 5)
        a = E.bootstrap_ci(rows, "v", "cheap", n_boot=500, seed=7)
        self.assertEqual(a, E.bootstrap_ci(rows, "v", "cheap", n_boot=500, seed=7))
        self.assertEqual(a["nCourses"], 60)
        m = E.style_metrics(rows, "v", "cheap")
        for k in ("winFilled", "winAll", "overpayAllMean"):
            lo, hi = a[k]
            self.assertLess(lo, hi)
            self.assertTrue(lo <= m[k] <= hi, k)

    def test_single_course_degenerate(self):
        rows = synth(1, 20)
        m = E.style_metrics(rows, "v", "cheap")
        ci = E.bootstrap_ci(rows, "v", "cheap", n_boot=200)
        for k in ("winFilled", "winAll", "overpayAllMean"):
            self.assertEqual(ci[k][0], ci[k][1])
            self.assertAlmostEqual(ci[k][0], m[k], places=3)

    def test_clusters_by_course(self):
        # Duplicating every row 5x inside its course leaves a course-level bootstrap unchanged;
        # a row-level bootstrap would shrink the interval by about sqrt(5).
        base = E.bootstrap_ci(synth(40, 1), "v", "cheap", n_boot=400, seed=3)
        dup = E.bootstrap_ci(synth(40, 1, dup=5), "v", "cheap", n_boot=400, seed=3)
        for k in ("winFilled", "winAll", "overpayAllMean"):
            self.assertAlmostEqual(base[k][0], dup[k][0], delta=1e-3)
            self.assertAlmostEqual(base[k][1], dup[k][1], delta=1e-3)

    def test_speed(self):
        rows = synth(1500, 27)
        t = time.perf_counter()
        E.bootstrap_ci(rows, "v", "safe", n_boot=1000)
        self.assertLess(time.perf_counter() - t, 1.0)


class ReportTest(unittest.TestCase):
    def test_build_and_render(self):
        rows = synth(30, 4)
        for i, r in enumerate(rows):
            r["p_fill"] = (i % 10) / 10
            r["term"] = "T1" if i % 2 else "T2"
        targets = {"cheap": 0.90, "balanced": 0.975, "safe": 0.99}
        rep = E.build_report(rows, ["v"], n_boot=100, targets=targets)
        json.dumps(rep, allow_nan=False)
        self.assertEqual(rep["terms"], ["T1", "T2"])
        self.assertEqual(rep["displayed"], targets)
        self.assertIn("ci", rep["variants"]["v"]["bySchool"][0])
        md = E.render_markdown(rep, "Eval")
        self.assertIsInstance(md, str)
        for s in E.STYLES:
            self.assertIn(s, md)
        self.assertFalse(math.isnan(rep["fill"]["brier"]))


if __name__ == "__main__":
    unittest.main()
