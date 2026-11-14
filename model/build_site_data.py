#!/usr/bin/env python3
"""Build the static JSON the site ships from bids_with_schedule.csv.

Writes meta.json, index.json, browse.json (+ browse/<term>.json), courses/<CODE>.json, forecast-meta.json and highlights.json under
site/src/data/real/. With --params (default: the 2026-27 Term 2 fit, if forecasts_ok) each current
section also carries its per-window forecast parameters, and highlights.json is simulated here.
Stdlib only. Run from anywhere:  python3 model/build_site_data.py
To move the "current window" on (e.g. to 1B W1), edit "current" in model/site_window.json.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _default_csv():
    """The live dataset: data/current.json's dataset + /bids_with_schedule.csv; the old fixed path only if it is missing."""
    try:
        with open(ROOT / "data/current.json") as f:
            return ROOT / json.load(f)["dataset"] / "bids_with_schedule.csv"
    except (OSError, ValueError, KeyError, TypeError):
        return ROOT / "data/derived-captures-2026-11-05-full/bids_with_schedule.csv"


def _default_availability():
    """The merged live-seat file named by data/current.json's `availability` (relative to repo/), or None."""
    try:
        with open(ROOT / "data/current.json") as f:
            rel = json.load(f)["availability"]
        return ROOT / rel if isinstance(rel, str) and rel else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


DEFAULT_CSV = _default_csv()
DEFAULT_AVAILABILITY = _default_availability()
DEFAULT_OUT = ROOT / "site/src/data/real"
DEFAULT_CONFIG = ROOT / "model/site_window.json"
DEFAULT_PARAMS = ROOT / "model/forecast/out/params-2026-27-term-2.json"
DEFAULT_BACKTEST = ROOT / "model/forecast/out/backtest.json"
DEFAULT_BACKTEST_CORRECTED = ROOT / "model/forecast/out/backtest-corrected.json"
# Forecast correction (GBM level rescale of priceLevelCents, model/forecast/correction.py). Off switches, any one:
# this constant, the env var BIDWISE_CORRECTION=0, or --no-correction. Any failure falls back to the uncorrected fit.
CORRECTION_ENABLED = True
SIM_PARAM_KEYS = ("demandMean", "demandDispersion", "priceLevelCents", "priceSigma",
                  "anchorSigma", "anchorShare", "anchorCents")
# Same runs, seed and target as the course page (site/src/lib/sim/forecast.ts: FORECAST_RUNS, FORECAST_SEED, 90% target)
# so a section shows the identical bid on the home lists and on its own page.
HIGHLIGHT_RUNS = 20000
HIGHLIGHT_SEED = 12345
HIGHLIGHT_TARGET = 0.9
HIGHLIGHT_LIMIT = 8
# The home page can hide bids above the person's own balance (any amount they type). So besides the top HIGHLIGHT_LIMIT
# overall, each list keeps the top HIGHLIGHT_LIMIT with bidCents at or under each of these amounts (cents); a balance
# between two steps lists the nearest lower step's rows, which are always among the highest bids the person can afford.
AFFORDABLE_LADDER_CENTS = (1000, 2500, 5000, 7500, 10000, 12500, 15000, 17500, 20000, 25000, 30000, 40000, 50000)
CONTESTED_MIN_PFILL = 0.3
CONF_COVERAGE = (0.70, 0.90)
CONF_MIN_FILLED = 50
SGT = timezone(timedelta(hours=8))

# Window labels exactly as BOSS shows them, in the order they run within a term.
# "Round 1 Window n" and "Round 1A Window n" are different labels and stay separate.
WINDOW_ORDER = [
    "Incoming Exchange Rnd 1C Win 1",
    "Incoming Exchange Rnd 1C Win 2",
    "Incoming Exchange Rnd 1C Win 3",
    "Incoming Freshmen Rnd 1 Win 1",
    "Incoming Freshmen Rnd 1 Win 2",
    "Incoming Freshmen Rnd 1 Win 3",
    "Incoming Freshmen Rnd 1 Win 4",
    "Round 1 Window 1",
    "Round 1 Window 2",
    "Round 1 Window 3",
    "Round 1 Window 4",
    "Round 1A Window 1",
    "Round 1A Window 2",
    "Round 1A Window 3",
    "Round 1B Window 1",
    "Round 1B Window 2",
    "Round 2 Window 1",
    "Round 2 Window 2",
    "Round 2 Window 3",
    "Round 2 Window 4",
    "Round 2A Window 1",
    "Round 2A Window 2",
    "Round 2A Window 3",
]
WINDOW_INDEX = {w: i for i, w in enumerate(WINDOW_ORDER)}
TERM_RE = re.compile(r"^(\d{4})-(\d{2}) Term (1|2|3A|3B)$")
TERM_NO = {"1": 1, "2": 2, "3A": 3, "3B": 4}
SAFE_CODE_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class BuildError(Exception):
    pass


def window_rank(label: str) -> int:
    try:
        return WINDOW_INDEX[label]
    except KeyError:
        raise BuildError(f"unknown window label: {label!r}") from None


def term_key(term: str) -> tuple[int, int]:
    m = TERM_RE.match(term)
    if not m:
        raise BuildError(f"unrecognised term label: {term!r}")
    return int(m.group(1)), TERM_NO[m.group(3)]


def to_cents(value: str) -> int:
    return int((Decimal(value) * 100).to_integral_value())


def to_int(value: str) -> int | None:
    value = value.strip()
    return int(value) if value else None


def split_multi(value: str) -> list[str]:
    return [p.strip() for p in value.split(";")] if value.strip() else []


def clean_time(value: str) -> str | None:
    value = value.strip()
    return None if value in ("", "TBA") else value


