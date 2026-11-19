import importlib.util
import json
import io
import re
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests/fixtures/site_data_fixture.csv"
_spec = importlib.util.spec_from_file_location("build_site_data", ROOT / "model/build_site_data.py")
bsd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bsd)


def _browse_for(csv_rows, first_term=None):
    rows = [dict(r) for r in csv_rows]
    index, _ = bsd.build(rows, "2026-27 Term 2")
    manifest, shards = bsd.build_browse(rows, index, first_term)
    return manifest, shards


class BrowseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = bsd.load_rows(FIXTURE)
        cls.man, cls.shards = _browse_for(cls.rows)
        cls.col = {n: i for i, n in enumerate(cls.man["columns"])}

    def all_rows(self):
        return [r for sh in self.shards.values() for r in sh["rows"]]

    def test_one_row_per_csv_row_split_by_term(self):
        self.assertEqual(len(self.all_rows()), len(self.rows))
        self.assertEqual(list(self.shards), ["browse/2022-23-term-1.json", "browse/2022-23-term-3a.json",
                                             "browse/2025-26-term-2.json", "browse/2026-27-term-2.json"])
        self.assertEqual([t["rows"] for t in self.man["terms"]], [len(s["rows"]) for s in self.shards.values()])

    def test_strings_are_deduplicated_lookups(self):
        for key in ("windows", "sections", "instructors", "codes"):
            self.assertEqual(len(self.man[key]), len(set(self.man[key])), key)
        c = self.col
        for r in self.all_rows():
            self.assertIsInstance(r[c["course"]], int)
            self.assertTrue(all(isinstance(r[c[k]], int) for k in ("window", "section", "instructor")))
        # titles and schools are not repeated here: they come from index.json via the course position
        self.assertNotIn("title", json.dumps(self.man))
        self.assertNotIn("Intro Alpha", json.dumps(self.shards))

    def test_values_roundtrip_against_csv(self):
        c = self.col
        sh = self.shards["browse/2025-26-term-2.json"]["rows"]
        code = self.man["codes"].index("AAA101")
        g1 = [r for r in sh if r[c["course"]] == code and self.man["sections"][r[c["section"]]] == "G1"]
        by_window = {self.man["windows"][r[c["window"]]]: r for r in g1}
        w1 = by_window["Round 1A Window 1"]
        self.assertEqual((w1[c["medianCents"]], w1[c["minCents"]], w1[c["vacancy"]], w1[c["before"]], w1[c["after"]]),
                         (1250, 1001, 40, 40, 5))
        self.assertEqual(self.man["instructors"][w1[c["instructor"]]], "LEE, YUN")
        nobid = by_window["Round 1A Window 2"]
        self.assertIsNone(nobid[c["medianCents"]])
        self.assertIsNone(nobid[c["minCents"]])

    def test_filled_flag_matches_rows_ts_rule(self):
        c = self.col
        for r in self.all_rows():
            v, a = r[c["vacancy"]], r[c["after"]]
            self.assertEqual(r[c["filled"]], 1 if (v is not None and v > 0 and a == 0) else 0)
        self.assertTrue(any(r[c["filled"]] for r in self.all_rows()))
        self.assertTrue(any(not r[c["filled"]] for r in self.all_rows()))

    def test_filled_edge_cases(self):
        base = self.rows[0]
        def one(vacancy, after):
            r = dict(base, vacancy=vacancy, after_process_vacancy=after)
            man, shards = _browse_for([r])
            return next(iter(shards.values()))["rows"][0][man["columns"].index("filled")]
        self.assertEqual(one("0", "0"), 0)   # no seats offered is not "filled"
        self.assertEqual(one("10", "0"), 1)
        self.assertEqual(one("10", "1"), 0)
        self.assertEqual(one("10", ""), 0)   # unknown after is not filled

    def test_first_term_cuts_older_terms(self):
        man, shards = _browse_for(self.rows, "2026-27 Term 2")
        self.assertEqual([t["term"] for t in man["terms"]], ["2026-27 Term 2"])
        self.assertEqual(len(list(shards.values())[0]["rows"]), sum(r["term"] == "2026-27 Term 2" for r in self.rows))


class UnitTests(unittest.TestCase):
    def test_window_order_keeps_round_1_and_1a_separate(self):
        r = bsd.window_rank
        self.assertLess(r("Incoming Exchange Rnd 1C Win 3"), r("Incoming Freshmen Rnd 1 Win 1"))
        self.assertLess(r("Round 1 Window 1"), r("Round 1A Window 1"))
        self.assertLess(r("Round 1A Window 3"), r("Round 1B Window 1"))
        self.assertLess(r("Round 1B Window 2"), r("Round 2 Window 1"))
        self.assertLess(r("Round 2 Window 4"), r("Round 2A Window 1"))
        self.assertEqual(len(set(bsd.WINDOW_ORDER)), len(bsd.WINDOW_ORDER))

    def test_unknown_window_fails(self):
        with self.assertRaises(bsd.BuildError):
            bsd.window_rank("Round 9 Window 1")

    def test_term_order(self):
        terms = ["2026-27 Term 1", "2025-26 Term 3B", "2025-26 Term 3A", "2025-26 Term 2", "2025-26 Term 1"]
        self.assertEqual(sorted(terms, key=bsd.term_key), terms[::-1])
        with self.assertRaises(bsd.BuildError):
            bsd.term_key("Term 2")

    def test_cents_conversion_is_exact(self):
        self.assertEqual(bsd.to_cents("12.50"), 1250)
        self.assertEqual(bsd.to_cents("0.10"), 10)
        self.assertEqual(bsd.to_cents("1.15"), 115)  # float 1.15*100 would be 114.99999
        self.assertEqual(bsd.to_cents("0.00"), 0)

    def _row(self, **kw):
        base = dict(meeting_count="1", days="MON", start_times="08:15", end_times="11:30", venues="Room 1",
                    class_number="1", term="2026-27 Term 2", median_bid="", min_bid="0.00", no_bids="1",
                    window="Round 1 Window 1", section="G1", instructor="A, B", vacancy="10",
                    before_process_vacancy="10", after_process_vacancy="5", enrolled="5")
        base.update(kw)
        return base

    def test_no_bids_gives_nulls_not_zero(self):
        h = bsd.history_entry(self._row())
        self.assertIsNone(h["medianCents"])
        self.assertIsNone(h["minCents"])
        real_zero = bsd.history_entry(self._row(no_bids="0", median_bid="0.00", min_bid="0.00"))
        self.assertEqual(real_zero["medianCents"], 0)

    def test_multi_meeting_split(self):
        m = bsd.parse_meetings(self._row(meeting_count="2", days="MON; THU", start_times="08:15; 15:30",
                                         end_times="11:30; 18:45", venues="Room 1; Room 2"))
        self.assertEqual(m, [
            {"day": "MON", "start": "08:15", "end": "11:30", "venue": "Room 1"},
            {"day": "THU", "start": "15:30", "end": "18:45", "venue": "Room 2"},
        ])

    def test_tba_and_empty(self):
        m = bsd.parse_meetings(self._row(days="TBA", start_times="TBA", end_times="TBA", venues=""))
        self.assertEqual(m, [{"day": "TBA", "start": None, "end": None, "venue": None}])
        self.assertEqual(bsd.parse_meetings(self._row(meeting_count="0", days="", start_times="",
                                                      end_times="", venues="")), [])

    def test_meeting_count_mismatch_fails(self):
        with self.assertRaises(bsd.BuildError):
            bsd.parse_meetings(self._row(meeting_count="2"))


class RoundToHour(unittest.TestCase):
    def test_nearest_hour_keeps_the_offset(self):
        for given, want in (("2026-11-12T00:03:33.123456+08:00", "2026-11-12T00:00:00+08:00"),
                            ("2026-11-07T09:42:10+08:00", "2026-11-07T10:00:00+08:00"),
                            ("2026-12-31T23:45:00+08:00", "2027-01-01T00:00:00+08:00"),
                            ("2026-11-07T09:30:00+08:00", "2026-11-07T10:00:00+08:00"),
                            ("2026-11-07T09:29:59+08:00", "2026-11-07T09:00:00+08:00"),
                            ("2026-11-07T09:29:59.999999+08:00", "2026-11-07T09:00:00+08:00"),
                            ("2026-11-07T09:42:10", "2026-11-07T10:00:00"),
                            ("2026-11-14T23:40:00+0800", "2026-11-15T00:00:00+08:00"),
                            ("2026-11-12T20:30:00+00:00", "2026-11-12T21:00:00+00:00")):
            self.assertEqual(bsd.round_to_hour(given), want, given)

    def test_nothing_to_round_is_returned_unchanged(self):
        for given in (None, "", "t", "nonsense", "2026-11-07", "2026-13-45T99:00:00", 5):
            self.assertEqual(bsd.round_to_hour(given), given)


