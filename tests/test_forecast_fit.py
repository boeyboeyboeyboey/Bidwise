import csv
import json
import math
import tempfile
import unittest
from pathlib import Path

from model.forecast import fit
from model.forecast.fit import LAM_GRID, Config, NBTables, Obs, grid_posterior, pool_weight

COLS = ["term", "window", "course_code", "section", "class_number", "instructor", "min_bid", "median_bid", "no_bids",
        "before_process_vacancy", "after_process_vacancy", "start_times", "days"]


def row(term, window, course, section, cls, instr, before, after, mn=0.0, med=0.0, start="12:00", days="MON"):
    nb = 0 if before - after > 0 else 1
    return dict(term=term, window=window, course_code=course, section=section, class_number=cls, instructor=instr,
                min_bid=f"{mn:.2f}", median_bid=f"{med:.2f}" if med else "", no_bids=str(nb),
                before_process_vacancy=before, after_process_vacancy=after, start_times=start, days=days)


def post_mean(obs_list):
    """Posterior mean of lambda with a vague prior, for obs given as (filled, seats, succ)."""
    t = NBTables(1.0)
    ll = [0.0] * len(LAM_GRID)
    for filled, seats, succ in obs_list:
        tab = t.logsf(seats) if filled else t.logpmf(succ)
        ll = [a + b for a, b in zip(ll, tab)]
    return grid_posterior(ll, LAM_GRID, math.log(5), 3.0).mean_exp


class CensoringTests(unittest.TestCase):
    def test_unfilled_is_exact_filled_is_censored(self):
        base = dict(term="t", tidx=1, ttype="2", window="w", cls="1", course="IS1", subject="IS", section="G1",
                    instr="A", seats=30, succ=12, med=0, mn=0, floor=1000, slot="mid")
        self.assertEqual(fit.censored_demand(Obs(filled=False, **base)), ("exact", 12))
        self.assertEqual(fit.censored_demand(Obs(filled=True, **{**base, "succ": 30})), ("atleast", 30))

    def test_build_obs_rules(self):
        rows = [
            row("2025-26 Term 2", "Round 1B Window 1", "IS1", "G1", "1", "A", 30, 0, 12.0, 20.0),  # filled
            row("2025-26 Term 2", "Round 1B Window 1", "IS1", "G2", "2", "A", 30, 18, 10.0, 10.0),  # unfilled, 12 bidders
            row("2025-26 Term 2", "Round 1B Window 1", "IS1", "G3", "3", "A", 0, 0),  # no seats offered: dropped
            row("2025-26 Term 3A", "Round 1B Window 1", "IS1", "G4", "4", "A", 5, 0, 10.0, 10.0),  # 3A: dropped
            row("2025-26 Term 2", "Round 2 Window 4", "IS1", "G5", "5", "A", 5, 0, 10.0, 10.0),  # not a target window
        ]
        obs = fit.build_obs(rows)
        self.assertEqual([(o.cls, o.filled, o.succ) for o in obs], [("1", True, 30), ("2", False, 12)])
        self.assertEqual(obs[0].mn, 1200)

    def test_zero_bidders_is_exact_not_censored(self):
        o = fit.build_obs([row("2025-26 Term 2", "Round 2 Window 1", "IS1", "G1", "1", "A", 20, 20)])[0]
        self.assertEqual(fit.censored_demand(o), ("exact", 0))

    def test_censored_obs_pushes_demand_up_exact_pulls_down(self):
        filled = post_mean([(True, 40, 40)] * 4)
        unfilled_same_count = post_mean([(False, 40, 40)] * 4)  # N = 40 exactly
        none = post_mean([(False, 40, 0)] * 4)
        self.assertGreater(filled, unfilled_same_count)  # N >= 40 vs N == 40
        self.assertLess(none, 2.0)
        self.assertGreater(filled, 30)

    def test_slot_key_adds_friday(self):
        for start, days, key in (("08:30", "FRI", "early_fri"), ("12:00", "MON;FRI", "mid"), ("12:00", "FRI;MON", "mid_fri"),
                                 ("18:00", "FRI", "late_fri"), ("18:00", "TUE", "late"), ("", "", "mid")):
            self.assertEqual(fit.slot_key(start, days), key)
        rows = [row("2025-26 Term 2", "Round 1B Window 1", "IS1", "G1", "1", "A", 30, 0, 12.0, 20.0, start="08:30", days="FRI"),
                row("2025-26 Term 2", "Round 1B Window 1", "IS1", "G2", "2", "A", 30, 0, 12.0, 20.0, start="19:00", days="THU")]
        self.assertEqual([o.slot for o in fit.build_obs(rows)], ["early_fri", "late"])


