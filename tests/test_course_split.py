import importlib.util
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("course_split", ROOT / "model/course_split.py")
cs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cs)

STAT = "COR-STAT1202"


class CourseKeyTests(unittest.TestCase):
    def test_ching_regular_section_goes_to_x(self):
        self.assertEqual(cs.course_key(STAT, "ROSIE CHING", "Introductory Statistics (SMU-X)"), "COR-STAT1202-X")

    def test_ching_sg_section_with_plain_title_goes_to_x(self):
        self.assertEqual(cs.course_key(STAT, "ROSIE CHING", "Introductory Statistics"), "COR-STAT1202-X")

    def test_other_instructor_with_smu_x_title_goes_to_x(self):
        self.assertEqual(cs.course_key(STAT, "SOMEONE ELSE", "Introductory Statistics (SMU-X)"), "COR-STAT1202-X")

    def test_other_stat1202_sections_stay_on_the_base_code(self):
        self.assertEqual(cs.course_key(STAT, "WU ZHENGXIAO", "Introductory Statistics"), STAT)
        self.assertEqual(cs.course_key(STAT, "", ""), STAT)

    def test_other_codes_are_never_split(self):
        self.assertEqual(cs.course_key("MGMT102", "ROSIE CHING", "Management (SMU-X)"), "MGMT102")
        self.assertEqual(cs.course_key("COR-STAT1201", "ROSIE CHING", "x (SMU-X)"), "COR-STAT1201")

    def test_instructor_lists_match_whole_names_case_insensitively(self):
        self.assertEqual(cs.course_key(STAT, "WU ZHENGXIAO, ROSIE CHING", "Introductory Statistics"), "COR-STAT1202-X")
        self.assertEqual(cs.course_key(STAT, "rosie ching / Daniel Soh", ""), "COR-STAT1202-X")
        self.assertEqual(cs.course_key(STAT, "DANIEL SOH;  Rosie  Ching", ""), "COR-STAT1202-X")
        self.assertEqual(cs.course_key(STAT, "ROSIE CHINGSON", ""), STAT)  # a longer name is not hers

    def test_row_helper_tolerates_missing_columns(self):
        self.assertEqual(cs.row_course_key({"course_code": STAT}), STAT)
        self.assertEqual(cs.row_course_key({"course_code": STAT, "instructor": "ROSIE CHING"}), "COR-STAT1202-X")
        self.assertEqual(cs.row_course_key({"course_code": STAT, "instructor": None, "description": None}), STAT)


class BossCodeTests(unittest.TestCase):
    def test_round_trip(self):
        self.assertEqual(cs.boss_code("COR-STAT1202-X"), STAT)
        self.assertEqual(cs.boss_code(STAT), STAT)
        self.assertEqual(cs.boss_code("MGMT102"), "MGMT102")
        self.assertEqual(cs.boss_code(cs.course_key(STAT, "ROSIE CHING", "")), STAT)

    def test_titles(self):
        self.assertEqual(cs.title_override("COR-STAT1202-X"), "Introductory Statistics (SMU-X)")
        self.assertEqual(cs.title_override(STAT), "Introductory Statistics")
        self.assertIsNone(cs.title_override("MGMT102"))