def iso_date(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    return datetime.strptime(value, "%d-%b-%Y").date().isoformat()


def parse_meetings(row: dict) -> list[dict]:
    n = int(row["meeting_count"])
    if n == 0:
        return []
    days = split_multi(row["days"])
    starts = split_multi(row["start_times"])
    ends = split_multi(row["end_times"])
    venues = split_multi(row["venues"]) or [""] * n
    for name, parts in (("days", days), ("start_times", starts), ("end_times", ends), ("venues", venues)):
        if len(parts) != n:
            raise BuildError(
                f"class {row['class_number']} {row['term']}: {name} has {len(parts)} parts, meeting_count={n}"
            )
    return [
        {"day": d, "start": clean_time(s), "end": clean_time(e), "venue": v or None}
        for d, s, e, v in zip(days, starts, ends, venues)
    ]


def history_entry(row: dict) -> dict:
    no_bids = row["no_bids"].strip() == "1"
    return {
        "term": row["term"],
        "window": row["window"],
        "section": row["section"],
        "classNumber": row["class_number"],
        "instructor": row["instructor"] or None,
        "days": row["days"],
        "start": row["start_times"],
        "end": row["end_times"],
        "medianCents": None if no_bids else to_cents(row["median_bid"]),
        "minCents": None if no_bids else to_cents(row["min_bid"]),
        "vacancy": to_int(row["vacancy"]),
        "before": to_int(row["before_process_vacancy"]),
        "after": to_int(row["after_process_vacancy"]),
        "enrolled": to_int(row["enrolled"]),
    }


def section_entry(row: dict) -> dict:
    return {
        "id": row["class_number"],
        "section": row["section"],
        "classNumber": row["class_number"],
        "instructor": row["instructor"] or None,
        "meetings": parse_meetings(row),
        "startDate": iso_date(row["start_date"]),
        "endDate": iso_date(row["end_date"]),
        "tba": row["has_tba_time"].strip() == "1",
        "hasClassDetails": row["has_class_details"].strip() == "1",
        "seatsTotal": to_int(row["vacancy"]),
        "seatsLeft": to_int(row["after_process_vacancy"]),
        "latestWindow": row["window"],
        "enrolled": to_int(row["enrolled"]),
    }


def sort_key(row: dict):
    return (term_key(row["term"]), window_rank(row["window"]), row["section"], row["class_number"])


def load_rows(csv_path: Path) -> list[dict]:
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    unknown = sorted({r["window"] for r in rows if r["window"] not in WINDOW_INDEX})
    if unknown:
        raise BuildError(f"unknown window labels in CSV: {unknown}")
    bad_terms = sorted({r["term"] for r in rows if not TERM_RE.match(r["term"])})
    if bad_terms:
        raise BuildError(f"unrecognised term labels in CSV: {bad_terms}")
    return rows


def _parse_when(value: str) -> datetime:
    """ISO timestamp -> aware datetime; a naive one is read as SGT."""
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=SGT)


def choose_window(schedule: list[dict], current: dict, now: datetime) -> dict:
    """The window the site shows by default at `now`. Keep identical to chooseWindow in site/src/lib/data/window.ts.

    Inside a window [opensAt, closesAt) -> that window, "open". Else the next window opening after `now`,
    "upcoming" (mid-round gaps and the gap between rounds alike). Else the last window, "closed".
    If the schedule is empty or has an unreadable time, falls back to the configured `current` (warns).
    Returns {round, window, opensAt, closesAt, status}.
    """
    now = now if now.tzinfo else now.replace(tzinfo=SGT)
    try:
        timed = sorted(((_parse_when(s["opensAt"]), _parse_when(s["closesAt"]), s) for s in schedule), key=lambda t: t[0])
    except (KeyError, TypeError, ValueError):
        timed = []
    if not timed:
        print("warning: window schedule is empty or unreadable; using the configured current window", file=sys.stderr)
        match = [s for s in schedule if s["round"] == current["round"] and s["window"] == current["window"]]
        if len(match) != 1:
            raise BuildError(f"current window {current['round']} W{current['window']} not found once in schedule")
        s = match[0]
        return {"round": s["round"], "window": s["window"], "opensAt": s["opensAt"], "closesAt": s["closesAt"],
                "status": current["status"]}
    pick, status = timed[-1][2], "closed"
    for opens, closes, s in timed:
        if opens <= now < closes:
            pick, status = s, "open"
            break
    else:
        for opens, _, s in timed:
            if opens > now:
                pick, status = s, "upcoming"
                break
    return {"round": pick["round"], "window": pick["window"], "opensAt": pick["opensAt"],
            "closesAt": pick["closesAt"], "status": status}


def load_window_config(path: Path, current_term: str | None, now: datetime | None = None) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    term = current_term or cfg["currentTerm"]
    chosen = choose_window(cfg["schedule"], cfg["current"], now or datetime.now(SGT))
    return {
        "currentTerm": term,
        "window": {"term": term, **chosen},
        "schedule": cfg["schedule"],
    }


def load_live_seats(path: Path | None, current_term: str) -> tuple[dict, dict | None]:
    """Read the merged availability CSV. Returns ({(course_code, section): live}, summary) for current_term only.

    `live` is {available, total, source: "live"|"approx", capturedAt, window}. Nothing else from the file is kept
    (no enrolled/reserved/section_status). A missing or unreadable file warns and returns ({}, None).
    """
    if path is None:
        print("live seats skipped: no availability file", file=sys.stderr)
        return {}, None
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            raw = list(csv.DictReader(f))
    except (OSError, UnicodeError, csv.Error) as e:
        print(f"live seats skipped: cannot read {path.name}: {e}", file=sys.stderr)
        return {}, None
    live: dict[tuple[str, str], dict] = {}
    skipped = 0
    for r in raw:
        if (r.get("term") or "") != current_term:
            continue
        source = {"live_scan": "live", "approx_previous_window": "approx"}.get(r.get("seats_source") or "")
        try:
            available, total = int(r["available"]), int(r["total"])
        except (KeyError, TypeError, ValueError):
            skipped += 1
            continue
        code, section = (r.get("course_code") or "").strip(), (r.get("section") or "").strip()
        if source is None or not code or not section:
            skipped += 1
            continue
        live[(code, section)] = {"available": available, "total": total, "source": source,
                                 "capturedAt": r.get("captured_at") or "", "window": r.get("window") or ""}
    if skipped:
        print(f"live seats: skipped {skipped} unusable rows in {path.name}", file=sys.stderr)
    if not live:
        print(f"live seats skipped: no rows for {current_term!r} in {path.name}", file=sys.stderr)
        return {}, None
    stamps = sorted(v["capturedAt"] for v in live.values() if v["capturedAt"])
    windows = sorted({v["window"] for v in live.values() if v["window"]})
    summary = {
        "capturedAt": stamps[-1] if stamps else "",
        "window": windows[-1] if windows else "",
        "live": sum(v["source"] == "live" for v in live.values()),
        "approx": sum(v["source"] == "approx" for v in live.values()),
    }
    return live, summary


def attach_live_seats(docs: dict, live: dict) -> int:
    """Put `live` on each current-term section that has a row. Returns how many were attached."""
    n = 0
    for code, doc in docs.items():
        for s in doc["sectionsNow"]:
            v = live.get((code, s["section"]))
            if v:
                s["live"] = dict(v)
                n += 1
    return n