def slot_obs(window, i, slot, filled, succ):
    return Obs(term="2024-25 Term 2", tidx=2 * 2024 + 1, ttype="2", window=window, cls=f"{window}{i}{slot}", course=f"{window}{i}",
               subject="IS", section="G1", instr="A", seats=30, succ=30 if filled else succ, filled=filled,
               med=0, mn=0, floor=1000, slot=slot)


class SlotEffectTests(unittest.TestCase):
    def test_window_with_few_contrasts_takes_pooled_effect(self):
        wa, wb = "Round 1B Window 1", "Round 1B Window 2"
        train = [slot_obs(wa, i, s, False, 6 if s == "early" else 0) for i in range(40) for s in ("mid", "early")]
        train += [slot_obs(wb, i, s, s == "early", 0) for i in range(5) for s in ("mid", "early")]
        pooled_d, pooled_p = fit.estimate_slot_effects(train)
        by_w = fit.estimate_slot_effects_by_window(train, pooled_d, pooled_p)
        own_a = fit.estimate_slot_effects([o for o in train if o.window == wa])[0]["early"]
        self.assertAlmostEqual(by_w[wa][0]["early"], own_a)
        self.assertNotAlmostEqual(own_a, pooled_d["early"])
        self.assertAlmostEqual(by_w[wb][0]["early"], pooled_d["early"])
        self.assertAlmostEqual(by_w[wb][0]["late_fri"], 0.0)


class PairOrderTests(unittest.TestCase):
    def test_pair_order(self):
        def r(slot, act, pred, filled=1, window="w"):
            return dict(term="t", window=window, course="C", slot=slot, filled=filled, act=act, cond_p50=pred)
        rows = [r("early", 3000, 3200), r("mid", 2000, 2500), r("late", 2500, 2500), r("mid", 1000, 4000),
                r("late", 2000, 3500),  # same actual as the mid 2000 row: that pair is skipped
                r("early", 9000, 1, filled=0), r("early", 9000, 1, window="other")]  # unfilled / other window: not paired
        self.assertEqual(fit.pair_order(rows), (35.71, 7))
        self.assertEqual(fit.pair_order([r("mid", 1000, 1), r("mid", 2000, 2)]), (None, 0))


class PoolingTests(unittest.TestCase):
    def test_pool_weight(self):
        self.assertEqual(pool_weight(0, 3), 0.0)
        self.assertAlmostEqual(pool_weight(3, 3), 0.5)
        self.assertLess(pool_weight(2, 3), pool_weight(10, 3))
        self.assertLess(pool_weight(10, 3), 1.0)

    def test_obs_weight_decay_and_cross_term(self):
        self.assertEqual(fit.obs_weight(0, True, 0.7, 0.5), 1.0)
        self.assertAlmostEqual(fit.obs_weight(2, True, 0.7, 0.5), 0.49)
        self.assertAlmostEqual(fit.obs_weight(0, False, 0.7, 0.5), 0.5)

    def test_posterior_moves_from_parent_toward_data_with_volume(self):
        t = NBTables(1.0)
        parent = math.log(5.0)
        means = []
        for n in (0, 1, 3, 10):
            ll = [0.0] * len(LAM_GRID)
            for _ in range(n):
                ll = [a + b for a, b in zip(ll, t.logpmf(40))]  # data says lambda ~ 40
            means.append(grid_posterior(ll, LAM_GRID, parent, 0.7).mean_x)
        self.assertAlmostEqual(means[0], parent, places=1)
        self.assertEqual(means, sorted(means))
        self.assertGreater(means[-1], math.log(20))

    def test_no_own_history_falls_back_to_parent(self):
        rows = []
        for yr, t in ((2022, "2022-23 Term 2"), (2023, "2023-24 Term 2"), (2024, "2024-25 Term 2")):
            for i in range(6):
                rows.append(row(t, "Round 1B Window 1", f"IS10{i}", "G1", f"{yr}{i}", "X", 30, 0, 20.0, 30.0))
        obs = fit.build_obs(rows)
        m = fit.Model(obs, 2 * 2025 + 1, "2", Config(use_slot=False))
        sp, meta = m.params_for("IS999", "NOBODY", "Round 1B Window 1", "mid", 1000)
        self.assertEqual(meta["pooledLevel"], "subject")
        sp2, meta2 = m.params_for("IS100", "X", "Round 1B Window 1", "mid", 1000)
        self.assertEqual(meta2["pooledLevel"], "course×instructor")
        sp3, meta3 = m.params_for("ZZ1", "Y", "Round 1B Window 1", "mid", 1000)
        self.assertEqual(meta3["pooledLevel"], "global")
        self.assertGreater(sp.demandMean, sp3.demandMean * 0.5)


