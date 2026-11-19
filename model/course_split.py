"""Splits one BOSS course code into separate site courses.

Owner decision, 20 Nov 2026: the COR-STAT1202 sections taught by ROSIE CHING, or whose BOSS title contains
"(SMU-X", are a different course from the other COR-STAT1202 sections (different cohort, bidding and prices),
so the model and the site treat them as their own course, "COR-STAT1202-X" ("Introductory Statistics (SMU-X)").
Only COR-STAT1202 is split.

The split key is for forecasts, history files and the site. BOSS only knows the real code, so every join to
BOSS data (availability and seat files, scan deltas, results, class numbers) keeps using `boss_code(key)`.

Pure standard library: model/forecast/* and model/build_site_data.py both import it.
"""
from __future__ import annotations

import re

SPLITS = {
    "COR-STAT1202": {
        "suffix": "-X",
        "instructors": {"ROSIE CHING"},
        "title_marker": "(SMU-X",
        "split_title": "Introductory Statistics (SMU-X)",
        "base_title": "Introductory Statistics",
    },
}

# The owner wants Stat-X separate in the model too, but the 20 Nov 2026 backtest showed Stat-X Balanced win on filled sections
# 12/13 pooled vs 10/13 split (regular stats overpay +$2.70), so the model stays pooled until there is more data. Flipping it changes pricing: not before the R6 January test ends.
MODEL_SPLIT = False

_NAME_SEP = re.compile(r"[,/;]")


def _names(instructor: str) -> set[str]:
    """Upper-cased whole names in an instructor string that may list several, separated by commas, slashes or semicolons."""
    return {" ".join(p.split()).upper() for p in _NAME_SEP.split(instructor or "") if p.strip()}


def course_key(code: str, instructor: str = "", description: str = "") -> str:
    """The split key for a section: code + suffix when it belongs to the split-off course, else the code unchanged."""
    cfg = SPLITS.get(code)
    if not cfg:
        return code
    wanted = {n.upper() for n in cfg["instructors"]}
    if _names(instructor) & wanted or cfg["title_marker"].upper() in (description or "").upper():
        return code + cfg["suffix"]
    return code


def row_course_key(row) -> str:
    """course_key for a bids CSV row (a dict with course_code and, when known, instructor and description)."""
    return course_key(row["course_code"], row.get("instructor") or "", row.get("description") or "")


def model_course_key(row) -> str:
    """The course key the forecast model uses: the split key only when MODEL_SPLIT is on (read at call time), else BOSS's code."""
    return row_course_key(row) if MODEL_SPLIT else row["course_code"]


def boss_code(key: str) -> str:
    """BOSS's real code for a course key: "COR-STAT1202-X" gives "COR-STAT1202", anything else is returned unchanged."""
    for code, cfg in SPLITS.items():
        if key == code + cfg["suffix"]:
            return code
    return key


def model_key(key: str) -> str:
    """The model's course key for a site course key: the key itself when MODEL_SPLIT is on, else BOSS's code (read at call time)."""
    return key if MODEL_SPLIT else boss_code(key)


def title_override(key: str) -> str | None:
    """Fixed site title for a split key or for the base code of a split course; None for every other course."""
    for code, cfg in SPLITS.items():
        if key == code + cfg["suffix"]:
            return cfg["split_title"]
        if key == code:
            return cfg["base_title"]
    return None