HISTORY_MAX_POINTS = 40
HISTORY_MAX_DIRS = 80


def _stamp_iso(stamp) -> str | None:
    """'20261107T013050' (local SGT) -> '2026-11-07T01:30:50+08:00', or None if it is not a stamp."""
    try:
        return datetime.strptime(str(stamp), "%Y%m%dT%H%M%S").replace(tzinfo=SGT).isoformat(timespec="seconds")
    except (ValueError, TypeError):
        return None


def _int_or_none(v) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def scan_time(avail_dir: Path) -> str | None:
    """ISO (SGT) time of the live scan behind an availability dir: the stamp of the scan dir named in
    current_availability.meta.json (the same kind of stamp scan-changes.json uses), else the dir's own stamp. None if neither parses."""
    try:
        meta = json.loads((Path(avail_dir) / "current_availability.meta.json").read_text(encoding="utf-8"))
        at = _stamp_iso(Path(str(meta["scan_dir"])).name)
        if at:
            return at
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return _stamp_iso(Path(avail_dir).name)


def load_seat_deltas(path: Path | None, current_term: str, window: str | None = None) -> tuple[dict, dict | None]:
    """Read scan-changes.json next to the availability file. Returns ({(course_code, section): {sinceOpen, sinceLast}}, times).

    Only the `available` change is kept (never enrolled or reserved). `times` is {openScanAt, prevScanAt} (ISO, SGT).
    A missing, unreadable or malformed file, one without `seat_deltas`, or (when `window` is given) one whose `window`
    differs from the window of the live seats, warns and returns ({}, None).
    """
    if path is None:
        return {}, None
    f = Path(path).parent / "scan-changes.json"
    try:
        doc = json.loads(f.read_text(encoding="utf-8"))
        sd = doc["seat_deltas"]
        sections = sd["sections"]
        if not isinstance(sections, list):
            raise TypeError("seat_deltas.sections is not a list")
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"seat deltas skipped: {f.name} unusable next to {Path(path).name} ({type(e).__name__}: {e})", file=sys.stderr)
        return {}, None
    if window is not None and doc.get("window") != window:
        print(f"seat deltas skipped: {f.name} is for window {doc.get('window')!r}, live seats are {window!r}", file=sys.stderr)
        return {}, None
    deltas: dict[tuple[str, str], dict] = {}
    for r in sections:
        if not isinstance(r, dict) or r.get("term") != current_term:
            continue
        code, section = str(r.get("course_code") or "").strip(), str(r.get("section") or "").strip()
        if not code or not section:
            continue
        def avail(key):
            v = r.get(key)
            return _int_or_none(v.get("available")) if isinstance(v, dict) else None
        deltas[(code, section)] = {"sinceOpen": avail("vs_baseline"), "sinceLast": avail("vs_previous")}
    times = {"openScanAt": _stamp_iso(doc.get("baseline_scan")), "prevScanAt": _stamp_iso(doc.get("previous_scan"))}
    return deltas, times


def load_seat_history(path: Path | None, current_term: str, window: str) -> dict:
    """{(course_code, section): [{at, available}, ...]} from the availability dirs beside `path` whose rows are in `window`.

    `at` is the scan time of each dir (see scan_time), not the CSV captured_at (merge time). Live-scan rows only,
    deduplicated by `at`, oldest first, at most HISTORY_MAX_POINTS (the newest). Unreadable dirs are skipped.
    """
    if path is None or not window:
        return {}
    root = Path(path).parent.parent
    own = Path(path).parent.name
    dirs = sorted((d for d in root.glob("*/current_availability.csv") if d.parent.name <= own), key=lambda p: p.parent.name)[-HISTORY_MAX_DIRS:]
    hist: dict[tuple[str, str], dict[str, int]] = defaultdict(dict)
    for csv_path in dirs:
        at = scan_time(csv_path.parent)
        if not at:
            print(f"seat history: skipped {csv_path.parent.name}: no scan time", file=sys.stderr)
            continue
        try:
            with open(csv_path, newline="", encoding="utf-8-sig") as f:
                for r in csv.DictReader(f):
                    if (r.get("term") or "") != current_term or (r.get("window") or "") != window or r.get("seats_source") != "live_scan":
                        continue
                    code, section = (r.get("course_code") or "").strip(), (r.get("section") or "").strip()
                    try:
                        available = int(r["available"])
                    except (KeyError, TypeError, ValueError):
                        continue
                    if code and section:
                        hist[(code, section)][at] = available
        except (OSError, UnicodeError, csv.Error) as e:
            print(f"seat history: skipped {csv_path.parent.name}: {e}", file=sys.stderr)
    return {k: [{"at": at, "available": v[at]} for at in sorted(v)][-HISTORY_MAX_POINTS:] for k, v in hist.items()}


def attach_seat_deltas(docs: dict, deltas: dict, history: dict | None = None, open_scan_at: str | None = None) -> int:
    """Add sinceOpen/sinceLast (and history) to each section whose `live.source` is "live". Returns how many got deltas.

    When sinceOpen and `open_scan_at` are known, the history starts with the window-open point
    {at: open_scan_at, available: now - sinceOpen}, so history[0].available + sinceOpen == the last point.
    History is kept only with 2+ points, and never if its last point disagrees with the live count.
    """
    n = 0
    for code, doc in docs.items():
        for s in doc["sectionsNow"]:
            live = s.get("live")
            if not live or live.get("source") != "live":
                continue
            d = deltas.get((code, s["section"]))
            if d:
                live["sinceOpen"], live["sinceLast"] = d["sinceOpen"], d["sinceLast"]
                n += 1
            pts = list((history or {}).get((code, s["section"])) or [])
            since_open = d["sinceOpen"] if d else None
            if since_open is not None and open_scan_at and pts:
                pts = [{"at": open_scan_at, "available": live["available"] - since_open}] + [p for p in pts if p["at"] > open_scan_at]
                pts = pts[:1] + pts[1:][-(HISTORY_MAX_POINTS - 1):]
            if len(pts) >= 2 and pts[-1]["available"] == live["available"]:
                live["history"] = pts
    return n


