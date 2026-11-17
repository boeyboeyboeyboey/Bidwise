"""Evaluation harness: bid rounding, per-variant bids and fold wiring, on synthetic rows only."""
import math
import os
import random
import stat
import tempfile
import unittest
from unittest import mock

from model.forecast import correction as C

if C.IMPORT_ERROR is None:
    from model.forecast import distcal as D
    from model.forecast import evalharness as H


def sim_rows(term: str, n: int, seed: int, scale: float = 1.0) -> list:
    """Rows shaped like distcal.rows_for_term's: a conditional grid from 2000 to 2000 + 98 * step cents."""
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        step = rnd.choice((10, 30, 60))
        cq = [2000 + k * step for k in range(99)]
        filled = int(rnd.random() < 0.5)
        act = int((2000 + rnd.random() * 99 * step) * scale) if filled else 1000
        out.append({"window": "Round 1 Window 1", "course": f"C{i % 7}", "section": "G1", "cls": str(i), "instr": "X",
                    "seats": 1 if i % 3 == 0 else 5, "floor": 1000, "act": act, "filled": filled, "pfill": 0.5,
                    "p_clf": 0.9 if i % 2 else 0.4, "cond_p10": cq[9], "cond_p50": cq[49], "cond_p90": cq[89], "cq": cq})
    return out


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class SiteRound(unittest.TestCase):
    def test_floor_bid_is_kept(self):
        self.assertEqual(H.site_round(1000.0, 1000), 1001)  # even floor: the odd cent above it, not e$11.01
        self.assertEqual(H.site_round(1001.0, 1001), 1001)

    def test_raised_to_next_whole_dollar_plus_one_cent(self):
        self.assertEqual(H.site_round(1001.5, 1000), 1101)
        self.assertEqual(H.site_round(2534.2, 1000), 2601)
        self.assertEqual(H.site_round(2500.4, 1000), 2501)  # 2501 is already whole e$ + 1 cent
        self.assertEqual(H.site_round(2501.2, 1000), 2601)  # next odd cent is 2503

    def test_never_below_the_raw_quantile(self):
        rnd = random.Random(1)
        for _ in range(500):
            raw = 1000 + rnd.random() * 9000
            b = H.site_round(raw, 1000)
            self.assertGreaterEqual(b, raw)
            self.assertLess(b - raw, 101)
            self.assertEqual(b % 100, 1)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class Bids(unittest.TestCase):
    LEVELS = {"cheap": 0.9, "balanced": 0.975, "safe": 0.99}

    def test_mixture_quantile_by_hand(self):
        cq = [2000 + 10 * k for k in range(99)]
        row = {"cq": cq, "floor": 1000, "act": 1000, "filled": 0, "seats": 5, "cond_p50": cq[49], "p_clf": 0.5, "pfill": 0.5}
        b = H.bids_for([row], None, {"cheap": 0.4, "balanced": 0.75, "safe": 0.99}, False)
        self.assertEqual(b["cheap"][0], 1000)  # half the mass sits at the floor
        self.assertAlmostEqual(b["balanced"][0], 2490.0)  # u = (0.75 - 0.5) / 0.5 = 0.5 -> the 50th conditional percentile
        self.assertAlmostEqual(b["safe"][0], 2970.0)  # u = 0.98
        r = H.bids_for([row], None, {"cheap": 0.4, "balanced": 0.75, "safe": 0.99}, True)
        self.assertEqual((r["cheap"][0], r["balanced"][0], r["safe"][0]), (1001, 2501, 3001))

    def test_no_classifier_probability_or_no_grid_gives_the_floor(self):
        base = {"floor": 1000, "act": 1000, "filled": 0, "seats": 5, "pfill": 0.5}
        rows = [{**base, "cq": [2000 + k for k in range(99)], "cond_p50": 2049, "p_clf": float("nan")},
                {**base, "cq": None, "cond_p50": None, "p_clf": 0.9}]
        b = H.bids_for(rows, None, self.LEVELS, True)
        self.assertEqual(b["safe"], [1001, 1001])

    def test_styles_are_ordered_and_rounding_only_raises(self):
        rows = sim_rows("t", 60, 3)
        table = D.learn_spread(rows)[0]
        raw, rnd = H.bids_for(rows, table, self.LEVELS, False), H.bids_for(rows, table, self.LEVELS, True)
        for i in range(len(rows)):
            self.assertLessEqual(raw["cheap"][i], raw["balanced"][i])
            self.assertLessEqual(raw["balanced"][i], raw["safe"][i])
            for st in H.STYLES:
                self.assertGreaterEqual(rnd[st][i], raw[st][i])


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class Folds(unittest.TestCase):
    def setUp(self):
        self.order = ["2001-02 Term 1", "2001-02 Term 2", "2002-03 Term 1", "2002-03 Term 2"]
        self.sim = {t: sim_rows(t, 240, i, scale=1.0 + 0.4 * i) for i, t in enumerate(self.order)}
        tab = D.learn_spread(self.sim[self.order[1]] + self.sim[self.order[2]])[0]
        self.shipped = {"exponents": tab, "levels": {"cheap": {"level": 0.9}, "balanced": {"level": 0.975}, "safe": {"level": 0.99}},
                        "terms": {"test": self.order[1], "heldOut": self.order[2]}}

    def test_first_term_is_not_scored_and_n_terms_limits(self):
        rows, settings = H.eval_rows(self.sim, self.order, self.shipped, {}, 6)
        self.assertEqual(list(settings), self.order[1:])
        self.assertEqual(len(rows), 240 * 3)
        _, s2 = H.eval_rows(self.sim, self.order, self.shipped, {}, 2)
        self.assertEqual(list(s2), self.order[2:])

    def test_a_gap_before_a_term_makes_it_unscorable(self):
        sim = {t: r for t, r in self.sim.items() if t != self.order[1]}
        _, settings = H.eval_rows(sim, self.order, self.shipped, {}, 6)
        self.assertEqual(list(settings), [self.order[3]])

    def test_rolled_settings_never_use_the_scored_term(self):
        _, settings = H.eval_rows(self.sim, self.order, self.shipped, {}, 6)
        changed = dict(self.sim)
        changed[self.order[3]] = sim_rows("x", 240, 99, scale=5.0)  # other outcomes in the last term only
        _, settings2 = H.eval_rows(changed, self.order, self.shipped, {}, 6)
        for t in self.order[1:]:
            self.assertEqual(settings[t]["levels"]["rolled"], settings2[t]["levels"]["rolled"])
            self.assertEqual(settings[t]["globalExponents"]["rolled"], settings2[t]["globalExponents"]["rolled"])
        last = settings[self.order[3]]
        self.assertEqual(last["rolledExponentTerms"], self.order[1:3])
        self.assertEqual(last["rolledLevelsPickedOn"], self.order[2])
        self.assertFalse(last["rolledLevelsInSample"])
        self.assertTrue(settings[self.order[1]]["rolledLevelsInSample"])
        # distcal.json's held-out term is order[2]: its settings look ahead on that term and every earlier one, not on later ones
        for t in self.order[1:3]:
            self.assertEqual(settings[t]["lookAhead"], {"as_scored": True, "shipped": True, "rolled": False, "promise": False})
        self.assertEqual(last["lookAhead"], {"as_scored": False, "shipped": False, "rolled": False, "promise": False})

    def test_pooled_report_scores_only_the_variants_without_look_ahead(self):
        rows, settings = H.eval_rows(self.sim, self.order, self.shipped, {}, 6)
        rep, md = H.build_reports(rows, settings, {**self.shipped, "ok": True}, 50)
        self.assertEqual(list(rep["pooled"]["variants"]), ["rolled", "promise"])
        self.assertEqual(set(rep["terms"][self.order[3]]["variants"]), set(H.VARIANTS))
        self.assertIn("look-ahead: as_scored, shipped", md)
        self.assertIn("all variants out-of-sample", md)
        self.assertNotIn("failed its gate", md)
        self.assertIn("failed its gate", H.build_reports(rows, settings, {**self.shipped, "ok": False}, 50)[1])

    def test_rolled_matches_the_production_recipe(self):
        prev2, prev = self.sim[self.order[1]], self.sim[self.order[2]]
        tab, levels = H.rolled_settings(prev, prev2)
        self.assertEqual(tab, D.learn_spread(prev2 + prev)[0])
        # cross-fit: each term's rows scored with the exponents learned on the other
        _, want, by_group = D.calibrate_levels([(prev, D.learn_spread(prev2)[0]), (prev2, D.learn_spread(prev)[0])])
        self.assertEqual(levels["pooled"], {st: want[st]["level"] for st in H.STYLES})
        self.assertEqual(levels["byGroup"], {g: {st: d[st]["level"] for st in H.STYLES} for g, d in by_group.items()})

    def test_rolled_calibrates_on_the_other_terms_exponents_only(self):
        prev2, prev = self.sim[self.order[1]], self.sim[self.order[2]]
        made, seen = {}, []
        real_learn, real_arrays = D.learn_spread, D._arrays

        def learn(rows):
            res = real_learn(rows)
            made[id(res[0])] = id(rows)
            return res

        def arrays(rows, table, use_clf):
            seen.append((id(rows), made.get(id(table))))
            return real_arrays(rows, table, use_clf)

        with mock.patch.object(D, "learn_spread", learn), mock.patch.object(D, "_arrays", arrays):
            H.rolled_settings(prev, prev2)
        self.assertEqual(sorted(seen), sorted([(id(prev), id(prev2)), (id(prev2), id(prev))]))

    def test_first_fold_without_prev2_calibrates_in_sample_on_prev(self):
        prev = self.sim[self.order[0]]
        tab, levels = H.rolled_settings(prev, None)
        self.assertEqual(tab, D.learn_spread(prev)[0])
        _, want, _ = D.calibrate_levels([(prev, D.learn_spread(prev)[0])])
        self.assertEqual(levels["pooled"], {st: want[st]["level"] for st in H.STYLES})

    def test_bids_use_the_levels_of_the_rows_window_group(self):
        rows = sim_rows("t", 4, 1)
        rows[1]["window"], rows[2]["window"], rows[3]["window"] = "Round 1A Window 2", "Round 2 Window 1", "Round 2A Window 3"
        by_group = {"R1W1": {"cheap": 0.9, "balanced": 0.9, "safe": 0.9}, "R1A": {"cheap": 0.5, "balanced": 0.5, "safe": 0.99},
                    "R2": {"cheap": 0.99, "balanced": 0.99, "safe": 0.5}}  # R2A: not listed -> the pooled level
        pooled = {"cheap": 0.7, "balanced": 0.7, "safe": 0.7}
        out = H.bids_for(rows, None, pooled, False, by_group)
        for st in H.STYLES:
            for j, lv in enumerate((by_group["R1W1"][st], by_group["R1A"][st], by_group["R2"][st], pooled[st])):
                one = H.bids_for([rows[j]], None, {s: lv for s in H.STYLES}, False)
                self.assertEqual(out[st][j], one[st][0], (st, j))
        self.assertEqual(H.bids_for(rows, None, pooled, False), H.bids_for(rows, None, pooled, False, None))

    def test_old_format_distcal_json_keeps_global_levels(self):
        rows, settings = H.eval_rows(self.sim, self.order, self.shipped, {}, 1)
        self.assertEqual(settings[self.order[3]]["levels"]["shipped"], {"cheap": 0.9, "balanced": 0.975, "safe": 0.99})
        new = {**self.shipped, "levelsByGroup": {"R1W1": {st: {"level": 0.5} for st in H.STYLES}}}
        _, s2 = H.eval_rows(self.sim, self.order, new, {}, 1)
        self.assertEqual(s2[self.order[3]]["levels"]["shipped"], {"R1W1": {st: 0.5 for st in H.STYLES}})

    def test_as_scored_reproduces_distcal_level_table(self):
        # the harness row's unrounded bids must give exactly distcal._level_table's loss and overpay at the same level
        t, prev = self.order[3], self.sim[self.order[2]]
        rows, _ = H.eval_rows(self.sim, self.order, self.shipped, {}, 1)
        ref = next(r for r in D._level_table(self.sim[t], D.learn_spread(prev)[0]) if r["level"] == 0.975)
        filled = [r for r in rows if r["filled"]]
        loss = sum(r["bid_as_scored_balanced"] < r["act"] for r in filled) / len(filled)
        over = sum(max(r["bid_as_scored_balanced"] - r["act"], 0) for r in rows) / len(rows) / 100
        self.assertAlmostEqual(loss, ref["lossFilled"])
        self.assertAlmostEqual(over, ref["meanOverpay"])

    def test_row_fields(self):
        rows, _ = H.eval_rows(self.sim, self.order, self.shipped, {("2002-03 Term 2", "0"): "SCIS", "C1": "SOE"}, 1)
        r0, r1 = rows[0], rows[1]
        self.assertEqual((r0["school"], r1["school"]), ("SCIS", "SOE"))
        self.assertEqual(r0["cq50"], self.sim[self.order[3]][0]["cq"][49])
        for k in ("term", "window", "course", "section", "seats", "band", "p_fill", "filled", "act", "bid_shipped_safe", "lo_rolled"):
            self.assertIn(k, r0)
        for st in H.STYLES:
            self.assertIn(f"bid_promise_{st}", r0)
        self.assertNotIn("lo_promise", r0)  # exponents exist only for the distcal-style variants
        self.assertNotIn("hi_promise", r0)
        self.assertIn("hi_rolled", r0)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class Files(unittest.TestCase):
    def test_cache_round_trip_is_private_and_keeps_nan(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(H, "EVAL_DIR", d):
            rows = sim_rows("t", 5, 0)
            rows[0]["p_clf"] = float("nan")
            H.save_cached("2001-02 Term 1", "k", rows)
            path = H._cache_path("2001-02 Term 1", "k")
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode), 0o700)
            back = H.load_cached("2001-02 Term 1", "k")
            self.assertTrue(math.isnan(back[0]["p_clf"]))
            self.assertEqual(back[1], rows[1])
            self.assertIsNone(H.load_cached("2001-02 Term 2", "k"))

    def test_nothing_points_into_the_fit_output_for_writing(self):
        self.assertFalse(os.path.commonpath([H.EVAL_DIR, H.OUT_DIR]) == H.OUT_DIR)
        self.assertTrue(H._cache_path("a b", "k").startswith(H.EVAL_DIR + os.sep))


if __name__ == "__main__":
    unittest.main()