class ResultsPartialTests(unittest.TestCase):
    def load(self, text=None):
        import shutil
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        csv_path = Path(tmp.name) / "bids_with_schedule.csv"
        shutil.copy(FIXTURE, csv_path)
        if text is not None:
            (Path(tmp.name) / "dataset-meta.json").write_text(text)
        with redirect_stderr(io.StringIO()) as err:
            return bsd.load_results_partial(csv_path), err.getvalue(), csv_path

    def test_reads_window_and_counts_only(self):
        got, _, _ = self.load(json.dumps({"results_partial": {
            "window": "Round 1B Window 1", "posted": 3900, "expected": 4050, "accepted_at": "2026-11-10T11:00:00+08:00"}}))
        self.assertEqual(got, {"window": "Round 1B Window 1", "posted": 3900, "expected": 4050})

    def test_null_or_missing_file_is_none_without_warning(self):
        self.assertEqual(self.load('{"results_partial": null}')[:2], (None, ""))
        self.assertEqual(self.load()[:2], (None, ""))
        self.assertEqual(self.load("{}")[0], None)

    def test_malformed_is_none_with_warning(self):
        for text in ("{not json", "[]", '{"results_partial": "x"}', '{"results_partial": {"window": "Round 9", "posted": 1, "expected": 2}}',
                     '{"results_partial": {"window": "Round 1B Window 1", "posted": "3", "expected": 2}}',
                     '{"results_partial": {"window": "Round 1B Window 1", "posted": true, "expected": 2}}',
                     '{"results_partial": {"window": "Round 1B Window 1", "posted": -1, "expected": 2}}'):
            got, err, _ = self.load(text)
            self.assertIsNone(got, text)
            if text != "[]":
                self.assertIn("skipped", err, text)

    def test_build_writes_it_to_meta_without_time_or_paths(self):
        _, _, csv_path = self.load(json.dumps({"results_partial": {
            "window": "Round 1B Window 1", "posted": 5, "expected": 9, "accepted_at": "2026-11-10T11:00:00+08:00"}}))
        out = csv_path.parent / "site"
        cfg = csv_path.parent / "cfg.json"
        cfg.write_text(json.dumps({"currentTerm": "2026-27 Term 2", "current": {"round": "1B", "window": 1, "status": "open"},
                                   "schedule": [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]}))
        with redirect_stderr(io.StringIO()):
            rc = bsd.main(["--csv", str(csv_path), "--out", str(out), "--window-config", str(cfg),
                           "--availability", str(csv_path.parent / "none.csv"), "--generated-at", "2026-11-10T12:00:00+08:00"])
        self.assertEqual(rc, 0)
        meta = json.loads((out / "meta.json").read_text())
        self.assertEqual(meta["resultsPartial"], {"window": "Round 1B Window 1", "posted": 5, "expected": 9})
        self.assertNotIn("accepted_at", json.dumps(meta))


class ChooseWindow(unittest.TestCase):
    # Mirrors site/src/lib/data/window.test.ts: keep the two in step.
    CUR = {"round": "1B", "window": 1, "status": "open"}
    SCHED = [
        {"round": "1B", "window": 2, "opensAt": "2026-11-10T17:00:00+08:00", "closesAt": "2026-11-12T10:00:00+08:00"},
        {"round": "1B", "window": 1, "opensAt": "2026-11-06T17:00:00+08:00", "closesAt": "2026-11-10T10:00:00+08:00"},
        {"round": "2", "window": 1, "opensAt": "2027-01-11T10:00:00+08:00", "closesAt": "2027-01-13T10:00:00+08:00"},
    ]  # deliberately out of order

    def pick(self, now, sched=None):
        w = bsd.choose_window(self.SCHED if sched is None else sched, self.CUR, datetime.fromisoformat(now))
        return (w["round"], w["window"], w["status"])

    def test_inside_a_window(self):
        self.assertEqual(self.pick("2026-11-08T12:00"), ("1B", 1, "open"))
        self.assertEqual(self.pick("2026-11-11T09:00+08:00"), ("1B", 2, "open"))

    def test_mid_round_gap(self):
        self.assertEqual(self.pick("2026-11-10T12:00"), ("1B", 2, "upcoming"))

    def test_between_rounds(self):
        self.assertEqual(self.pick("2026-11-20T12:00"), ("2", 1, "upcoming"))

    def test_before_first_and_after_last(self):
        self.assertEqual(self.pick("2026-11-01T00:00"), ("1B", 1, "upcoming"))
        self.assertEqual(self.pick("2027-02-01T00:00"), ("2", 1, "closed"))

    def test_boundaries_open_at_opens_and_closed_at_closes(self):
        self.assertEqual(self.pick("2026-11-06T17:00"), ("1B", 1, "open"))
        self.assertEqual(self.pick("2026-11-06T16:59:59"), ("1B", 1, "upcoming"))
        self.assertEqual(self.pick("2026-11-10T10:00"), ("1B", 2, "upcoming"))
        self.assertEqual(self.pick("2027-01-13T10:00"), ("2", 1, "closed"))

    def test_naive_time_is_sgt(self):
        self.assertEqual(self.pick("2026-11-10T09:59:59+08:00"), self.pick("2026-11-10T09:59:59"))
        self.assertEqual(self.pick("2026-11-10T02:00:00+00:00"), ("1B", 2, "upcoming"))  # 10:00 SGT

    def test_result_carries_opens_and_closes(self):
        w = bsd.choose_window(self.SCHED, self.CUR, datetime.fromisoformat("2026-11-20T12:00"))
        self.assertEqual((w["opensAt"], w["closesAt"]), ("2027-01-11T10:00:00+08:00", "2027-01-13T10:00:00+08:00"))

    def test_unreadable_schedule_falls_back_to_configured_current(self):
        bad = [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]
        err = io.StringIO()
        with redirect_stderr(err):
            self.assertEqual(self.pick("2030-01-01T00:00", bad), ("1B", 1, "open"))
            with self.assertRaises(bsd.BuildError):
                bsd.choose_window([], self.CUR, datetime.fromisoformat("2030-01-01T00:00"))
        self.assertIn("warning", err.getvalue())

    def test_main_now_flag_sets_meta_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "w.json"
            cfg.write_text(json.dumps({"currentTerm": "2026-27 Term 2", "current": self.CUR, "schedule": self.SCHED}))
            out = Path(tmp) / "real"
            rc = bsd.main(["--csv", str(FIXTURE), "--out", str(out), "--window-config", str(cfg),
                           "--availability", str(Path(tmp) / "none.csv"), "--now", "2026-11-20T12:00"])
            self.assertEqual(rc, 0)
            w = json.loads((out / "meta.json").read_text())["window"]
            self.assertEqual((w["round"], w["window"], w["status"], w["opensAt"]),
                             ("2", 1, "upcoming", "2027-01-11T10:00:00+08:00"))
            self.assertEqual(json.loads((out / "highlights.json").read_text())["window"], "Round 2 Window 1")


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "real"
        cls.cfg = Path(cls.tmp.name) / "w.json"
        cls.cfg.write_text(json.dumps({
            "currentTerm": "2026-27 Term 2",
            "current": {"round": "1B", "window": 1, "status": "open"},
            "schedule": [
                {"round": "1A", "window": 3, "opensAt": "a", "closesAt": "b"},
                {"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"},
            ]}))
        stale = cls.out / "courses"
        stale.mkdir(parents=True)
        (stale / "OLD.json").write_text("{}")
        cls.rc = bsd.main(["--csv", str(FIXTURE), "--out", str(cls.out), "--window-config", str(cls.cfg),
                           "--availability", str(Path(cls.tmp.name) / "none.csv"),
                           "--generated-at", "2026-11-05T12:00:00+08:00"])
        cls.meta = json.loads((cls.out / "meta.json").read_text())
        cls.index = {e["code"]: e for e in json.loads((cls.out / "index.json").read_text())}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def course(self, code):
        return json.loads((self.out / "courses" / f"{code}.json").read_text())

    def test_exit_ok_and_stale_cleared(self):
        self.assertEqual(self.rc, 0)
        self.assertFalse((self.out / "courses" / "OLD.json").exists())

    def test_meta(self):
        self.assertEqual(self.meta["sourceRows"], 20)
        self.assertIsNone(self.meta["resultsPartial"])  # the fixture dir has no dataset-meta.json
        self.assertGreaterEqual(self.meta["sourceTerms"], 1)
        self.assertEqual(self.meta["latestResultsWindow"], "Round 1A Window 1")
        self.assertEqual(self.meta["window"], {"term": "2026-27 Term 2", "round": "1B", "window": 1,
                                               "opensAt": "c", "closesAt": "d", "status": "open"})

    def test_meta_has_no_paths_or_hashes(self):
        blob = json.dumps(self.meta)
        self.assertNotIn("sourceCsv", self.meta)
        self.assertNotRegex(blob, r"[0-9a-f]{32,}")  # no file hash
        self.assertNotRegex(blob, r"\.(csv|json)\b")  # no file names
        self.assertNotIn("/", re.sub(r"\d{4}-\d{2}-\d{2}T[^\"]*", "", blob))  # no paths (timestamps aside)

    def test_browse_manifest_and_shards(self):
        man = json.loads((self.out / "browse.json").read_text())
        self.assertEqual(man["codes"], sorted(self.index))
        self.assertEqual([t["term"] for t in man["terms"]],
                         ["2022-23 Term 1", "2022-23 Term 3A", "2025-26 Term 2", "2026-27 Term 2"])  # chronological
        total = 0
        for t in man["terms"]:
            shard = json.loads((self.out / t["file"]).read_text())
            self.assertEqual(shard["term"], t["term"])
            self.assertEqual(len(shard["rows"]), t["rows"])
            total += len(shard["rows"])
            for row in shard["rows"]:
                self.assertEqual(len(row), len(man["columns"]))
        self.assertEqual(total, 20)

    def test_index(self):
        self.assertEqual(set(self.index), {"AAA101", "BBB202", "CCC303", "COR-XYZ1", "DDD404", "EEE505"})
        a = self.index["AAA101"]
        self.assertEqual((a["offeredNow"], a["sectionsNow"], a["termsWithData"]), (True, 2, 2))
        self.assertEqual(a["title"], "Intro Alpha II")  # latest description wins
        self.assertFalse(self.index["BBB202"]["offeredNow"])
        self.assertEqual(self.index["BBB202"]["sectionsNow"], 0)
        self.assertEqual(self.index["DDD404"]["termsWithData"], 2)

    def test_history_counts_and_order(self):
        total = sum(len(self.course(c)["history"]) for c in self.index)
        self.assertEqual(total, 20)
        h = self.course("AAA101")["history"]
        order = [(x["term"], x["window"], x["section"]) for x in h]
        self.assertEqual(order[:3], [("2025-26 Term 2", "Round 1 Window 1", "G1"),
                                     ("2025-26 Term 2", "Round 1A Window 1", "G1"),
                                     ("2025-26 Term 2", "Round 1A Window 1", "G2")])
        self.assertEqual(h[0]["medianCents"], 300)
        self.assertEqual(h[3]["medianCents"], None)  # 1A W2, no bids
        d = [x["term"] for x in self.course("DDD404")["history"]]
        self.assertEqual(d, sorted(d))  # 2022-23 Term 1 before Term 3A

    def test_sections_now(self):
        s = {x["section"]: x for x in self.course("AAA101")["sectionsNow"]}
        g1 = s["G1"]
        self.assertEqual(g1["latestWindow"], "Round 1A Window 1")
        self.assertEqual((g1["seatsTotal"], g1["seatsLeft"], g1["enrolled"]), (40, 12, 28))
        self.assertEqual(len(g1["meetings"]), 2)
        self.assertEqual(g1["startDate"], "2027-01-11")
        self.assertFalse(g1["tba"])
        x = self.course("COR-XYZ1")["sectionsNow"][0]
        self.assertTrue(x["tba"])
        c = self.course("CCC303")["sectionsNow"][0]
        self.assertEqual((c["meetings"], c["hasClassDetails"], c["startDate"]), ([], False, None))

    def test_negative_vacancy_kept_raw(self):
        h = [x for x in self.course("DDD404")["history"] if x["term"] == "2022-23 Term 3A"][0]
        self.assertEqual(h["after"], -1)
        self.assertEqual(len(h["days"].split("; ")), 3)

    def test_unknown_window_in_csv_fails(self):
        bad = Path(self.tmp.name) / "bad.csv"
        bad.write_text(FIXTURE.read_text().replace("Round 2A Window 2", "Round 9 Window 9"))
        rc = bsd.main(["--csv", str(bad), "--out", str(Path(self.tmp.name) / "bad_out"),
                       "--window-config", str(self.cfg)])
        self.assertEqual(rc, 1)

    def test_validation_catches_missing_rows(self):
        (self.out / "courses" / "EEE505.json").rename(self.out / "courses" / "EEE505.bak")
        try:
            rows = bsd.load_rows(FIXTURE)
            self.assertTrue(bsd.validate(self.out, rows, "2026-27 Term 2"))
        finally:
            (self.out / "courses" / "EEE505.bak").rename(self.out / "courses" / "EEE505.json")


