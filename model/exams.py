"""Final-exam dates from BOSS ClassDetails captures (schedule-html/term-*/native-class-details-*.html.json).

Each capture's meeting table has CLASS rows and, for most sections, one EXAM row (start_date, start_time, end_time).
Class numbers only join within the same term, so captures are read from the current term's folders only.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path


def _iso_date(value) -> str | None:
    try:
        return datetime.strptime(str(value).strip(), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def _hhmm(value) -> str | None:
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", str(value or "").strip())
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else None


def exam_from_rows(rows) -> dict | None:
    """{date, start, end} from the first EXAM row with a readable date and start time, else None."""
    for r in rows or []:
        v = (r or {}).get("values") or {}
        if str(v.get("meeting_type", "")).strip().upper() != "EXAM":
            continue
        date, start = _iso_date(v.get("start_date")), _hhmm(v.get("start_time"))
        if date and start:
            return {"date": date, "start": start, "end": _hhmm(v.get("end_time"))}
    return None


def term_slug(term: str) -> str:
    """'2026-27 Term 2' -> 'term-2026-27-term-2' (the capture folder prefix)."""
    return "term-" + re.sub(r"\s+", "-", term.strip().lower())


def load_exams(schedule_dir: Path, term: str) -> tuple[dict[str, dict | None], int]:
    """({class_number: exam or None}, captures read) for `term`, using the newest capture of each class.

    Never raises: a missing folder or an unreadable file is skipped with a warning on stderr.
    """
    schedule_dir = Path(schedule_dir)
    if not schedule_dir.is_dir():
        print(f"WARNING: no exam dates, {schedule_dir} not found", file=sys.stderr)
        return {}, 0
    newest: dict[str, tuple[str, dict | None]] = {}
    read = bad = 0
    for folder in sorted(schedule_dir.glob(f"{term_slug(term)}-*")):
        for f in folder.glob("native-class-details-*.html.json"):
            try:
                meta = json.loads(f.read_text(encoding="utf-8"))["metadata"]
                if meta.get("term") != term:
                    continue
                cls = str(meta["class_number"]).strip()
                rows = meta["source_evidence"]["meeting_table"]["rows"]
                key = (str(meta.get("captured_at") or ""), folder.name)
                read += 1
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                bad += 1
                continue
            if cls not in newest or key > newest[cls][0]:
                newest[cls] = (key, exam_from_rows(rows))
    if bad:
        print(f"WARNING: {bad} class-details captures unreadable, skipped (exam dates)", file=sys.stderr)
    return {cls: exam for cls, (_, exam) in newest.items()}, read