def build(rows: list[dict], current_term: str) -> tuple[dict, dict]:
    """Return (index_entries_by_code, course_docs_by_code)."""
    by_course: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        for col in ("course_code", "term", "window"):
            if not r[col].strip():
                raise BuildError(f"row missing {col}: {r}")
        by_course[r["course_code"]].append(r)

    index, docs = {}, {}
    for code, crows in by_course.items():
        crows.sort(key=sort_key)
        latest = crows[-1]
        now_rows = [r for r in crows if r["term"] == current_term]
        latest_by_class: dict[str, dict] = {}
        for r in now_rows:  # sorted ascending, so the last one per class wins
            latest_by_class[r["class_number"]] = r
        sections_now = sorted(
            (section_entry(r) for r in latest_by_class.values()),
            key=lambda s: (s["section"], s["classNumber"]),
        )
        docs[code] = {
            "code": code,
            "title": latest["description"],
            "school": latest["school"],
            "sectionsNow": sections_now,
            "history": [history_entry(r) for r in crows],
        }
        index[code] = {
            "code": code,
            "title": latest["description"],
            "school": latest["school"],
            "offeredNow": bool(now_rows),
            "sectionsNow": len({r["section"] for r in now_rows}),
            "termsWithData": len({r["term"] for r in crows}),
        }
    return index, docs


# ---------------------------------------------------------------- browse index

BROWSE_COLUMNS = ["course", "window", "section", "instructor",
                  "medianCents", "minCents", "vacancy", "before", "after", "filled", "slot"]


def browse_shard_name(term: str) -> str:
    return "browse/" + term.lower().replace(" ", "-") + ".json"


def _lookup(table: list, seen: dict, value):
    """Index of `value` in `table`, appending it on first sight; None -> -1."""
    if value is None:
        return -1
    i = seen.get(value)
    if i is None:
        i = seen[value] = len(table)
        table.append(value)
    return i


def _slot_of(h: dict) -> tuple | None:
    """(days, start, end) of a history entry as text, or None when it has no day and start time at all."""
    t = tuple((h.get(k) or None) for k in ("days", "start", "end"))
    return t if t[0] and t[1] else None


def build_browse(rows: list[dict], index: dict, first_term: str | None = None) -> tuple[dict, dict[str, dict]]:
    """Compact table of every course x section x term x window result for the data explorer.

    Returns (manifest, shards). The manifest (browse.json) holds the lookup tables and one entry per term;
    each shard (browse/<term>.json, `{"term", "rows"}`) holds that term's rows, so a page loads only the terms it needs.
    `rows[i]` lines up with manifest["columns"]. Repeated strings are indexes into `windows`, `sections`,
    `instructors`; `slot` is an index into `slots`, whose entries are [days, start, end] exactly as the CSV joins
    them ("MON; THU", "08:15; 08:15", "09:00; 09:45"; all null when there is no timetable); `course` is the position in `codes` (the sorted order of index.json, which has title and
    school, so neither is repeated). A missing value is -1 for lookup columns and null for numbers. `filled` is 1
    when vacancy > 0 and after-process vacancy is 0 (the rule site/src/components/explore/rows.ts uses).
    Terms before `first_term` are left out.
    """
    codes = sorted(index)
    code_i = {c: i for i, c in enumerate(codes)}
    min_key = term_key(first_term) if first_term else None
    windows: list = []
    sections: list = []
    instructors: list = []
    slots: list = []
    seen = {"w": {}, "s": {}, "i": {}, "t": {}}
    by_term: dict[str, list] = defaultdict(list)
    for r in sorted(rows, key=lambda r: (r["course_code"], sort_key(r))):
        if min_key and term_key(r["term"]) < min_key:
            continue
        h = history_entry(r)
        vacancy, after = h["vacancy"], h["after"]
        by_term[h["term"]].append([
            code_i[r["course_code"]],
            _lookup(windows, seen["w"], h["window"]),
            _lookup(sections, seen["s"], h["section"]),
            _lookup(instructors, seen["i"], h["instructor"]),
            h["medianCents"], h["minCents"], vacancy, h["before"], after,
            1 if (vacancy is not None and vacancy > 0 and after == 0) else 0,
            _lookup(slots, seen["t"], _slot_of(h)),
        ])
    terms = sorted(by_term, key=term_key)
    shards = {browse_shard_name(t): {"term": t, "rows": by_term[t]} for t in terms}
    manifest = {"columns": BROWSE_COLUMNS, "codes": codes, "windows": windows, "sections": sections,
                "instructors": instructors, "slots": [list(x) for x in slots],
                "terms": [{"term": t, "file": browse_shard_name(t), "rows": len(by_term[t])} for t in terms]}
    return manifest, shards


# ---------------------------------------------------------------- forecasts

def load_forecast_params(path: Path | None, current_term: str) -> dict | None:
    """Return the parsed params file, or None when forecasts should stay off (missing, not ok, other term)."""
    if path is None or not Path(path).exists():
        return None
    params = json.loads(Path(path).read_text(encoding="utf-8"))
    if not params.get("forecasts_ok"):
        print(f"forecasts skipped: {path} has forecasts_ok=false", file=sys.stderr)
        return None
    if params.get("term") != current_term:
        print(f"forecasts skipped: params are for {params.get('term')!r}, site is {current_term!r}", file=sys.stderr)
        return None
    return params


def _correction_sim(job):
    """One simulator call for the correction step (module level so a process pool can run it)."""
    sys.path.insert(0, str(ROOT / "model"))
    try:
        from forecast import fit  # noqa: PLC0415
    finally:
        sys.path.pop(0)
    return fit._sim_one(job)


def correction_sections(docs: dict) -> dict:
    """{class_number: {seats, total}}: the seats the site shows for each current section (live scan, else last window's vacancy)."""
    out = {}
    for doc in docs.values():
        for s in doc["sectionsNow"]:
            live = s.get("live")
            out[s["classNumber"]] = {"seats": live["available"] if live else s.get("seatsLeft"),
                                     "total": live["total"] if live else s["seatsTotal"]}
    return out


CORRECTION_POOL_TIMEOUT = 600  # s for all correction simulations (about 30 s measured)