WINDOW = "Round 1B Window 1"


def _fc(demand, level):
    return {"demandMean": demand, "demandDispersion": 0.4, "priceLevelCents": level, "priceSigma": 0.5,
            "anchorSigma": 0.3, "anchorShare": 0.3, "anchorCents": 1000.0, "pooledLevel": "course", "nObs": 3}


def _params(term="2026-27 Term 2", ok=True):
    def cls(course, section, demand, level):
        return {"course": course, "section": section, "instructor": "X", "minBidCents": 1000, "slot": "mid",
                "windows": {WINDOW: _fc(demand, level)}}
    return {"forecasts_ok": ok, "term": term, "windows": [WINDOW], "config": {}, "classes": {
        "2001": cls("AAA101", "G1", 60.0, 3000.0),   # 12 seats, heavy demand: contested
        "2002": cls("AAA101", "G2", 60.0, 3000.0),   # 0 seats left: skipped
        "2101": cls("COR-XYZ1", "G1", 2.0, 1000.0),  # 60 seats, little demand: won't fill
        "2301": cls("EEE505", "G1", 30.0, 1500.0),   # 4 seats
    }}


def _backtest():
    def bw(filled, cov):
        return {"samples": 700, "filled": filled, "coverage80": 0.8, "coverage80Filled": cov, "maeCents": 100.0,
                "baseline": {"samples": 600, "maeCents": 150.5}}
    return {"coverage80": 0.82, "maeCents": 264.49, "samples": 6945,
            "byWindow": {WINDOW: bw(120, 0.82)},
            "baseline": {"samples": 6516, "maeCents": 494.69, "modelMaeOnSameSamples": 248.79}}


