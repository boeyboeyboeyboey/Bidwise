"""distcal's bid levels (pooled and per window group, cross-fit calibration) and the measured filled win rates, on synthetic rows."""
import random
import unittest
from unittest import mock

from model.forecast import correction as C
from model.forecast import fit

if C.IMPORT_ERROR is None:
    from model.forecast import distcal as D

W = {"R1W1": "Round 1 Window 1", "R1A": "Round 1A Window 1", "R1B": "Round 1B Window 2", "R2": "Round 2 Window 1", "R2A": "Round 2A Window 3"}


def rows_in(group_counts: dict, seed: int, act_scale: dict | None = None, median=2000, fill_rate=0.6, act_fixed=None) -> list:
    """Rows shaped like distcal.rows_for_term's. group_counts {group: n rows}; the actual bid of a filled row is the conditional
    median times a lognormal factor, scaled per group by act_scale; act_fixed overrides it."""
    rnd = random.Random(seed)
    out = []
    for g, n in group_counts.items():
        for i in range(n):
            m = median * rnd.choice((1, 2, 4))
            cq = [int(m * (0.5 + k / 98)) for k in range(99)]
            filled = int(rnd.random() < fill_rate)
            act = int(m * rnd.lognormvariate(0, 0.35) * (act_scale or {}).get(g, 1.0)) if filled else 1000
            out.append({"window": W[g], "course": f"C{i % 5}", "section": "G1", "cls": f"{g}{i}", "instr": "X", "seats": 1 + i % 3,
                        "floor": 1000, "act": act_fixed or act, "filled": filled,
                        "pfill": 0.5, "p_clf": 0.5 + 0.4 * rnd.random(), "cond_p10": cq[9], "cond_p50": cq[49], "cond_p90": cq[89], "cq": cq})
    return out


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class CalibrateLevels(unittest.TestCase):
    def test_a_group_with_few_filled_rows_takes_the_pooled_level(self):
        # R2A: 40 rows (about 24 filled) with much higher actual bids; it must not get its own levels
        rows = rows_in({"R1W1": 400, "R1A": 400, "R2A": 40}, 1, act_scale={"R2A": 3.0})
        tab = D.learn_spread(rows)[0]
        table, pooled, by_group = D.calibrate_levels([(rows, tab)])
        self.assertEqual(list(by_group), list(D.GROUPS))
        for st in D.STYLES:
            e = by_group["R2A"][st]
            self.assertFalse(e["own"])
            self.assertEqual(e["level"], pooled[st]["level"])
            self.assertLess(e["nFilled"], D.MIN_CELL)
        self.assertEqual(by_group["R1B"]["safe"]["nFilled"], 0)
        self.assertFalse(by_group["R1B"]["safe"]["own"])
        for g in ("R1W1", "R1A"):
            self.assertTrue(all(by_group[g][st]["own"] and by_group[g][st]["nFilled"] >= D.MIN_CELL for st in D.STYLES))
        self.assertEqual(table, D._level_table(rows, tab))

    def test_an_own_group_gets_the_level_picked_on_its_rows_and_it_differs_when_the_group_behaves_differently(self):
        rows = rows_in({"R1W1": 500, "R1A": 500}, 2, act_scale={"R1A": 2.0})
        tab = D.learn_spread(rows)[0]
        _, pooled, by_group = D.calibrate_levels([(rows, tab)])
        own = D.pick_levels(D._level_table([r for r in rows if r["window"] == W["R1A"]], tab))
        for st in D.STYLES:
            self.assertEqual(by_group["R1A"][st]["level"], own[st]["level"])
            self.assertEqual(by_group["R1A"][st]["lossFilled"], own[st]["lossFilled"])
        # the dearer group needs the higher level for the same loss target
        self.assertGreater(by_group["R1A"]["balanced"]["level"], by_group["R1W1"]["balanced"]["level"])
        self.assertTrue(by_group["R1W1"]["balanced"]["level"] <= pooled["balanced"]["level"] <= by_group["R1A"]["balanced"]["level"])

    def test_cal_pairs_are_pooled_and_each_scored_with_its_own_table(self):
        a, b = rows_in({"R1W1": 300}, 3), rows_in({"R1W1": 300}, 4, act_scale={"R1W1": 1.5})
        ta, tb = D.learn_spread(a)[0], D.learn_spread(b)[0]
        table, _, _ = D.calibrate_levels([(a, ta), (b, tb)])
        Qa, pa, fa, ca, la = D._arrays(a, ta, True)
        Qb, pb, fb, cb, lb = D._arrays(b, tb, True)
        import numpy as np
        want = D._level_table_arr(np.concatenate([Qa, Qb]), np.concatenate([pa, pb]), np.concatenate([fa, fb]),
                                  np.concatenate([ca, cb]), np.concatenate([la, lb]))
        self.assertEqual(table, want)

    def test_uq_takes_a_level_per_row(self):
        import numpy as np
        Q = np.array([np.linspace(1000, 1980, 99)] * 2)
        p, floor = np.array([0.3, 0.3]), np.array([100.0, 100.0])
        got = D._uq(Q, p, floor, np.array([0.5, 0.85]))
        self.assertEqual(got[0], 100.0)
        self.assertAlmostEqual(got[1], Q[1, 49])

    def test_row_levels(self):
        rows = [{"window": W["R1W1"]}, {"window": W["R2A"]}, {"window": "Window X"}]
        got = D.row_levels(rows, {"R1W1": {"cheap": {"level": 0.4}}}, {"cheap": {"level": 0.7}}, "cheap")
        self.assertEqual(list(got), [0.4, 0.7, 0.7])
        self.assertEqual(list(D.row_levels(rows, None, {"cheap": 0.7}, "cheap")), [0.7] * 3)


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class MeasuredWin(unittest.TestCase):
    def test_cell_group_and_all_fallbacks(self):
        # filled rows (rate 1): R1W1 has medians 2000/4000/8000 -> bands 1, 2, 3 (about 200 filled rows each per fold pair);
        # R1A is a handful of rows (group falls back to all); R2: enough rows for the group, spread over the same bands
        rt = rows_in({"R1W1": 600, "R1A": 10, "R2": 330}, 5, fill_rate=1.0)
        rh = rows_in({"R1W1": 600, "R1A": 10, "R2": 330}, 6, fill_rate=1.0)
        tt, th = D.learn_spread(rt)[0], D.learn_spread(rh)[0]
        mw = D.measured_win(rt, rh, tt, th)
        self.assertEqual(list(mw), list(D.GROUPS) + ["overall"])
        for g in D.GROUPS:
            self.assertEqual(list(mw[g]), [str(b) for b in range(D.N_BANDS)])
        nb = {b: sum(1 for r in rt + rh if r["window"] == W["R1W1"] and D._band(r["cond_p50"]) == b) for b in range(D.N_BANDS)}
        for b in range(D.N_BANDS):
            cell = mw["R1W1"][str(b)]
            if nb[b] >= D.MIN_CELL:
                self.assertEqual((cell["source"], cell["nFilled"]), ("cell", nb[b]))
            else:
                self.assertEqual((cell["source"], cell["nFilled"]), ("group", 1200))
        self.assertEqual(sum(1 for b in range(D.N_BANDS) if nb[b] >= D.MIN_CELL), 3)
        self.assertEqual(mw["R1W1"]["0"]["source"], "group")
        self.assertEqual(mw["R1A"]["2"], {**mw["R1A"]["2"], "source": "all", "nFilled": 1220 + 660 + 0})
        self.assertEqual(mw["R1B"]["1"]["source"], "all")  # no rows at all
        for st in D.STYLES:
            self.assertEqual(mw["R1B"]["1"][st], mw["overall"][st])
            self.assertEqual(round(mw["overall"][st], 4), mw["overall"][st])
            self.assertTrue(0 <= mw["overall"][st] <= 1)
        self.assertLessEqual(mw["overall"]["cheap"], mw["overall"]["balanced"] + 1e-9)
        self.assertLessEqual(mw["overall"]["balanced"], mw["overall"]["safe"] + 1e-9)

    def test_rates_are_exact_on_a_trivial_case(self):
        # actual bid = the floor: every site-rounded bid is at least the floor, so every style wins every filled row
        rt = rows_in({"R1W1": 300}, 7, fill_rate=1.0, act_fixed=1000)
        rh = rows_in({"R1W1": 300}, 8, fill_rate=1.0, act_fixed=1000)
        mw = D.measured_win(rt, rh, D.learn_spread(rt)[0], D.learn_spread(rh)[0])
        self.assertEqual(mw["overall"], {"cheap": 1.0, "balanced": 1.0, "safe": 1.0})
        # an unreachable actual bid: nobody wins
        rt = rows_in({"R1W1": 300}, 7, fill_rate=1.0, act_fixed=10 ** 7)
        rh = rows_in({"R1W1": 300}, 8, fill_rate=1.0, act_fixed=10 ** 7)
        mw = D.measured_win(rt, rh, D.learn_spread(rt)[0], D.learn_spread(rh)[0])
        self.assertEqual(mw["overall"], {"cheap": 0.0, "balanced": 0.0, "safe": 0.0})

    def test_each_fold_picks_levels_on_one_term_and_applies_them_to_the_other(self):
        calls = []
        real = D.calibrate_levels

        def spy(cal):
            calls.append([(id(rs), id(tab)) for rs, tab in cal])
            return real(cal)

        rt, rh = rows_in({"R1W1": 300}, 9), rows_in({"R1W1": 300}, 10, act_scale={"R1W1": 1.4})
        tt, th = D.learn_spread(rt)[0], D.learn_spread(rh)[0]
        with mock.patch.object(D, "calibrate_levels", spy):
            D.measured_win(rt, rh, tt, th)
        # levels picked on rt with the exponents of rh, and on rh with the exponents of rt
        self.assertEqual(calls, [[(id(rt), id(th))], [(id(rh), id(tt))]])