def maybe_correct(params: dict, backtest: dict, rows: list[dict], term: str, docs: dict, window: dict,
                  corrected_path: Path | None, processes: int | None = None) -> tuple[dict, dict, str]:
    """Apply the GBM level correction when it is switched on, its corrected backtest matches this fit, and it passes its gate.

    Returns (params, backtest, modelVersion). On any problem (missing scikit-learn, no/stale corrected backtest, a training
    error, a failed sanity gate) it warns and returns the inputs unchanged with version "fit": the build never fails here.
    When applied, the returned backtest is the corrected one, so forecast-meta.json and accuracy.json describe the model shown.
    """
    try:
        sys.path.insert(0, str(ROOT / "model"))
        try:
            from forecast import correction  # noqa: PLC0415
        finally:
            sys.path.pop(0)
        corr = json.loads(Path(corrected_path).read_text(encoding="utf-8")) if corrected_path and Path(corrected_path).exists() else None
        why = correction.corrected_backtest_usable(corr, backtest)
        if why:
            print(f"WARNING: forecast correction skipped, using uncorrected params: {why}", file=sys.stderr)
            return params, backtest, "fit"
        first = f"Round {window['round']} Window {window['window']}"
        pool = None
        pool_map = None
        if len(docs) > 20:
            from multiprocessing import Pool  # noqa: PLC0415
            pool = Pool(processes or os.cpu_count() or 1)
            # a hang must fall back to the plain fit (via the except below), not run into the site stage's 30 min kill
            pool_map = lambda fn, jobs: pool.map_async(_correction_sim, list(jobs), chunksize=40).get(timeout=CORRECTION_POOL_TIMEOUT)  # noqa: E731
        try:
            new, info = correction.try_apply_correction(params, rows, term, correction_sections(docs), first, pool_map=pool_map)
        finally:
            if pool:
                pool.terminate()  # after a clean map the workers are idle, so this is the same as close(); after a timeout it frees them
                pool.join()
        if info is None:
            return params, backtest, "fit"
        return new, corr, info["modelVersion"]
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: forecast correction skipped, using uncorrected params: {type(e).__name__}: {e}", file=sys.stderr)
        return params, backtest, "fit"


def attach_exams(docs: dict, schedule_dir: Path, term: str) -> int:
    """Set `exam` ({date, start, end} or None) on each current section from the ClassDetails captures; returns how many have one.

    Optional and non-fatal: without the capture folder (or on any error) the sections get no `exam` field and a warning is printed.
    """
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        try:
            import exams  # noqa: PLC0415
        finally:
            sys.path.pop(0)
        found, read = exams.load_exams(schedule_dir, term)
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: exam dates skipped: {type(e).__name__}: {e}", file=sys.stderr)
        return 0
    if not read:
        return 0
    n = 0
    for doc in docs.values():
        for s in doc["sectionsNow"]:
            exam = found.get(s["classNumber"])
            s["exam"] = exam
            n += exam is not None
    return n


def drop_windows(window: dict, schedule: list[dict]) -> tuple[str, str, list[str]] | None:
    """(base window label, how "full" is read, later window labels) for the drop chance, from the site's current window.

    Open window w: a full section started w full ("before"), chances for the windows after w.
    Between windows: the section was full when the last window ended ("after"), chances for the next window onward.
    None when there is nothing to forecast (last window, or no schedule).
    """
    timed = sorted(((_parse_when(s["opensAt"]), s) for s in schedule), key=lambda t: t[0])
    labels = [f"Round {s['round']} Window {s['window']}" for _, s in timed]
    cur = f"Round {window['round']} Window {window['window']}"
    if cur not in labels:
        return None
    i = labels.index(cur)
    if window.get("status") == "upcoming":
        return (labels[i - 1], "after", labels[i:]) if i > 0 else None
    if window.get("status") == "open" and i + 1 < len(labels):
        return cur, "before", labels[i + 1:]
    return None


def attach_drops(docs: dict, rows: list[dict], window: dict, schedule: list[dict], term: str) -> int:
    """Add a course-level `drops` block to each current-term course with a full section: the cumulative chance
    that a seat is offered again by each later window (model/forecast/drops.py). Returns the course count."""
    try:
        plan = drop_windows(window, schedule)
    except (KeyError, TypeError, ValueError):  # unreadable schedule: no drop chance, the build goes on
        plan = None
    if not plan:
        return 0
    base, full_at, targets = plan
    def left(s):
        return s["live"]["available"] if s.get("live") else s.get("seatsLeft")

    full_courses = [c for c, d in docs.items() if any(left(s) is not None and left(s) <= 0 for s in d["sectionsNow"])]
    try:
        from forecast import drops  # noqa: PLC0415
        found = drops.drop_chances(rows, full_courses, WINDOW_ORDER, base, targets, skip_term=term, full_at=full_at)
    except Exception as e:  # the drop chance is an extra: never fail a build for it
        print(f"WARNING: drop chance skipped: {type(e).__name__}: {e}", file=sys.stderr)
        return 0
    for c, steps in found.items():
        docs[c]["drops"] = {"from": base, "steps": steps}
    return len(found)


def attach_forecasts(docs: dict, params: dict) -> int:
    """Add `forecast` and `minBidCents` to each current section that has fitted parameters. Returns count."""
    classes = params["classes"]
    attached = 0
    for doc in docs.values():
        for s in doc["sectionsNow"]:
            c = classes.get(s["classNumber"])
            if not c:
                continue
            s["minBidCents"] = c["minBidCents"]
            s["forecast"] = {
                w: {**{k: v[k] for k in SIM_PARAM_KEYS}, "pooledLevel": v["pooledLevel"], "nObs": v["nObs"]}
                for w, v in c["windows"].items()
            }
            attached += 1
    return attached


def window_confidence(bt: dict) -> str:
    """'ok' when the 80% range held for filled sections 70-90% of the time on enough filled sections."""
    cov = bt.get("coverage80Filled")
    lo, hi = CONF_COVERAGE
    if cov is not None and lo <= cov <= hi and bt.get("filled", 0) >= CONF_MIN_FILLED:
        return "ok"
    return "low"


def accuracy_basis(model_version: str) -> str | None:
    """"next-window" when the corrected backtest is shown: it scores each window using the actual results of all earlier
    windows of its term, i.e. a forecast made just before that window opens. Windows further ahead are forecast with less
    information, so their accuracy is lower. None for the plain fit (its backtest does not make that claim)."""
    return "next-window" if model_version != "fit" else None


def load_refit_note(path: Path) -> dict:
    """refitAt / afterWindow / newBids from the refit's fit-meta.json; keys the file lacks (or a missing file) are left out."""
    try:
        meta = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(meta, dict):
        return {}
    out = {}
    if isinstance(meta.get("refitAt"), str) and meta["refitAt"]:
        out["refitAt"] = meta["refitAt"]
        if isinstance(meta.get("afterWindow"), str) and meta["afterWindow"]:
            out["afterWindow"] = meta["afterWindow"]
        n = meta.get("newBids")
        if isinstance(n, int) and not isinstance(n, bool) and n >= 0:
            out["newBids"] = n
    return out