class ModelSwitch(unittest.TestCase):
    """MODEL_SPLIT is off: the model keeps BOSS's code (as before the split). Patched on: it uses the split key."""

    @staticmethod
    def _row(code, instr, desc, cn, min_bid="11.10", term="2025-26 Term 1"):
        return {"term": term, "window": "Round 1 Window 1", "course_code": code, "description": desc, "section": "G" + cn,
                "class_number": cn, "instructor": instr, "median_bid": "12.00", "min_bid": min_bid, "no_bids": "0",
                "before_process_vacancy": "40", "after_process_vacancy": "0", "start_times": "08:15", "days": "MON"}

    def _on(self):
        """MODEL_SPLIT patched on in the course_split module fit really imported (a package or a top-level copy)."""
        from model.forecast import fit
        return mock.patch.dict(fit.model_course_key.__globals__, {"MODEL_SPLIT": True})

    def _stat_rows(self):
        rows = [self._row(STAT, "ROSIE CHING", "Introductory Statistics (SMU-X)", str(i), min_bid="11.10") for i in range(1, 4)]
        return rows + [self._row(STAT, "WU ZHENGXIAO", "Introductory Statistics", "9", min_bid="25.00")]

    def test_switch_is_off_by_default(self):
        self.assertFalse(cs.MODEL_SPLIT)
        from model.forecast import fit
        self.assertFalse(fit.model_course_key.__globals__["MODEL_SPLIT"])

    def test_model_course_key_follows_the_switch(self):
        ching = {"course_code": STAT, "instructor": "ROSIE CHING", "description": ""}
        self.assertEqual(cs.model_course_key(ching), STAT)
        self.assertEqual(cs.model_key("COR-STAT1202-X"), STAT)
        with mock.patch.object(cs, "MODEL_SPLIT", True):
            self.assertEqual(cs.model_course_key(ching), "COR-STAT1202-X")
            self.assertEqual(cs.model_key("COR-STAT1202-X"), "COR-STAT1202-X")

    def test_off_obs_and_floors_use_the_boss_code(self):
        from model.forecast import fit
        rows = self._stat_rows()
        obs = fit.build_obs(rows)
        self.assertEqual([(o.course, o.subject) for o in obs], [(STAT, "COR-STAT")] * 4)
        self.assertEqual(fit.course_floors(rows), {STAT: 1110})  # one pooled course, as at HEAD: the three e$11.10 rows set its floor

    def test_on_obs_floors_and_subject_use_the_split_key(self):
        from model.forecast import fit
        rows = self._stat_rows()
        with self._on():
            obs = fit.build_obs(rows)
            floors = fit.course_floors(rows)
        self.assertEqual([(o.course, o.subject) for o in obs], [("COR-STAT1202-X", "COR-STAT")] * 3 + [(STAT, "COR-STAT")])
        self.assertEqual(floors, {"COR-STAT1202-X": 1110, STAT: 1000})
        self.assertEqual({o.floor for o in obs[:3]}, {1110})

    def _drop_counts(self):
        from model.forecast import drops
        order = ["Round 1 Window 1", "Round 1 Window 2"]

        def r(instr, desc, cn, w, before, after):
            d = self._row(STAT, instr, desc, cn)
            d.update(window=w, before_process_vacancy=str(before), after_process_vacancy=str(after))
            return d
        rows = [r("ROSIE CHING", "Introductory Statistics (SMU-X)", "1", order[0], 40, 0),
                r("ROSIE CHING", "Introductory Statistics (SMU-X)", "1", order[1], 2, 0),
                r("WU ZHENGXIAO", "Introductory Statistics", "2", order[0], 40, 0),
                r("WU ZHENGXIAO", "Introductory Statistics", "2", order[1], 0, 0)]
        return drops.collect_counts(rows, order, order[0], [order[1]], full_at="after")[order[1]]

    def test_off_drop_counts_pool_under_the_boss_code(self):
        c = self._drop_counts()
        self.assertEqual(c[("c", STAT)], [2, 1])
        self.assertNotIn(("c", "COR-STAT1202-X"), c)

    def test_on_drop_counts_keep_the_courses_apart(self):
        from model.forecast import drops
        with mock.patch.dict(drops.model_course_key.__globals__, {"MODEL_SPLIT": True}):
            c = self._drop_counts()
        self.assertEqual(c[("c", "COR-STAT1202-X")], [1, 1])
        self.assertEqual(c[("c", STAT)], [1, 0])
        self.assertEqual(c[("s", "COR-STAT")], [2, 1])


if __name__ == "__main__":
    unittest.main()
