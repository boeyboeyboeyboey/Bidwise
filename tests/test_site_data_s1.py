"""Site data additions: affordable highlights, browse day/time, accuracy.json."""
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("build_site_data", ROOT / "model/build_site_data.py")
bsd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bsd)


def _rows(bids):
    return [{"code": f"C{i:03d}", "bidCents": b} for i, b in enumerate(bids)]


class WithAffordable(unittest.TestCase):
    def test_every_balance_on_the_ladder_still_lists_limit_rows(self):
        ranked = _rows(sorted([40000 + 100 * i for i in range(30)] + [500 * i for i in range(1, 60)], reverse=True))
        kept = bsd.with_affordable(ranked, 8)
        for cap in bsd.AFFORDABLE_LADDER_CENTS:
            want = [r for r in ranked if r["bidCents"] <= cap][:8]
            got = [r for r in kept if r["bidCents"] <= cap][:8]
            self.assertEqual(got, want, cap)

    def test_keeps_rank_order_without_duplicates_and_is_smaller_than_input(self):
        ranked = _rows(sorted(range(100, 100 * 400, 100), reverse=True))
        kept = bsd.with_affordable(ranked, 8)
        self.assertEqual([r["code"] for r in kept], sorted({r["code"] for r in kept}))  # rank order = code order here
        self.assertEqual(kept[:8], ranked[:8])
        self.assertLess(len(kept), len(ranked))

    def test_short_lists_unchanged(self):
        ranked = _rows([900, 500, 100])
        self.assertEqual(bsd.with_affordable(ranked, 8), ranked)
        self.assertEqual(bsd.with_affordable([], 8), [])

    def test_all_cheap_list_is_just_the_top(self):
        ranked = _rows([900 - i for i in range(50)])
        self.assertEqual(bsd.with_affordable(ranked, 8), ranked[:8])


class BrowseSlot(unittest.TestCase):
    def test_slot_table_and_column(self):
        rows = bsd.load_rows(ROOT / "tests/fixtures/site_data_fixture.csv")
        index, _ = bsd.build(rows, "2026-27 Term 2")
        man, shards = bsd.build_browse(rows, index)
        c = man["columns"].index("slot")
        code = man["codes"].index("AAA101")
        seen = set()
        for sh in shards.values():
            for r in sh["rows"]:
                if r[c] != -1:
                    seen.add((r[0] == code, tuple(man["slots"][r[c]])))
        self.assertIn((True, ("MON; THU", "08:15; 15:30", "11:30; 18:45")), seen)
        self.assertTrue(all(isinstance(s, list) and len(s) == 3 for s in man["slots"]))
        self.assertEqual(len({tuple(s) for s in man["slots"]}), len(man["slots"]))  # one entry per distinct slot

    def test_no_timetable_is_minus_one(self):
        self.assertIsNone(bsd._slot_of({"days": None, "start": "", "end": None}))
        self.assertIsNone(bsd._slot_of({"days": "MON", "start": "", "end": ""}))
        self.assertEqual(bsd._slot_of({"days": "MON", "start": "09:00", "end": ""}), ("MON", "09:00", None))


class Accuracy(unittest.TestCase):
    def test_from_backtest_shape(self):
        bt = {
            "term": "T-a",
            "overall": {"term": "T-a", "samples": 10, "filled": 4, "coverage80": 0.8, "coverage80Filled": 0.75, "maeCents": 3.5,
                        "baseline": {"samples": 9, "maeCents": 6.5, "maeFilledCents": 20.0, "modelMaeFilledCondOnSameSamples": 15.5}},
            "heldOut": {"term": "T-b", "samples": 7, "filled": 6, "coverage80": 0.82, "coverage80Filled": 0.8, "maeCents": 5.5,
                        "baseline": {"samples": 6, "maeCents": 7.5, "maeFilledCents": 21.0, "modelMaeFilledCondOnSameSamples": 13.5}},
        }
        a = bsd.build_accuracy(bt)
        self.assertEqual(a["filledTests"], [
            {"term": "T-a", "filled": 4, "fMae": 15.5, "fBase": 20.0, "fCov": 0.75},
            {"term": "T-b", "filled": 6, "fMae": 13.5, "fBase": 21.0, "fCov": 0.8}])
        self.assertEqual(a["heldOut"], {"term": "T-b", "n": 7, "baseN": 6, "mae": 5.5, "base": 7.5, "cov": 0.82})

    def test_accuracy_basis_only_for_the_corrected_model(self):
        bt = {"overall": {"term": "T", "filled": 1, "coverage80Filled": 0.8,
                          "baseline": {"modelMaeFilledCondOnSameSamples": 1.0, "maeFilledCents": 2.0}}}
        self.assertNotIn("accuracyBasis", bsd.build_accuracy(bt))
        self.assertNotIn("accuracyBasis", bsd.build_accuracy(bt, "fit"))
        self.assertEqual(bsd.build_accuracy(bt, "fit+gbm-b2")["accuracyBasis"], "next-window")
        params = {"windows": [], "term": "T"}
        full = {"coverage80": 0.8, "maeCents": 1.0, "samples": 1, "byWindow": {}, "baseline": {}}
        self.assertNotIn("accuracyBasis", bsd.build_forecast_meta(params, full, "t"))
        self.assertEqual(bsd.build_forecast_meta(params, full, "t", "fit+gbm-b2")["accuracyBasis"], "next-window")

    def test_median_miss_on_filled_sections_is_added_when_present(self):
        bt = {"overall": {"term": "T-a", "filled": 4, "coverage80Filled": 0.75, "medianAbsErrFilledCondCents": 700,
                          "baseline": {"modelMaeFilledCondOnSameSamples": 15.5, "maeFilledCents": 20.0}},
              "heldOut": {"term": "T-b", "filled": 6, "coverage80Filled": 0.8, "medianAbsErrFilledCondCents": 776,
                          "baseline": {"modelMaeFilledCondOnSameSamples": 13.5, "maeFilledCents": 21.0}}}
        a = bsd.build_accuracy(bt)
        self.assertEqual([t["fMed"] for t in a["filledTests"]], [700, 776])

    def test_missing_pieces_are_left_out_not_invented(self):
        self.assertEqual(bsd.build_accuracy(None), {"filledTests": [], "heldOut": None})
        a = bsd.build_accuracy({"overall": {"term": "T", "filled": 1}})
        self.assertEqual(a, {"filledTests": [], "heldOut": None})


class AccuracyMatchesModelOutput(unittest.TestCase):
    def test_current_backtest_gives_the_published_numbers(self):
        p = ROOT / "model/forecast/out/backtest.json"
        if not p.exists():
            self.skipTest("no backtest.json")
        a = bsd.build_accuracy(json.loads(p.read_text()))
        by = {t["term"]: t for t in a["filledTests"]}
        self.assertEqual(set(by), {"2025-26 Term 2", "2026-27 Term 1"})
        self.assertEqual(by["2025-26 Term 2"], {"term": "2025-26 Term 2", "filled": 1302, "fMae": 1527.5, "fBase": 2179.6, "fCov": 0.8425, "fMed": 989})
        self.assertEqual(by["2026-27 Term 1"], {"term": "2026-27 Term 1", "filled": 1696, "fMae": 1305.41, "fBase": 2019.66, "fCov": 0.8054, "fMed": 884})
        self.assertEqual(a["heldOut"], {"term": "2026-27 Term 1", "n": 7243, "baseN": 6989, "mae": 515.67, "base": 697.1, "cov": 0.8172})


if __name__ == "__main__":
    unittest.main()