class ForecastUnit(unittest.TestCase):
    def test_confidence_needs_coverage_in_band_and_enough_filled(self):
        c = bsd.window_confidence
        self.assertEqual(c({"coverage80Filled": 0.77, "filled": 163}), "ok")
        self.assertEqual(c({"coverage80Filled": 0.90, "filled": 50}), "ok")
        self.assertEqual(c({"coverage80Filled": 0.77, "filled": 49}), "low")
        self.assertEqual(c({"coverage80Filled": 0.61, "filled": 200}), "low")
        self.assertEqual(c({"coverage80Filled": 0.95, "filled": 200}), "low")
        self.assertEqual(c({"coverage80Filled": None, "filled": 200}), "low")

    def test_params_skipped_when_not_ok_or_wrong_term(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "p.json"
            f.write_text(json.dumps(_params(ok=False)))
            self.assertIsNone(bsd.load_forecast_params(f, "2026-27 Term 2"))
            f.write_text(json.dumps(_params(term="2025-26 Term 2")))
            self.assertIsNone(bsd.load_forecast_params(f, "2026-27 Term 2"))
            f.write_text(json.dumps(_params()))
            self.assertIsNotNone(bsd.load_forecast_params(f, "2026-27 Term 2"))
            self.assertIsNone(bsd.load_forecast_params(Path(d) / "missing.json", "2026-27 Term 2"))

    def test_forecast_meta_marks_windows(self):
        m = bsd.build_forecast_meta(_params(), _backtest(), "t")
        self.assertEqual(m["byWindow"][WINDOW]["confidence"], "ok")
        self.assertEqual(m["byWindow"][WINDOW]["baselineMaeCents"], 150.5)
        self.assertEqual(m["baseline"], {"samples": 6516, "maeCents": 494.69, "modelMaeCents": 248.79})
        self.assertEqual((m["coverage80"], m["samples"]), (0.82, 6945))
        self.assertEqual(bsd.build_forecast_meta(None, None, "t")["windows"], [])


class ForecastEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.out = d / "real"
        cfg = d / "w.json"
        cfg.write_text(json.dumps({
            "currentTerm": "2026-27 Term 2",
            "current": {"round": "1B", "window": 1, "status": "open"},
            "schedule": [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]}))
        (d / "p.json").write_text(json.dumps(_params()))
        (d / "b.json").write_text(json.dumps(_backtest()))
        cls.rc = bsd.main(["--csv", str(FIXTURE), "--out", str(cls.out), "--window-config", str(cfg),
                           "--params", str(d / "p.json"), "--backtest", str(d / "b.json"),
                           "--generated-at", "2026-11-05T12:00:00+08:00"])
        cls.out_off = d / "off"
        cls.rc_off = bsd.main(["--csv", str(FIXTURE), "--out", str(cls.out_off), "--window-config", str(cfg),
                               "--params", str(d / "missing.json")])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_sections_carry_forecast_and_min_bid(self):
        self.assertEqual(self.rc, 0)
        doc = json.loads((self.out / "courses" / "AAA101.json").read_text())
        s = {x["section"]: x for x in doc["sectionsNow"]}
        self.assertEqual(s["G1"]["minBidCents"], 1000)
        self.assertEqual(set(s["G1"]["forecast"]), {WINDOW})
        self.assertEqual(set(s["G1"]["forecast"][WINDOW]), set(bsd.SIM_PARAM_KEYS) | {"pooledLevel", "nObs"})
        ccc = json.loads((self.out / "courses" / "CCC303.json").read_text())["sectionsNow"][0]
        self.assertNotIn("forecast", ccc)  # no fitted params: key absent, not empty

    def test_highlights_use_current_window_and_seats_left(self):
        h = json.loads((self.out / "highlights.json").read_text())
        self.assertEqual(h["window"], WINDOW)
        self.assertEqual(list(h["byWindow"]), [WINDOW])  # one entry per forecast window
        w = h["byWindow"][WINDOW]
        contested = [(r["code"], r["section"]) for r in w["mostContested"]]
        self.assertIn(("AAA101", "G1"), contested)
        self.assertNotIn(("AAA101", "G2"), contested + [(r["code"], r["section"]) for r in w["easy"]])  # 0 seats
        self.assertEqual(w["easy"][0]["code"], "COR-XYZ1")
        self.assertTrue(all(r["pFill"] >= 0.3 for r in w["mostContested"]))
        bids = [r["bidCents"] for r in w["mostContested"]]
        self.assertEqual(bids, sorted(bids, reverse=True))

    def test_highlight_bid_is_course_page_quantity(self):
        # Course page: group 1, 90% target, FORECAST_RUNS / FORECAST_SEED. Same inputs must give the same bid.
        self.assertEqual((bsd.HIGHLIGHT_RUNS, bsd.HIGHLIGHT_SEED, bsd.HIGHLIGHT_TARGET), (20000, 12345, 0.9))
        h = json.loads((self.out / "highlights.json").read_text())
        self.assertEqual((h["runs"], h["targetP"]), (20000, 0.9))
        doc = json.loads((self.out / "courses" / "AAA101.json").read_text())
        g1 = next(x for x in doc["sectionsNow"] if x["section"] == "G1")
        sim = bsd._load_sim()
        p = sim.SimParams(**{k: g1["forecast"][WINDOW][k] for k in bsd.SIM_PARAM_KEYS})
        res = sim.simulate(g1["seatsLeft"], 1, g1["minBidCents"], p, runs=20000, seed=12345)
        w = h["byWindow"][WINDOW]
        row = next(r for r in w["mostContested"] + w["easy"] if (r["code"], r["section"]) == ("AAA101", "G1"))
        self.assertEqual(row["bidCents"], sim.recommend_bid(res, 0.9))
        self.assertEqual(row["bidCents"] % 2, 1)

    def test_forecast_meta_written(self):
        m = json.loads((self.out / "forecast-meta.json").read_text())
        self.assertEqual(m["windows"], [WINDOW])
        self.assertEqual(m["generatedAt"], "2026-11-05T12:00:00+08:00")

    def test_without_params_files_exist_but_empty(self):
        self.assertEqual(self.rc_off, 0)
        self.assertEqual(json.loads((self.out_off / "forecast-meta.json").read_text())["windows"], [])
        h = json.loads((self.out_off / "highlights.json").read_text())
        self.assertEqual(h["byWindow"], {})
        doc = json.loads((self.out_off / "courses" / "AAA101.json").read_text())
        self.assertNotIn("forecast", doc["sectionsNow"][0])


class AccuracyWithoutBacktest(unittest.TestCase):
    def test_existing_accuracy_is_kept_when_there_are_no_figures(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            (out / "accuracy.json").write_text('{"old": true}', encoding="utf-8")
            err = io.StringIO()
            with redirect_stderr(err):
                bsd.write_outputs(out, {}, {}, {}, {"x": 1}, {"term": "t"}, None, bsd.build_accuracy(None))
            self.assertEqual(json.loads((out / "accuracy.json").read_text(encoding="utf-8")), {"old": True})
            self.assertIn("accuracy.json left as it was", err.getvalue())

    def test_empty_accuracy_is_written_when_no_file_exists(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            bsd.write_outputs(out, {}, {}, {}, {"x": 1}, {"term": "t"}, None, bsd.build_accuracy(None))
            self.assertEqual(json.loads((out / "accuracy.json").read_text(encoding="utf-8")), {"filledTests": [], "heldOut": None})


if __name__ == "__main__":
    unittest.main()


class LiveSeats(unittest.TestCase):
    TERM = "2026-27 Term 2"
    HEADER = ("term,window,captured_at,seats_source,course_code,section,class_number,total,enrolled,reserved,"
              "available,section_status,description\n")

    def _file(self, body: str) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = Path(tmp.name) / "current_availability.csv"
        p.write_text(self.HEADER + body, encoding="utf-8")
        return p

    def test_term_filter_source_mapping_and_no_private_fields(self):
        p = self._file(
            f"{self.TERM},Round 1B Window 1,2026-11-07T09:42:39+08:00,live_scan,AAA101,G1,1,48,40,2,6,Open,x\n"
            f"{self.TERM},Round 1B Window 1,2026-11-07T09:42:39+08:00,approx_previous_window,AAA102,G1,2,27,,,0,,x\n"
            "2025-26 Term 2,Round 1B Window 1,2026-11-07T09:42:39+08:00,live_scan,AAA101,G2,3,30,1,1,9,Open,x\n")
        live, summary = bsd.load_live_seats(p, self.TERM)
        self.assertEqual(set(live), {("AAA101", "G1"), ("AAA102", "G1")})
        self.assertEqual(live[("AAA101", "G1")], {"available": 6, "total": 48, "source": "live",
                                                  "capturedAt": "2026-11-07T09:42:39+08:00",
                                                  "window": "Round 1B Window 1"})
        self.assertEqual(live[("AAA102", "G1")]["source"], "approx")
        self.assertEqual(live[("AAA102", "G1")]["available"], 0)
        self.assertEqual(summary, {"capturedAt": "2026-11-07T09:42:39+08:00", "window": "Round 1B Window 1",
                                   "live": 1, "approx": 1})

    def test_attach_joins_on_course_and_section(self):
        docs = {"AAA101": {"sectionsNow": [{"section": "G1"}, {"section": "G9"}]}, "ZZZ999": {"sectionsNow": []}}
        n = bsd.attach_live_seats(docs, {("AAA101", "G1"): {"available": 6, "total": 48, "source": "live",
                                                          "capturedAt": "t", "window": "w"}})
        self.assertEqual(n, 1)
        self.assertEqual(docs["AAA101"]["sectionsNow"][0]["live"]["available"], 6)
        self.assertNotIn("live", docs["AAA101"]["sectionsNow"][1])

    def test_bad_rows_skipped_missing_file_and_none(self):
        p = self._file(f"{self.TERM},w,t,live_scan,AAA101,G1,1,48,,,,Open,x\n"
                       f"{self.TERM},w,t,weird,AAA101,G2,1,48,,,3,Open,x\n")
        self.assertEqual(bsd.load_live_seats(p, self.TERM), ({}, None))
        self.assertEqual(bsd.load_live_seats(p.parent / "missing.csv", self.TERM), ({}, None))
        self.assertEqual(bsd.load_live_seats(None, self.TERM), ({}, None))

    def test_main_builds_with_and_without_file(self):
        avail = self._file(f"{self.TERM},Round 1B Window 1,2026-11-07T09:42:39+08:00,live_scan,AAA101,G1,1,48,40,2,6,Open,x\n")
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Path(tmp.name) / "w.json"
        cfg.write_text(json.dumps({"currentTerm": self.TERM, "current": {"round": "1B", "window": 1, "status": "open"},
                                   "schedule": [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]}))
        results = {}
        for name, a in (("with", avail), ("without", Path(tmp.name) / "nope.csv")):
            out = Path(tmp.name) / name
            rc = bsd.main(["--csv", str(FIXTURE), "--out", str(out), "--window-config", str(cfg),
                           "--availability", str(a), "--generated-at", "2026-11-05T12:00:00+08:00"])
            self.assertEqual(rc, 0)
            results[name] = (json.loads((out / "meta.json").read_text()),
                             json.loads((out / "courses/AAA101.json").read_text()))
        meta, doc = results["with"]
        self.assertNotIn("file", meta["seats"])
        g1 = next(s for s in doc["sectionsNow"] if s["section"] == "G1")
        self.assertEqual(g1["live"]["available"], 6)
        self.assertNotIn("enrolled", g1["live"])
        self.assertNotIn(str(avail.parent), json.dumps(meta))
        meta, doc = results["without"]
        self.assertNotIn("seats", meta)
        self.assertTrue(all("live" not in s for s in doc["sectionsNow"]))


class HighlightSeats(unittest.TestCase):
    def test_highlights_use_live_seats_and_flag_approx(self):
        def sec(num, section, left, total, live=None):
            d = {"section": section, "classNumber": num, "instructor": "X", "seatsLeft": left, "seatsTotal": total,
                 "minBidCents": 1000, "forecast": {WINDOW: _fc(2.0, 1000.0)}}
            if live:
                d["live"] = {"available": live[0], "total": live[1], "source": live[2], "capturedAt": "t", "window": WINDOW}
            return d
        docs = {"AAA101": {"title": "T", "sectionsNow": [
            sec("1", "G1", 1, 40, (2, 40, "live")),   # live differs from the last window
            sec("2", "G2", 9, 40, (3, 30, "approx")),
            sec("3", "G3", 5, 40),                                          # no live row: last window's seats
            sec("4", "G4", 7, 40, (0, 40, "live")),                         # live says full: skipped
        ]}}
        params = {"windows": [WINDOW]}
        win = {"term": "2026-27 Term 2", "round": "1B", "window": 1}
        out = bsd.build_highlights(docs, params, win, runs=500)
        rows = {r["section"]: r for r in out["byWindow"][WINDOW]["easy"]}
        self.assertEqual(set(rows), {"G1", "G2", "G3"})
        self.assertEqual((rows["G1"]["seatsLeft"], rows["G1"]["seatsTotal"]), (2, 40))
        self.assertNotIn("approx", rows["G1"])
        self.assertEqual((rows["G2"]["seatsLeft"], rows["G2"]["seatsTotal"], rows["G2"]["approx"]), (3, 30, True))
        self.assertEqual((rows["G3"]["seatsLeft"], rows["G3"]["seatsTotal"]), (5, 40))
        # the simulation used the live seats: 2 seats can't be less contested than the same section with 40
        sim = bsd._load_sim()
        p = sim.SimParams(**{k: _fc(2.0, 1000.0)[k] for k in bsd.SIM_PARAM_KEYS})
        want = sim.simulate(2, 1, 1000, p, runs=500, seed=bsd.HIGHLIGHT_SEED)
        self.assertEqual(rows["G1"]["bidCents"], sim.recommend_bid(want, bsd.HIGHLIGHT_TARGET))
        self.assertEqual(rows["G1"]["pFill"], round(want["pFill"], 3))


class SeatDeltas(unittest.TestCase):
    TERM = "2026-27 Term 2"
    WIN = "Round 1B Window 1"
    HEADER = LiveSeats.HEADER

    def _dirs(self, stamps_rows: dict, changes=None, raw_changes=None, scan_dirs=None) -> Path:
        """Availability dirs {stamp: csv body}; scan-changes.json goes in the newest. Returns the newest CSV path.

        scan_dirs {stamp: scan dir stamp} writes current_availability.meta.json with that scan_dir."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        for stamp, body in stamps_rows.items():
            d = Path(tmp.name) / stamp
            d.mkdir()
            (d / "current_availability.csv").write_text(self.HEADER + body, encoding="utf-8")
            if scan_dirs and stamp in scan_dirs:
                (d / "current_availability.meta.json").write_text(json.dumps({"scan_dir": f"data/raw/availability_live/{scan_dirs[stamp]}"}))
        newest = Path(tmp.name) / sorted(stamps_rows)[-1]
        if changes is not None:
            (newest / "scan-changes.json").write_text(json.dumps(changes))
        if raw_changes is not None:
            (newest / "scan-changes.json").write_text(raw_changes)
        return newest / "current_availability.csv"

    def _row(self, at, src, code, section, avail, window=None):
        return f"{self.TERM},{window or self.WIN},{at},{src},{code},{section},1,48,40,2,{avail},Open,x\n"

    def _changes(self, **kw):
        sec = lambda code, section, prev, base, term=None: {
            "term": term or self.TERM, "class_number": "1", "course_code": code, "section": section,
            "now": {"total": 48, "enrolled": 40, "reserved": 2, "available": 6},
            "vs_previous": prev, "vs_baseline": base}
        d = lambda a: {"total": 0, "enrolled": -5, "reserved": 3, "available": a}
        return {"window": self.WIN, "previous_scan": "20261107T013050", "baseline_scan": "20261106T172920",
                "seat_deltas": {"summary": {}, "sections": [
                    sec("AAA101", "G1", d(-1), d(4)), sec("AAA101", "G2", None, None),
                    sec("AAA102", "G1", d(2), d(2)), sec("AAA101", "G3", d(1), d(1), term="2025-26 Term 2")],
                    "new_vs_previous": [], "missing_vs_previous": []}, **kw}

    def test_join_keeps_only_available_and_current_term_with_stamp_times(self):
        p = self._dirs({"20261107T092010": ""}, self._changes())
        deltas, times = bsd.load_seat_deltas(p, self.TERM)
        self.assertEqual(deltas, {("AAA101", "G1"): {"sinceOpen": 4, "sinceLast": -1},
                                  ("AAA101", "G2"): {"sinceOpen": None, "sinceLast": None},
                                  ("AAA102", "G1"): {"sinceOpen": 2, "sinceLast": 2}})
        self.assertEqual(times, {"openScanAt": "2026-11-06T17:29:20+08:00", "prevScanAt": "2026-11-07T01:30:50+08:00"})
        self.assertTrue(all(set(v) == {"sinceOpen", "sinceLast"} for v in deltas.values()))

    def test_missing_broken_or_absent_seat_deltas_give_nothing(self):
        for kw in ({}, {"raw_changes": "{not json"}, {"changes": {"window": "w", "seat_deltas_error": "boom"}},
                    {"changes": {"seat_deltas": {"sections": "x"}}}):
            p = self._dirs({"20261107T092010": ""}, **kw)
            self.assertEqual(bsd.load_seat_deltas(p, self.TERM), ({}, None))
        self.assertEqual(bsd.load_seat_deltas(None, self.TERM), ({}, None))

    def test_bad_values_become_null(self):
        ch = self._changes()
        ch["seat_deltas"]["sections"][0]["vs_baseline"] = {"available": "3"}
        ch["seat_deltas"]["sections"][0]["vs_previous"] = {"available": True}
        deltas, _ = bsd.load_seat_deltas(self._dirs({"20261107T092010": ""}, ch), self.TERM)
        self.assertEqual(deltas[("AAA101", "G1")], {"sinceOpen": None, "sinceLast": None})

    def test_attach_is_live_only(self):
        mk = lambda sec, src: {"section": sec, "live": {"available": 1, "total": 2, "source": src, "capturedAt": "t", "window": "w"}}
        docs = {"AAA101": {"sectionsNow": [mk("G1", "live"), mk("G2", "approx"), {"section": "G3"}]}}
        d = {"sinceOpen": 3, "sinceLast": 0}
        n = bsd.attach_seat_deltas(docs, {("AAA101", "G1"): d, ("AAA101", "G2"): d, ("AAA101", "G3"): d})
        s = docs["AAA101"]["sectionsNow"]
        self.assertEqual(n, 1)
        self.assertEqual((s[0]["live"]["sinceOpen"], s[0]["live"]["sinceLast"]), (3, 0))
        self.assertNotIn("sinceOpen", s[1]["live"])
        self.assertNotIn("live", s[2])

    def test_history_same_window_live_rows_oldest_first_at_scan_time(self):
        p = self._dirs({
            "20261106T223720": self._row("2026-11-06T22:59:28.1+08:00", "live_scan", "AAA101", "G1", 2)
                               + self._row("2026-11-06T22:59:28.1+08:00", "approx_previous_window", "AAA102", "G1", 0),
            "20261105T000000": self._row("2026-11-05T00:00:00+08:00", "live_scan", "AAA101", "G1", 9, window="Round 1A Window 3"),
            "20261107T092010": self._row("2026-11-07T09:42:39.5+08:00", "live_scan", "AAA101", "G1", 6),
            "20261108T000000": self._row("2026-11-08T00:00:00+08:00", "live_scan", "AAA101", "G1", 1),  # newer than this file
        }, scan_dirs={"20261107T092010": "20261107T092013"})
        p = p.parent.parent / "20261107T092010" / "current_availability.csv"
        h = bsd.load_seat_history(p, self.TERM, self.WIN)
        # 1st dir has no meta: its own stamp; 2nd: the scan dir stamp from the meta. Never the CSV captured_at (merge time).
        self.assertEqual(h, {("AAA101", "G1"): [{"at": "2026-11-06T22:37:20+08:00", "available": 2},
                                                {"at": "2026-11-07T09:20:13+08:00", "available": 6}]})
        self.assertEqual(bsd.load_seat_history(p, self.TERM, ""), {})

    def test_history_dedups_by_scan_time(self):
        p = self._dirs({"20261107T000000": self._row("2026-11-07T00:10:00+08:00", "live_scan", "AAA101", "G1", 3),
                        "20261107T000100": self._row("2026-11-07T00:11:00+08:00", "live_scan", "AAA101", "G1", 5),
                        "20261107T092010": self._row("2026-11-07T09:42:39+08:00", "live_scan", "AAA101", "G1", 6)},
                       scan_dirs={"20261107T000000": "20261107T000050", "20261107T000100": "20261107T000050"})
        h = bsd.load_seat_history(p, self.TERM, self.WIN)[("AAA101", "G1")]
        self.assertEqual([x["available"] for x in h], [5, 6])  # same scan time: the later dir wins

    def test_history_is_capped(self):
        rows = {f"202611{1 + i // 24:02d}T{i % 24:02d}0000": self._row("2026-11-01T00:00:00+08:00", "live_scan", "AAA101", "G1", i)
                for i in range(50)}
        p = self._dirs(rows)
        h = bsd.load_seat_history(p, self.TERM, self.WIN)[("AAA101", "G1")]
        self.assertEqual(len(h), bsd.HISTORY_MAX_POINTS)
        self.assertEqual(h[-1]["available"], 49)
        self.assertEqual([x["at"] for x in h], sorted(x["at"] for x in h))

    def test_attach_needs_two_points(self):
        h = [{"at": "2026-11-07T01:00:00+08:00", "available": 5}, {"at": "2026-11-07T02:00:00+08:00", "available": 5}]
        docs = {"AAA101": {"sectionsNow": [{"section": "G1", "live": {"source": "live", "available": 5}}]}}
        bsd.attach_seat_deltas(docs, {}, {("AAA101", "G1"): h[:1]})
        self.assertNotIn("history", docs["AAA101"]["sectionsNow"][0]["live"])
        bsd.attach_seat_deltas(docs, {}, {("AAA101", "G1"): h})
        self.assertEqual(len(docs["AAA101"]["sectionsNow"][0]["live"]["history"]), 2)

    def test_history_is_seeded_with_the_open_point_and_matches_since_open(self):
        OPEN = "2026-11-06T17:29:20+08:00"
        pt = lambda at, a: {"at": at, "available": a}
        docs = {"AAA101": {"sectionsNow": [
            {"section": "G1", "live": {"source": "live", "available": 4}},   # same count at 2 scans, +1 since open
            {"section": "G2", "live": {"source": "live", "available": 6}},   # history of 1 point + baseline
            {"section": "G3", "live": {"source": "live", "available": 3}},   # sinceOpen unknown: no seed
            {"section": "G4", "live": {"source": "live", "available": 3}},   # no change: baseline equals now
            {"section": "G5", "live": {"source": "live", "available": 9}}]}}  # last point disagrees with live: dropped
        hist = {("AAA101", "G1"): [pt("2026-11-06T22:37:20+08:00", 4), pt("2026-11-07T09:20:13+08:00", 4)],
                ("AAA101", "G2"): [pt("2026-11-07T09:20:13+08:00", 6)],
                ("AAA101", "G3"): [pt("2026-11-07T01:00:00+08:00", 3), pt("2026-11-07T09:20:13+08:00", 3)],
                ("AAA101", "G4"): [pt(OPEN, 3), pt("2026-11-07T09:20:13+08:00", 3)],
                ("AAA101", "G5"): [pt("2026-11-07T01:00:00+08:00", 5), pt("2026-11-07T09:20:13+08:00", 5)]}
        deltas = {("AAA101", s): {"sinceOpen": v, "sinceLast": 0} for s, v in (("G1", 1), ("G2", 2), ("G3", None), ("G4", 0), ("G5", 4))}
        bsd.attach_seat_deltas(docs, deltas, hist, OPEN)
        live = {s["section"]: s["live"] for s in docs["AAA101"]["sectionsNow"]}
        self.assertEqual(live["G1"]["history"][0], pt(OPEN, 3))
        self.assertEqual([x["available"] for x in live["G1"]["history"]], [3, 4, 4])
        self.assertEqual([x["available"] for x in live["G2"]["history"]], [4, 6])
        self.assertEqual([x["available"] for x in live["G3"]["history"]], [3, 3])
        self.assertEqual([x["at"] for x in live["G4"]["history"]], [OPEN, "2026-11-07T09:20:13+08:00"])  # no duplicate at the open time
        self.assertNotIn("history", live["G5"])
        for k in ("G1", "G2", "G4"):
            h = live[k]["history"]
            self.assertEqual(h[0]["available"] + live[k]["sinceOpen"], h[-1]["available"])
            self.assertEqual(h[0]["at"], OPEN)

    def test_seeded_history_keeps_cap_and_open_point(self):
        OPEN = "2026-11-01T00:00:00+08:00"
        h = [{"at": f"2026-11-02T{i // 60:02d}:{i % 60:02d}:00+08:00", "available": 10} for i in range(bsd.HISTORY_MAX_POINTS)]
        docs = {"AAA101": {"sectionsNow": [{"section": "G1", "live": {"source": "live", "available": 10}}]}}
        bsd.attach_seat_deltas(docs, {("AAA101", "G1"): {"sinceOpen": 3, "sinceLast": 0}}, {("AAA101", "G1"): h}, OPEN)
        out = docs["AAA101"]["sectionsNow"][0]["live"]["history"]
        self.assertEqual(len(out), bsd.HISTORY_MAX_POINTS)
        self.assertEqual(out[0], {"at": OPEN, "available": 7})
        self.assertEqual(out[-1], h[-1])

    def test_window_guard_skips_deltas_when_scan_changes_are_for_another_window(self):
        p = self._dirs({"20261107T092010": ""}, self._changes())
        self.assertEqual(bsd.load_seat_deltas(p, self.TERM, "Round 1B Window 2"), ({}, None))
        deltas, times = bsd.load_seat_deltas(p, self.TERM, self.WIN)
        self.assertTrue(deltas and times)

    def test_main_end_to_end_and_survives_missing_file(self):
        p = self._dirs({"20261107T092010": self._row("2026-11-07T09:42:39+08:00", "live_scan", "AAA101", "G1", 6)}, self._changes())
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Path(tmp.name) / "w.json"
        cfg.write_text(json.dumps({"currentTerm": self.TERM, "current": {"round": "1B", "window": 1, "status": "open"},
                                   "schedule": [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]}))
        res = {}
        for name in ("with", "without"):
            if name == "without":
                (p.parent / "scan-changes.json").unlink()
            out = Path(tmp.name) / name
            rc = bsd.main(["--csv", str(FIXTURE), "--out", str(out), "--window-config", str(cfg),
                           "--availability", str(p), "--generated-at", "2026-11-05T12:00:00+08:00"])
            self.assertEqual(rc, 0)
            res[name] = (json.loads((out / "meta.json").read_text()), json.loads((out / "courses/AAA101.json").read_text()))
        meta, doc = res["with"]
        g1 = next(s for s in doc["sectionsNow"] if s["section"] == "G1")["live"]
        self.assertEqual((g1["sinceOpen"], g1["sinceLast"]), (4, -1))
        # every scan time is written to the nearest hour; the deltas and history values are the exact-time ones
        self.assertEqual(meta["seats"]["openScanAt"], "2026-11-06T17:00:00+08:00")
        self.assertEqual(meta["seats"]["prevScanAt"], "2026-11-07T02:00:00+08:00")
        self.assertEqual(meta["seats"]["scanAt"], "2026-11-07T09:00:00+08:00")
        self.assertEqual(meta["seats"]["capturedAt"], "2026-11-07T10:00:00+08:00")
        self.assertEqual(g1["capturedAt"], "2026-11-07T10:00:00+08:00")
        self.assertNotIn("lastScanAt", meta["seats"])
        # one dir (09:20) + the seeded open point (6 - 4 = 2 at 17:29 on the 6th)
        self.assertEqual([(h["at"], h["available"]) for h in g1["history"]],
                         [("2026-11-06T17:00:00+08:00", 2), ("2026-11-07T09:00:00+08:00", 6)])
        self.assertEqual(g1["history"][0]["available"] + g1["sinceOpen"], g1["history"][-1]["available"])
        for blob in map(json.dumps, res["with"]):
            self.assertNotIn("reserved", blob)
        meta, doc = res["without"]
        g1 = next(s for s in doc["sectionsNow"] if s["section"] == "G1")["live"]
        self.assertNotIn("sinceOpen", g1)
        self.assertNotIn("openScanAt", meta["seats"])

    def test_rounding_keeps_every_history_point_even_when_two_share_an_hour(self):
        docs = {"AAA101": {"sectionsNow": [{"section": "G1", "live": {"source": "live", "available": 5, "capturedAt": "2026-11-07T09:42:39+08:00",
                "history": [{"at": "2026-11-07T08:40:00+08:00", "available": 2}, {"at": "2026-11-07T09:10:00+08:00", "available": 3},
                            {"at": "2026-11-07T09:20:13+08:00", "available": 5}]}}, {"section": "G2"}]}}
        bsd.round_scan_times(docs)
        live = docs["AAA101"]["sectionsNow"][0]["live"]
        self.assertEqual([(h["at"], h["available"]) for h in live["history"]],
                         [("2026-11-07T09:00:00+08:00", 2), ("2026-11-07T09:00:00+08:00", 3), ("2026-11-07T09:00:00+08:00", 5)])
        self.assertEqual(live["capturedAt"], "2026-11-07T10:00:00+08:00")

    def test_main_skips_deltas_and_history_when_scan_changes_window_differs(self):
        p = self._dirs({"20261107T092010": self._row("2026-11-07T09:42:39+08:00", "live_scan", "AAA101", "G1", 6)},
                       self._changes(window="Round 1B Window 2"))
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        cfg = Path(tmp.name) / "w.json"
        cfg.write_text(json.dumps({"currentTerm": self.TERM, "current": {"round": "1B", "window": 1, "status": "open"},
                                   "schedule": [{"round": "1B", "window": 1, "opensAt": "c", "closesAt": "d"}]}))
        out = Path(tmp.name) / "o"
        rc = bsd.main(["--csv", str(FIXTURE), "--out", str(out), "--window-config", str(cfg),
                       "--availability", str(p), "--generated-at", "2026-11-05T12:00:00+08:00"])
        self.assertEqual(rc, 0)
        g1 = next(s for s in json.loads((out / "courses/AAA101.json").read_text())["sectionsNow"] if s["section"] == "G1")["live"]
        self.assertEqual(g1["available"], 6)
        for k in ("sinceOpen", "sinceLast", "history"):
            self.assertNotIn(k, g1)
        self.assertNotIn("openScanAt", json.loads((out / "meta.json").read_text())["seats"])


class WindowBidFields(unittest.TestCase):
    """window_bid_fields: distcal.json's per-window-group keys, spread over the windows of each group (synthetic payloads)."""
    GROUPS = ("R1W1", "R1A", "R1B", "R2", "R2A")

    @staticmethod
    def _levels(base):
        return {"cheap": {"level": base, "lossFilled": 0.29, "nFilled": 120, "own": True, "reached": True},
                "balanced": {"level": base + 0.05, "lossFilled": 0.14, "nFilled": 120, "own": True, "reached": True},
                "safe": {"level": base + 0.08, "lossFilled": 0.09, "nFilled": 120, "own": False, "reached": True}}

    def _payload(self):
        cell = lambda w: {"cheap": w, "balanced": w + 0.15, "safe": w + 0.2, "nFilled": 80, "source": "cell"}
        return {
            "levels": {"cheap": {"level": 0.9}},
            "levelsByGroup": {g: self._levels(0.5 + 0.01 * i) for i, g in enumerate(self.GROUPS)},
            "measuredWin": {**{g: {str(b): cell(0.6 + 0.01 * b) for b in range(5)} for g in self.GROUPS}, "overall": {"cheap": 0.7}},
            "bandEdges": [15, 25, 40, 60],
        }

    def test_every_window_gets_its_groups_values(self):
        out = bsd.window_bid_fields(self._payload())
        self.assertEqual(len(out["bidLevelsByWindow"]), 12)
        lv = out["bidLevelsByWindow"]
        self.assertEqual(lv["Round 1 Window 1"]["cheap"], {"level": 0.5, "lossFilled": 0.29, "reached": True})
        # R1A is windows 1-3, R1B 4-5, R2 6-8, R2A 9-11
        for w in ("Round 1A Window 1", "Round 1A Window 2", "Round 1A Window 3"):
            self.assertAlmostEqual(lv[w]["balanced"]["level"], 0.56)
        self.assertAlmostEqual(lv["Round 1B Window 2"]["safe"]["level"], 0.6)
        self.assertAlmostEqual(lv["Round 2 Window 3"]["cheap"]["level"], 0.53)
        self.assertAlmostEqual(lv["Round 2A Window 1"]["cheap"]["level"], 0.54)
        # only level, lossFilled and reached go to the site
        self.assertEqual(set(lv["Round 2 Window 1"]["safe"]), {"level", "lossFilled", "reached"})

    def test_measured_win_passes_source_and_drops_overall(self):
        out = bsd.window_bid_fields(self._payload())
        m = out["measuredWin"]
        self.assertEqual(len(m), 12)
        cell = m["Round 2A Window 3"]["3"]
        self.assertEqual(set(cell), {"cheap", "balanced", "safe", "nFilled", "source"})  # no upper in this payload: key omitted
        self.assertEqual(cell["source"], "cell")
        self.assertAlmostEqual(cell["balanced"], 0.78)
        self.assertEqual(cell["nFilled"], 80)
        self.assertEqual(sorted(m["Round 1 Window 1"]), ["0", "1", "2", "3", "4"])
        self.assertEqual(out["bandEdges"], [15, 25, 40, 60])

    def test_measured_win_passes_upper_and_source_when_present(self):
        p = self._payload()
        for g in self.GROUPS:
            for b, c in p["measuredWin"][g].items():
                c["upper"] = {st: round(c[st] + 0.05, 4) for st in ("cheap", "balanced", "safe")}
        p["measuredWin"]["R1A"]["2"]["source"] = "group"
        m = bsd.window_bid_fields(p)["measuredWin"]
        cell = m["Round 1A Window 2"]["2"]
        self.assertEqual(set(cell), {"cheap", "balanced", "safe", "nFilled", "source", "upper"})
        self.assertEqual(cell["source"], "group")
        self.assertEqual(cell["upper"], {"cheap": 0.67, "balanced": 0.82, "safe": 0.87})
        self.assertEqual(m["Round 1 Window 1"]["0"]["source"], "cell")

    def test_guard_fields_pass_with_upper_and_only_when_valid(self):
        p = self._payload()
        for g in self.GROUPS:
            for c in p["measuredWin"][g].values():
                c["upper"] = {st: round(c[st] + 0.05, 4) for st in ("cheap", "balanced", "safe")}
                c["nCourses"], c["effCourses"] = 40, 25.3
        cell = bsd.window_bid_fields(p)["measuredWin"]["Round 1A Window 2"]["2"]
        self.assertEqual((cell["nCourses"], cell["effCourses"]), (40, 25.3))
        p["measuredWin"]["R1A"]["2"]["nCourses"] = 40.0  # a float count is left out
        p["measuredWin"]["R1A"]["2"]["effCourses"] = True  # a bool is left out
        cell = bsd.window_bid_fields(p)["measuredWin"]["Round 1A Window 2"]["2"]
        self.assertEqual(set(cell), {"cheap", "balanced", "safe", "nFilled", "source", "upper"})  # both guard fields invalid: left out

    def test_eff_courses_passes_through_unrounded(self):
        # H10: 21025 / 1053 = 19.96676... must reach the site as is, not as 20.0
        p = self._payload()
        for g in self.GROUPS:
            for c in p["measuredWin"][g].values():
                c["upper"] = {st: round(c[st] + 0.05, 4) for st in ("cheap", "balanced", "safe")}
                c["nCourses"], c["effCourses"] = 30, 21025 / 1053
        cell = bsd.window_bid_fields(p)["measuredWin"]["Round 1A Window 2"]["2"]
        self.assertEqual(cell["effCourses"], 21025 / 1053)
        self.assertLess(cell["effCourses"], 20)

    def test_guard_fields_are_left_out_without_upper(self):
        p = self._payload()
        for g in self.GROUPS:
            for c in p["measuredWin"][g].values():
                c["nCourses"], c["effCourses"] = 40, 25.3
        cell = bsd.window_bid_fields(p)["measuredWin"]["Round 1A Window 2"]["2"]
        self.assertEqual(set(cell), {"cheap", "balanced", "safe", "nFilled", "source"})

    def test_bad_source_or_upper_is_left_out_but_the_cell_stays(self):
        p = self._payload()
        c = p["measuredWin"]["R1W1"]["1"]
        c["source"] = "elsewhere"
        c["upper"] = {"cheap": 0.7, "balanced": None, "safe": 0.9}
        cell = bsd.window_bid_fields(p)["measuredWin"]["Round 1 Window 1"]["1"]
        self.assertEqual(set(cell), {"cheap", "balanced", "safe", "nFilled"})

    def test_source_and_upper_change_nothing_else_in_the_output(self):
        """Bids come from bidLevels / bidLevelsByWindow / the params, none of which window_bid_fields' source and upper handling
        touches: with and without those keys every other output key is identical, and measuredWin differs by the added keys only."""
        old = self._payload()
        new = self._payload()
        for g in self.GROUPS:
            for c in new["measuredWin"][g].values():
                c["upper"] = {st: c[st] + 0.01 for st in ("cheap", "balanced", "safe")}
        for g in self.GROUPS:
            for c in old["measuredWin"][g].values():
                del c["source"]
        a, b = bsd.window_bid_fields(old), bsd.window_bid_fields(new)
        self.assertEqual({k: v for k, v in a.items() if k != "measuredWin"}, {k: v for k, v in b.items() if k != "measuredWin"})
        for w, bands in b["measuredWin"].items():
            for k, c in bands.items():
                self.assertEqual({kk: v for kk, v in c.items() if kk not in ("source", "upper")}, a["measuredWin"][w][k])

    def test_absent_keys_are_not_emitted(self):
        self.assertEqual(bsd.window_bid_fields({"levels": {}}), {})
        p = self._payload()
        del p["measuredWin"], p["bandEdges"]
        self.assertEqual(set(bsd.window_bid_fields(p)), {"bidLevelsByWindow"})

    def test_malformed_pieces_are_dropped_not_half_emitted(self):
        p = self._payload()
        del p["levelsByGroup"]["R2"]["safe"]          # a window group missing a style: those windows get no entry
        p["measuredWin"]["R1A"].pop("2")               # a band missing: that group's windows get no table
        p["bandEdges"] = [15, 25, 40]
        out = bsd.window_bid_fields(p)
        self.assertNotIn("Round 2 Window 1", out["bidLevelsByWindow"])
        self.assertIn("Round 2A Window 1", out["bidLevelsByWindow"])
        self.assertNotIn("Round 1A Window 2", out["measuredWin"])
        self.assertIn("Round 1B Window 1", out["measuredWin"])
        self.assertNotIn("bandEdges", out)

    def test_null_loss_and_rate_are_kept(self):
        p = self._payload()
        p["levelsByGroup"]["R1W1"]["cheap"]["lossFilled"] = None
        p["measuredWin"]["R1W1"]["0"]["safe"] = None
        out = bsd.window_bid_fields(p)
        self.assertIsNone(out["bidLevelsByWindow"]["Round 1 Window 1"]["cheap"]["lossFilled"])
        p["levelsByGroup"]["R2A"]["safe"]["reached"] = False
        self.assertIs(bsd.window_bid_fields(p)["bidLevelsByWindow"]["Round 2A Window 2"]["safe"]["reached"], False)
        del p["levelsByGroup"]["R2A"]["safe"]["reached"]
        self.assertNotIn("reached", bsd.window_bid_fields(p)["bidLevelsByWindow"]["Round 2A Window 2"]["safe"])
        self.assertIsNone(out["measuredWin"]["Round 1 Window 1"]["0"]["safe"])

    def test_json_serialisable(self):
        json.dumps(bsd.window_bid_fields(self._payload()))


class LoadRefitNoteTests(unittest.TestCase):
    def note(self, meta):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "fit-meta.json"
            path.write_text(json.dumps(meta))
            return bsd.load_refit_note(path)

    def test_fit_stamp_is_the_fit_meta_stamp(self):
        note = self.note({"refitAt": "2027-01-10T20:28:19+08:00", "stamp": "20270110T201900", "afterWindow": None, "newBids": 3})
        self.assertEqual(note["fitStamp"], "20270110T201900")
        self.assertEqual(note["refitAt"], "2027-01-10T20:00:00+08:00")

    def test_fit_stamp_is_left_out_without_a_stamp(self):
        note = self.note({"refitAt": "2027-01-10T20:28:19+08:00"})
        self.assertIn("refitAt", note)
        self.assertNotIn("fitStamp", note)


class MeasuredSummary(unittest.TestCase):
    """measured_summary: one rate per round for /method, from the per-band cells of distcal.json's measuredWin."""

    @staticmethod
    def _cell(rate, n, source):
        return {"cheap": rate, "balanced": rate + 0.1, "safe": rate + 0.15, "nFilled": n, "source": source}

    def _measured(self):
        c = self._cell
        return {
            # R1W1: two bands fall back to the group's own rate (n = the whole group), which is used as is
            "R1W1": {"0": c(0.72, 600, "group"), "1": c(0.6, 200, "cell"), "2": c(0.8, 250, "cell"),
                     "3": c(0.72, 600, "group"), "4": c(0.72, 600, "group")},
            # R1A: every band is its own cell, so the round's rate is their nFilled-weighted mean
            "R1A": {"0": c(0.5, 100, "cell"), "1": c(0.7, 300, "cell"), "2": c(0.8, 100, "cell"),
                    "3": c(0.6, 100, "cell"), "4": c(0.6, 400, "cell")},
            # R2A: too thin for a group rate; measured only over all rows, so left out
            "R2A": {str(b): c(0.69, 3000, "all") for b in range(5)},
            "overall": {"cheap": 0.695, "balanced": 0.838, "safe": 0.884},
        }

    def test_rounds_overall_and_terms(self):
        out = bsd.measured_summary(self._measured(), {"test": "2025-26 Term 2", "heldOut": "2026-27 Term 1"})
        self.assertEqual(out["overall"], {"cheap": 0.695, "balanced": 0.838, "safe": 0.884})
        self.assertEqual(out["terms"], ["2025-26 Term 2", "2026-27 Term 1"])
        self.assertEqual([r["group"] for r in out["byRound"]], ["R1W1", "R1A"])
        r1, r1a = out["byRound"]
        self.assertEqual((r1["label"], r1["cheap"], r1["nFilled"]), ("Round 1", 0.72, 600))
        # (0.5*100 + 0.7*300 + 0.8*100 + 0.6*100 + 0.6*400) / 1000 = 0.64
        self.assertEqual((r1a["label"], r1a["nFilled"]), ("Round 1A", 1000))
        self.assertAlmostEqual(r1a["cheap"], 0.64)
        self.assertAlmostEqual(r1a["safe"], 0.79)

    def test_round_with_a_bad_band_is_left_out(self):
        m = self._measured()
        m["R1A"]["2"]["safe"] = None        # one malformed band: no partial weighted mean
        m["R1W1"]["1"]["nFilled"] = True    # a bool is not a count
        self.assertEqual(bsd.measured_summary(m, None)["byRound"], [])

    def test_missing_overall_or_terms(self):
        m = self._measured()
        self.assertNotIn("terms", bsd.measured_summary(m, None))
        m["overall"]["safe"] = None
        self.assertIsNone(bsd.measured_summary(m, None))

    def test_emitted_by_window_bid_fields(self):
        p = {"measuredWin": self._measured(), "terms": {"test": "a", "heldOut": "b"}}
        self.assertEqual(bsd.window_bid_fields(p)["measuredWinSummary"]["terms"], ["a", "b"])