def build_forecast_meta(params: dict | None, backtest: dict | None, generated: str, model_version: str = "fit") -> dict:
    if not params or not backtest:
        return {"term": None, "windows": [], "byWindow": {}, "coverage80": None, "maeCents": None,
                "samples": 0, "baseline": None, "generatedAt": generated, "modelVersion": model_version}
    by = {}
    for w in params["windows"]:
        bt = backtest.get("byWindow", {}).get(w)
        if not bt:
            by[w] = {"confidence": "low", "samples": 0, "filled": 0, "coverage80": None,
                     "coverage80Filled": None, "maeCents": None, "baselineMaeCents": None}
            continue
        by[w] = {
            "confidence": window_confidence(bt),
            "samples": bt["samples"],
            "filled": bt["filled"],
            "coverage80": bt["coverage80"],
            "coverage80Filled": bt["coverage80Filled"],
            "maeCents": bt["maeCents"],
            # Error of reusing last term's bid, on the sections that had one.
            "baselineMaeCents": (bt.get("baseline") or {}).get("maeCents"),
        }
    base = backtest.get("baseline") or {}
    return {
        "term": params["term"],
        "windows": list(params["windows"]),
        "byWindow": by,
        "coverage80": backtest["coverage80"],
        "maeCents": backtest["maeCents"],
        "samples": backtest["samples"],
        # Baseline = last term's price; model figure is on the same sections so the two compare fairly.
        "baseline": {
            "samples": base.get("samples"),
            "maeCents": base.get("maeCents"),
            "modelMaeCents": base.get("modelMaeOnSameSamples"),
        },
        "generatedAt": generated,
        "modelVersion": model_version,
        **({"accuracyBasis": basis} if (basis := accuracy_basis(model_version)) else {}),
    }


def build_accuracy(backtest: dict | None, model_version: str = "fit") -> dict:
    """accuracy.json: the model's own backtest figures, so the site never hand-types them (site/src/lib/data/accuracy.ts).

    `filledTests`: per backtest term, the sections that filled (clearing bid above the minimum): filled count, the model's
    miss on them (fMae, scored on the same sections as the baseline), the baseline's miss (fBase) and the share whose real
    bid fell inside the 10th-90th percentile range (fCov), and fMed: the median miss on those sections (left out when the
    backtest has no median). `heldOut`: all-forecast figures on the held-out term
    (n forecasts, baseN forecastable by the baseline, mae, base mae, cov). Empty lists/None when there is no backtest.
    """
    empty = {"filledTests": [], "heldOut": None}
    if not backtest:
        return empty

    def filled(block: dict | None, term: str | None) -> dict | None:
        base = (block or {}).get("baseline") or {}
        need = (block or {}).get("filled"), base.get("modelMaeFilledCondOnSameSamples"), base.get("maeFilledCents"), \
            (block or {}).get("coverage80Filled")
        if not term or any(v is None for v in need):
            return None
        out = {"term": term, "filled": need[0], "fMae": need[1], "fBase": need[2], "fCov": need[3]}
        if (block or {}).get("medianAbsErrFilledCondCents") is not None:
            out["fMed"] = block["medianAbsErrFilledCondCents"]
        return out

    tests = [t for t in (filled(backtest.get("overall"), (backtest.get("overall") or {}).get("term") or backtest.get("term")),
                         filled(backtest.get("heldOut"), (backtest.get("heldOut") or {}).get("term"))) if t]
    h = backtest.get("heldOut") or {}
    hb = h.get("baseline") or {}
    held = None
    if h.get("term") and None not in (h.get("samples"), hb.get("samples"), h.get("maeCents"), hb.get("maeCents"), h.get("coverage80")):
        held = {"term": h["term"], "n": h["samples"], "baseN": hb["samples"], "mae": h["maeCents"],
                "base": hb["maeCents"], "cov": h["coverage80"]}
    return {"filledTests": tests, "heldOut": held, **({"accuracyBasis": basis} if (basis := accuracy_basis(model_version)) else {})}


def _load_sim():
    sys.path.insert(0, str(ROOT / "model"))
    try:
        from forecast import sim  # noqa: PLC0415
    finally:
        sys.path.pop(0)
    return sim


def _highlight_sim(job):
    """One highlight simulation (module level so a process pool can run it)."""
    seats, min_bid, fc, runs = job
    sim = _load_sim()
    r = sim.simulate(seats, 1, min_bid, sim.SimParams(**fc), runs=runs, seed=HIGHLIGHT_SEED)
    return round(r["pFill"], 3), r["percentilesCents"]["p50"], sim.recommend_bid(r, HIGHLIGHT_TARGET)


def with_affordable(ranked: list[dict], limit: int, ladder=AFFORDABLE_LADDER_CENTS) -> list[dict]:
    """`ranked` cut to its first `limit` rows plus the first `limit` rows with bidCents <= each ladder amount.

    Order stays as in `ranked`, each row once. Lets a viewer who hides bids above their balance still see `limit` rows.
    """
    keep = set(range(min(limit, len(ranked))))
    for cap in ladder:
        taken = 0
        for i, r in enumerate(ranked):
            if r["bidCents"] <= cap:
                keep.add(i)
                taken += 1
                if taken == limit:
                    break
    return [r for i, r in enumerate(ranked) if i in keep]