class EndToEndTests(unittest.TestCase):
    def test_fixture_end_to_end(self):
        w = "Round 1B Window 1"
        rows = []
        for t in ("2022-23 Term 2", "2023-24 Term 2", "2024-25 Term 2", "2025-26 Term 2"):
            for i in range(3):  # hot courses: fill, clear around e$40
                rows.append(row(t, w, f"HOT{i}", "G1", f"{t[:4]}h{i}", "P", 30, 0, 38.0 + i, 44.0 + i))
                rows.append(row(t, w, f"COLD{i}", "G1", f"{t[:4]}c{i}", "Q", 30, 28, 10.0, 10.0))  # 2 bidders
            for j, other in enumerate(x for x in fit.WINDOWS if x != w):  # one filler row per other window: the term counts as complete
                rows.append(row(t, other, "FILL1", "G1", f"{t[:4]}f{j}", "Z", 30, 28, 10.0, 10.0))
        for i in range(3):
            rows.append(row("2026-27 Term 2", "Round 1 Window 1", f"HOT{i}", "G1", f"cur-h{i}", "P", 30, 30))
            rows.append(row("2026-27 Term 2", "Round 1 Window 1", f"COLD{i}", "G1", f"cur-c{i}", "Q", 30, 30))
        with tempfile.TemporaryDirectory() as d:
            src, out = Path(d) / "in.csv", Path(d) / "out"
            out.mkdir()
            with open(src, "w", newline="") as f:
                wr = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
                wr.writeheader()
                wr.writerows(rows)
            cfg = Config(use_slot=False)
            (out / "calibration.json").write_text(json.dumps({"config": {**cfg.__dict__}}))
            rc = fit.main(["--csv", str(src), "--out", str(out), "--reuse-calibration", "--procs", "1",
                           "--current-term", "2026-27 Term 2"])
            self.assertEqual(rc, 0)
            bt = json.loads((out / "backtest.json").read_text())
            for k in ("coverage80", "maeCents", "samples", "byWindow", "calibration", "baseline", "forecasts_ok"):
                self.assertIn(k, bt)
            self.assertEqual(bt["samples"], 6 + len(fit.WINDOWS) - 1)  # 6 hot/cold + one filler per other window
            self.assertGreater(bt["baseline"]["samples"], 0)
            name = "params-2026-27-term-2.json" if bt["forecasts_ok"] else "params-2026-27-term-2.rejected.json"
            params = json.loads((out / name).read_text())
            hot, cold = params["classes"]["cur-h0"]["windows"][w], params["classes"]["cur-c0"]["windows"][w]
            self.assertGreater(hot["demandMean"], 30)
            self.assertLess(cold["demandMean"], 10)
            self.assertGreater(hot["priceLevelCents"], 2500)
            self.assertEqual(params["classes"]["cur-h0"]["minBidCents"], 1000)
            self.assertEqual(hot["pooledLevel"], "course×instructor")
            self.assertEqual(hot["nObs"], 4)
            self.assertEqual(set(params["classes"]["cur-h0"]["windows"]), set(fit.WINDOWS))
            self.assertEqual(sorted(k for k in hot if k not in ("pooledLevel", "nObs")),
                             sorted(["demandMean", "demandDispersion", "priceLevelCents", "priceSigma", "anchorSigma", "anchorShare", "anchorCents"]))



ROOT = Path(__file__).resolve().parent.parent
TODAY_CSV = ROOT / "data/derived-captures-20261112T135954/bids_with_schedule.csv"


def full(*terms, windows=None):
    return {(t, w) for t in terms for w in (windows or fit.WINDOWS)}