@unittest.skipIf(C.IMPORT_ERROR is not None, "numpy/pandas/scikit-learn unavailable")
class BacktestPayload(unittest.TestCase):
    def setUp(self):
        self.rt = rows_in({"R1W1": 250, "R1A": 250, "R2": 120}, 11)
        self.rh = rows_in({"R1W1": 250, "R1A": 250, "R2": 120}, 12, act_scale={"R1A": 1.3})
        self.cfg = fit.Config(runs=1500)

    def run_bt(self):
        return D.backtest_distcal(None, None, None, self.cfg, None, "T1", "T2", rows={"T1": self.rt, "T2": self.rh})

    def test_levels_are_cross_fit_never_scored_with_exponents_learned_on_the_same_rows(self):
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
            payload = self.run_bt()
        rt, rh = id(self.rt), id(self.rh)
        self.assertIn((rh, rt), seen)
        self.assertIn((rt, rh), seen)
        self.assertNotIn((rh, rh), seen)  # held-out rows are never scored with exponents learned on themselves
        self.assertEqual(seen.count((rt, rt)), 1)  # the test term only by the labelled in-sample metric
        want = D.calibrate_levels([(self.rh, D.learn_spread(self.rt)[0]), (self.rt, D.learn_spread(self.rh)[0])])
        self.assertEqual(payload["levelTable"], want[0])
        self.assertEqual(payload["levels"], want[1])
        self.assertEqual(payload["levelsByGroup"], want[2])

    def test_payload_shape(self):
        p = self.run_bt()
        self.assertEqual(p["distcalVersion"], "distcal-a2")
        self.assertEqual(p["bandEdges"], [15, 25, 40, 60])
        self.assertEqual(len(p["levelTable"]), 140)
        self.assertEqual(set(p["levels"]), {"cheap", "balanced", "safe"})
        self.assertEqual(set(p["levels"]["safe"]), {"level", "lossFilled", "lossAll", "winAboveFloor", "meanOverpay", "reached"})
        self.assertEqual(list(p["levelsByGroup"]), list(D.GROUPS))
        self.assertEqual(set(p["levelsByGroup"]["R1W1"]["cheap"]), {"level", "lossFilled", "reached", "nFilled", "own"})
        self.assertFalse(p["levelsByGroup"]["R2A"]["safe"]["own"])
        self.assertEqual(list(p["measuredWin"]), list(D.GROUPS) + ["overall"])
        self.assertEqual(set(p["measuredWin"]["R1W1"]["1"]), {"cheap", "balanced", "safe", "nFilled", "source"})


if __name__ == "__main__":
    unittest.main()


class VersionCompat(unittest.TestCase):
    def test_a1_payload_still_accepted(self):
        """The site build must keep using a distcal.json written before per-window-group levels (distcal-a1)."""
        cfg = fit.Config()
        payload = {**D._identifiers(cfg), "ok": True}
        for v in ("distcal-a1", D.DISTCAL_VERSION):
            payload["distcalVersion"] = v
            self.assertIsNone(D.invalid_reason(payload, cfg), v)
        payload["distcalVersion"] = "distcal-a0"
        self.assertIsNotNone(D.invalid_reason(payload, cfg))