def build_highlights(docs: dict, params: dict | None, window: dict, runs: int = HIGHLIGHT_RUNS,
                     limit: int = HIGHLIGHT_LIMIT, processes: int | None = None) -> dict:
    """Simulate EVERY forecast window for every current section with seats left; pick the two lists per window.

    Shape: {term, window (the open one), runs, targetP, byWindow: {label: {mostContested, easy}}}. Each list holds the
    top `limit` rows plus more affordable ones (see with_affordable), in rank order; readers take the first rows that pass their filter.
    The simulations run in a process pool: the first windows draw hundreds of bidders per section, which is
    too slow on one core. Each simulation has a fixed seed, so the result does not depend on the pool.
    """
    label = f"Round {window['round']} Window {window['window']}"
    out = {"term": window["term"], "window": label, "runs": runs, "targetP": HIGHLIGHT_TARGET, "byWindow": {}}
    if not params:
        return out
    rows_by_w, jobs = {}, []
    for wlabel in params["windows"]:
        rows = rows_by_w[wlabel] = []
        for code in sorted(docs):
            doc = docs[code]
            for s in doc["sectionsNow"]:
                fc = (s.get("forecast") or {}).get(wlabel)
                live = s.get("live")  # same seats the course page shows: live scan, else the last window's vacancy
                seats = live["available"] if live else s.get("seatsLeft")
                total = live["total"] if live else s["seatsTotal"]
                if not fc or seats is None or seats <= 0:
                    continue
                jobs.append((seats, s["minBidCents"], {k: fc[k] for k in SIM_PARAM_KEYS}, runs))
                rows.append({
                    "code": code, "title": doc["title"], "section": s["section"], "classNumber": s["classNumber"],
                    "instructor": s["instructor"], "seatsLeft": seats, "seatsTotal": total,
                    "minBidCents": s["minBidCents"],
                })
                if live and live["source"] == "approx":
                    rows[-1]["approx"] = True
    if processes == 1 or len(jobs) < 50:
        results = [_highlight_sim(j) for j in jobs]
    else:
        from multiprocessing import Pool  # noqa: PLC0415
        with Pool(processes or os.cpu_count() or 1) as pool:
            results = pool.map(_highlight_sim, jobs, chunksize=8)
    it = iter(results)
    for wlabel, rows in rows_by_w.items():
        for r in rows:
            pfill, p50, bid = next(it)
            # keep the original key order: pFill, p50Cents, bidCents after minBidCents, then approx
            approx = r.pop("approx", None)
            r.update(pFill=pfill, p50Cents=p50, bidCents=bid)
            if approx:
                r["approx"] = True
        contested = [r for r in rows if r["pFill"] >= CONTESTED_MIN_PFILL]
        contested.sort(key=lambda r: (-r["bidCents"], -r["pFill"], r["code"], r["section"]))
        easy = sorted(rows, key=lambda r: (r["pFill"], -r["seatsLeft"], r["code"], r["section"]))
        out["byWindow"][wlabel] = {"mostContested": with_affordable(contested, limit), "easy": with_affordable(easy, limit)}
    return out