class DeriveRolesTests(unittest.TestCase):
    def test_current_term_type_2_skips_term_1_and_terms_after_current(self):
        tw = full("2027-28 Term 1", "2026-27 Term 2", "2026-27 Term 1", "2025-26 Term 2", "2025-26 Term 1", "2024-25 Term 2", "2024-25 Term 1")
        self.assertEqual(fit.derive_roles(tw, "2026-27 Term 2"),
                         {"heldOut": "2026-27 Term 1", "test": "2025-26 Term 2", "validation": "2024-25 Term 2"})

    def test_current_term_type_1(self):
        tw = full("2026-27 Term 1", "2025-26 Term 2", "2025-26 Term 1", "2024-25 Term 2", "2024-25 Term 1", "2023-24 Term 1")
        self.assertEqual(fit.derive_roles(tw, "2026-27 Term 1"),
                         {"heldOut": "2025-26 Term 2", "test": "2025-26 Term 1", "validation": "2024-25 Term 1"})

    def test_held_out_of_the_current_type_is_not_reused_as_test(self):
        tw = full("2025-26 Term 2", "2025-26 Term 1", "2024-25 Term 2", "2023-24 Term 2")
        self.assertEqual(fit.derive_roles(tw, "2026-27 Term 2"),
                         {"heldOut": "2025-26 Term 2", "test": "2024-25 Term 2", "validation": "2023-24 Term 2"})

    def test_incomplete_term_and_term_3_are_skipped(self):
        short = [w for w in fit.WINDOWS if w != fit.WINDOWS[-1]]  # 11 windows
        tw = (full("2026-27 Term 1", "2024-25 Term 2", "2023-24 Term 2") | full("2025-26 Term 2", windows=short)
              | full("2025-26 Term 3A", "2025-26 Term 3B"))
        self.assertEqual(fit.derive_roles(tw, "2026-27 Term 2"),
                         {"heldOut": "2026-27 Term 1", "test": "2024-25 Term 2", "validation": "2023-24 Term 2"})

    def test_input_order_does_not_matter(self):
        tw = sorted(full("2026-27 Term 1", "2025-26 Term 2", "2024-25 Term 2"), reverse=True)
        self.assertEqual(fit.derive_roles(tw, "2026-27 Term 2")["validation"], "2024-25 Term 2")

    def test_errors_when_a_role_cannot_be_filled(self):
        with self.assertRaises(ValueError):
            fit.derive_roles(set(), "2026-27 Term 2")
        with self.assertRaises(ValueError):  # no second complete Term 2 for validation
            fit.derive_roles(full("2026-27 Term 1", "2025-26 Term 2"), "2026-27 Term 2")
        with self.assertRaises(ValueError):
            fit.derive_roles(full("2025-26 Term 2"), "2026-27 Term 3A")


class CurrentTermTests(unittest.TestCase):
    def test_term_and_params_names_from_site_window_file(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "site_window.json"
            p.write_text(json.dumps({"currentTerm": "2027-28 Term 1"}))
            term = fit.site_window_term(str(p))
        self.assertEqual(term, "2027-28 Term 1")
        self.assertEqual(fit.params_names(term), ("params-2027-28-term-1.json", "params-2027-28-term-1.rejected.json"))
        self.assertEqual(fit.params_names("2026-27 Term 2")[0], "params-2026-27-term-2.json")

    def test_site_build_reads_the_file_the_refit_writes(self):
        import importlib.util  # noqa: PLC0415
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location("bsd_params", root / "model/build_site_data.py")
        bsd = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bsd)
        for term in ("2026-27 Term 2", "2027-28 Term 1"):
            self.assertEqual(bsd.default_params_path(term).name, fit.params_names(term)[0])


@unittest.skipUnless(TODAY_CSV.exists(), "private dataset not present")
class TodaysDataTests(unittest.TestCase):
    def test_roles_on_the_2026_11_12_dataset(self):
        obs = fit.build_obs(fit.load_rows(str(TODAY_CSV)))
        self.assertEqual(fit.derive_roles({(o.term, o.window) for o in obs}, "2026-27 Term 2"),
                         {"heldOut": "2026-27 Term 1", "test": "2025-26 Term 2", "validation": "2024-25 Term 2"})



if __name__ == "__main__":
    unittest.main()