def load_results_partial(csv_path: Path) -> dict | None:
    """{window, posted, expected} from dataset-meta.json beside the CSV when its results are only partly released, else None.

    A missing file (older datasets) is normal; an unreadable or malformed one warns and counts as None. The file's
    accepted_at time and anything else in it are not copied.
    """
    f = Path(csv_path).parent / "dataset-meta.json"
    try:
        doc = json.loads(f.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as e:
        print(f"results_partial skipped: cannot read {f.name} ({type(e).__name__})", file=sys.stderr)
        return None
    p = doc.get("results_partial") if isinstance(doc, dict) else None
    if p is None:
        return None
    ints = [p.get(k) if isinstance(p, dict) else None for k in ("posted", "expected")]
    window = p.get("window") if isinstance(p, dict) else None
    if not (isinstance(window, str) and window in WINDOW_INDEX
            and all(isinstance(n, int) and not isinstance(n, bool) and n >= 0 for n in ints)):
        print(f"results_partial skipped: malformed in {f.name}", file=sys.stderr)
        return None
    return {"window": window, "posted": ints[0], "expected": ints[1]}


def latest_results_window(rows: list[dict], current_term: str) -> str | None:
    labels = {r["window"] for r in rows if r["term"] == current_term}
    return max(labels, key=window_rank) if labels else None


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def write_file(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    os.chmod(path, 0o644)


def write_outputs(out: Path, meta: dict, index: dict, docs: dict,
                  forecast_meta: dict | None = None, highlights: dict | None = None,
                  browse: tuple[dict, dict[str, dict]] | None = None, accuracy: dict | None = None) -> None:
    codes = sorted(docs)
    for code in codes:
        if not SAFE_CODE_RE.match(code):
            raise BuildError(f"course code not filename-safe: {code!r}")
    lowered = defaultdict(list)
    for c in codes:
        lowered[c.lower()].append(c)
    clash = [v for v in lowered.values() if len(v) > 1]
    if clash:
        raise BuildError(f"course codes collide on case-insensitive filesystems: {clash}")

    courses = out / "courses"
    out.mkdir(parents=True, exist_ok=True)
    courses.mkdir(exist_ok=True)
    for stale in courses.glob("*.json"):  # clear only previously generated files
        stale.unlink()
    browse_dir = out / "browse"
    for stale in browse_dir.glob("*.json"):
        stale.unlink()
    if browse is not None:
        browse_dir.mkdir(exist_ok=True)
        os.chmod(browse_dir, 0o755)
    for name in ("meta.json", "index.json", "browse.json", "forecast-meta.json", "highlights.json"):
        (out / name).unlink(missing_ok=True)
    os.chmod(out, 0o755)
    os.chmod(courses, 0o755)

    for code in codes:
        write_file(courses / f"{code}.json", dumps(docs[code]))
    write_file(out / "index.json", dumps([index[c] for c in codes]))
    write_file(out / "meta.json", dumps(meta))
    if browse is not None:
        manifest, shards = browse
        write_file(out / "browse.json", dumps(manifest))
        for name, doc in shards.items():
            write_file(out / name, dumps(doc))
    write_file(out / "forecast-meta.json", dumps(forecast_meta or build_forecast_meta(None, None, meta["generatedAt"])))
    if accuracy and (accuracy.get("filledTests") or accuracy.get("heldOut")):
        write_file(out / "accuracy.json", dumps(accuracy))
    elif (out / "accuracy.json").exists():
        print("accuracy.json left as it was: no backtest figures (backtest.json missing or empty)", file=sys.stderr)
    else:
        write_file(out / "accuracy.json", dumps(build_accuracy(None)))
    write_file(out / "highlights.json", dumps(highlights or {"term": meta["currentTerm"], "window": "", "runs": 0,
                                                              "byWindow": {}}))


def validate(out: Path, rows: list[dict], current_term: str) -> list[str]:
    """Re-read what was written and check it against the CSV. Returns problems."""
    problems = []
    total = 0
    now_pairs = set()
    for f in sorted((out / "courses").glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        if f.stem != doc["code"]:
            problems.append(f"{f.name}: code mismatch {doc['code']!r}")
        total += len(doc["history"])
        for h in doc["history"]:
            if not (doc["code"] and h["term"] and h["window"]):
                problems.append(f"{f.name}: history row missing code/term/window")
        for s in doc["sectionsNow"]:
            now_pairs.add((doc["code"], s["section"]))
    if total != len(rows):
        problems.append(f"history rows {total} != CSV rows {len(rows)}")
    for r in rows:
        if not (r["course_code"].strip() and r["term"].strip() and r["window"].strip()):
            problems.append("CSV row missing course_code/term/window")
            break
    expected = {(r["course_code"], r["section"]) for r in rows if r["term"] == current_term}
    missing = expected - now_pairs
    if missing:
        problems.append(f"{len(missing)} current-term (course, section) missing from sectionsNow, e.g. {sorted(missing)[:3]}")
    extra = now_pairs - expected
    if extra:
        problems.append(f"{len(extra)} sectionsNow entries not in CSV current term, e.g. {sorted(extra)[:3]}")
    return problems


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--window-config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--params", type=Path, default=DEFAULT_PARAMS,
                    help="forecast params JSON (skipped if missing or forecasts_ok is false)")
    ap.add_argument("--backtest", type=Path, default=DEFAULT_BACKTEST)
    ap.add_argument("--backtest-corrected", type=Path, default=DEFAULT_BACKTEST_CORRECTED,
                    help="backtest of the corrected model (model/forecast/correction.py backtest); the correction needs it")
    ap.add_argument("--no-correction", action="store_true", help="build with the fitted params as they are (model version 'fit')")
    ap.add_argument("--highlight-runs", type=int, default=HIGHLIGHT_RUNS)
    ap.add_argument("--availability", type=Path, default=DEFAULT_AVAILABILITY,
                    help="merged live-seat CSV (default: `availability` in data/current.json); missing -> built without live seats")
    ap.add_argument("--current-term", help="override currentTerm from the window config")
    ap.add_argument("--browse-from-term", help="leave terms before this out of browse.json (default: all terms)")
    ap.add_argument("--generated-at", help="ISO timestamp to stamp instead of now (tests)")
    ap.add_argument("--now", help="ISO time (naive = SGT) used only to choose the default window; default: real now")
    args = ap.parse_args(argv)

    try:
        cfg = load_window_config(args.window_config, args.current_term, _parse_when(args.now) if args.now else None)
        term = cfg["currentTerm"]
        rows = load_rows(args.csv)
        index, docs = build(rows, term)
        live, seats_summary = load_live_seats(args.availability, term)
        attached_live = attach_live_seats(docs, live)
        deltas, delta_times = load_seat_deltas(args.availability, term, seats_summary["window"]) if seats_summary else ({}, None)
        # history only alongside deltas that passed the same-window check
        history = load_seat_history(args.availability, term, seats_summary["window"]) if delta_times else {}
        attached_deltas = attach_seat_deltas(docs, deltas, history, (delta_times or {}).get("openScanAt"))
        attached_exams = attach_exams(docs, args.csv.parent / "schedule-html", term)
        t_drops = datetime.now().timestamp()
        attached_drops = attach_drops(docs, rows, cfg["window"], cfg["schedule"], term)
        t_drops = datetime.now().timestamp() - t_drops
        generated = args.generated_at or datetime.now(SGT).isoformat(timespec="seconds")
        meta = {
            "generatedAt": generated,
            "sourceRows": len(rows),
            "sourceTerms": len({r["term"] for r in rows}),
            "currentTerm": term,
            "latestResultsWindow": latest_results_window(rows, term),
            "resultsPartial": load_results_partial(args.csv),
            "window": cfg["window"],
            "schedule": cfg["schedule"],
        }
        if seats_summary:
            meta["seats"] = seats_summary
            if scan_at := scan_time(Path(args.availability).parent):
                meta["seats"]["scanAt"] = scan_at
            if delta_times:
                meta["seats"].update({k: v for k, v in delta_times.items() if v})
        params = load_forecast_params(args.params, term)
        backtest = json.loads(args.backtest.read_text(encoding="utf-8")) if params and args.backtest.exists() else None
        if params and not backtest:
            print(f"forecasts skipped: no backtest at {args.backtest}", file=sys.stderr)
            params = None
        accuracy_bt = backtest if backtest else (json.loads(args.backtest.read_text(encoding="utf-8")) if args.backtest.exists() else None)
        model_version = "fit"
        if params and backtest and CORRECTION_ENABLED and not args.no_correction and os.environ.get("BIDWISE_CORRECTION", "1") != "0":
            params, backtest, model_version = maybe_correct(params, backtest, rows, term, docs, cfg["window"], args.backtest_corrected)
            if model_version != "fit":
                accuracy_bt = backtest
        attached = attach_forecasts(docs, params) if params else 0
        fmeta = build_forecast_meta(params, backtest, generated, model_version)
        if params:
            fmeta.update(load_refit_note(args.params.parent / "fit-meta.json"))
        highlights = build_highlights(docs, params, cfg["window"], runs=args.highlight_runs)
        browse = build_browse(rows, index, args.browse_from_term)
        write_outputs(args.out, meta, index, docs, fmeta, highlights, browse, build_accuracy(accuracy_bt, model_version))
        problems = validate(args.out, rows, term)
    except BuildError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        return 1

    files = sorted((args.out / "courses").glob("*.json"), key=lambda p: p.stat().st_size, reverse=True)
    sizes = {p: p.stat().st_size for p in files}
    total = sum(sizes.values()) + (args.out / "index.json").stat().st_size + (args.out / "meta.json").stat().st_size
    print(f"rows {len(rows)}, courses {len(docs)}, latestResultsWindow {meta['latestResultsWindow']!r}")
    print(f"live seats: {attached_live} sections" + (f" ({meta['seats']['live']} live, {meta['seats']['approx']} approx)" if "seats" in meta else " (none)"))
    print(f"seat deltas: {attached_deltas} sections" + f", history on {sum('history' in s['live'] for d in docs.values() for s in d['sectionsNow'] if s.get('live'))}")
    print(f"exam dates: {attached_exams} of {sum(len(d['sectionsNow']) for d in docs.values())} current sections")
    print(f"drop chance: {attached_drops} courses with a full section ({t_drops:.1f} s)")
    print(f"forecasts: {attached} sections, {len(fmeta['windows'])} windows, highlights for "
          f"{len(highlights['byWindow'])} windows (open: {highlights['window']})")
    shard_sizes = [(args.out / n).stat().st_size for n in browse[1]]
    print(f"browse: {sum(len(d['rows']) for d in browse[1].values())} rows in {len(shard_sizes)} term files, "
          f"manifest {(args.out / 'browse.json').stat().st_size / 1e3:.0f} KB, shards {sum(shard_sizes) / 1e6:.2f} MB total, "
          f"largest {max(shard_sizes, default=0) / 1e3:.0f} KB")
    print(f"total {total / 1e6:.2f} MB, index.json {(args.out / 'index.json').stat().st_size / 1e3:.1f} KB")
    print("largest course files:")
    for p in files[:5]:
        print(f"  {p.name} {sizes[p] / 1e3:.1f} KB")
    if problems:
        for p in problems:
            print(f"VALIDATION FAIL: {p}", file=sys.stderr)
        return 1
    print("validation ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
