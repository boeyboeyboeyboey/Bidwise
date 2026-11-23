#!/usr/bin/env python3
"""Per-course outline data for the public site, built from the private outline store.

Reads data/course_outlines/index.json (docs and sections), extracted/<sha>.json, extracted/<sha>.check.json and
files/<sha>.pdf. Each site section is joined to its outline by current term and class number only.

Writes <out>/<SITECODE>.json for each course with at least one outline, and copies each referenced PDF to
<public>/<sha>.pdf, which the site serves at /outlines/<sha>.pdf. Missing index or term: writes nothing, exit 0,
so the site builds without outlines.

Usage (from repo/): python model/build_outline_data.py [--site-data DIR] [--out DIR] [--public DIR] [--outlines DIR]
"""
import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FINAL_FIELDS = ("exists", "weight_pct", "duration", "book", "cheat_sheet", "calculator", "online", "take_home")
MIDTERM_FIELDS = ("exists", "week_label", "weight_pct")


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def optional_json(path, problems):
    """The parsed file, or None when it is missing or unreadable (an unreadable file is noted in `problems`)."""
    if not path.exists():
        return None
    try:
        return read_json(path)
    except (OSError, ValueError) as e:
        problems.append(f"{path.name}: {type(e).__name__}")
        return None


def pick(d, keys):
    return {k: d.get(k) for k in keys} if isinstance(d, dict) else None


PERCENT_NOTE = re.compile(r"\([^()]*%[^()]*\)")


def clean_topic(text):
    """A topic with parenthesised percentage annotations removed, spaces collapsed. Empty string when nothing is left."""
    return re.sub(r"\s+", " ", PERCENT_NOTE.sub("", text)).strip()


def summarise(extracted, check, review=None):
    """The site's subset of one extraction. Only for a check with status ok; flagged, invalid or missing gives None.

    `review` is the optional <sha>.review.json. weights_reliable false sets weights_note; weekly_reliable false empties weekly.
    """
    if not isinstance(extracted, dict) or not isinstance(check, dict) or check.get("status") != "ok":
        return None
    review = review if isinstance(review, dict) else {}
    grading = [pick(g, ("component", "weight_pct", "group")) for g in extracted.get("grading") or [] if isinstance(g, dict)]
    weekly = []
    if review.get("weekly_reliable") is not False:
        for w in extracted.get("weekly") or []:
            if not isinstance(w, dict):
                continue
            row = pick(w, ("week_label", "kind", "topics"))
            topics = w.get("topics")
            if isinstance(topics, list):
                row["topics"] = [c for c in (clean_topic(t) for t in topics if isinstance(t, str)) if c]
            weekly.append(row)
    textbooks = extracted.get("textbooks")
    return {
        "grading": grading,
        "weights_note": review.get("weights_reliable") is False,
        "final_exam": pick(extracted.get("final_exam"), FINAL_FIELDS),
        "midterm": pick(extracted.get("midterm"), MIDTERM_FIELDS),
        "weekly": weekly,
        "extra_credit": extracted.get("extra_credit"),
        "textbooks": [t for t in textbooks if isinstance(t, str)] if isinstance(textbooks, list) else None,
    }


def build(outline_dir, site_data, out_dir, public_dir):
    """Write the outline data. Returns a stats dict, or {"skipped": reason} when there is nothing to build from."""
    outline_dir, site_data = Path(outline_dir), Path(site_data)
    out_dir, public_dir = Path(out_dir), Path(public_dir)
    index_path = outline_dir / "index.json"
    if not index_path.exists():
        return {"skipped": f"no {index_path.name} in {outline_dir}"}
    meta_path = site_data / "meta.json"
    if not meta_path.exists():
        return {"skipped": f"no {meta_path.name} in {site_data}"}
    term = read_json(meta_path).get("currentTerm")
    if not isinstance(term, str) or not term:
        return {"skipped": "meta.json has no currentTerm"}

    index = read_json(index_path)
    docs = index.get("docs") or {}
    sections_by_class = (index.get("sections") or {}).get(term) or {}
    extracted_dir, files_dir = outline_dir / "extracted", outline_dir / "files"
    problems = []

    # Join each site section to its outline by class number. Only docs with status ok count.
    courses = {}  # SITECODE -> section rows
    referenced = set()
    for path in sorted((site_data / "courses").glob("*.json")):
        course = read_json(path)
        rows = []
        for s in course.get("sectionsNow") or []:
            class_number = str(s.get("classNumber") or "").strip()
            entry = sections_by_class.get(class_number) if class_number else None
            doc = docs.get(entry.get("doc_id"), {}) if isinstance(entry, dict) else {}
            sha = doc.get("sha256") if doc.get("status") == "ok" else None
            rows.append({"section": s.get("section"), "classNumber": class_number,
                         "instructor": s.get("instructor"), "sha": sha or None})
            if sha:
                referenced.add(sha)
        if any(r["sha"] for r in rows):
            courses[path.stem] = sorted(rows, key=lambda r: (str(r["section"]), r["classNumber"]))

    # One doc entry per referenced sha. The PDF link is null when the PDF file is missing.
    doc_out = {}
    no_pdf = 0
    for sha in sorted(referenced):
        summary = summarise(optional_json(extracted_dir / f"{sha}.json", problems),
                            optional_json(extracted_dir / f"{sha}.check.json", problems),
                            optional_json(extracted_dir / f"{sha}.review.json", problems))
        has_pdf = (files_dir / f"{sha}.pdf").exists()
        no_pdf += not has_pdf
        doc_out[sha] = {"summary": summary, "pdf": f"/outlines/{sha}.pdf" if has_pdf else None}

    # Public PDFs: copy the referenced ones, remove the rest.
    public_dir.mkdir(parents=True, exist_ok=True)
    for sha in referenced:
        if doc_out[sha]["pdf"]:
            shutil.copyfile(files_dir / f"{sha}.pdf", public_dir / f"{sha}.pdf")
    for stale in public_dir.glob("*.pdf"):
        if stale.stem not in referenced:
            stale.unlink()

    # Course files: rebuild the folder, so a course that lost its outline does not keep a stale file.
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("*.json"):
        old.unlink()
    for code, rows in sorted(courses.items()):
        used = {r["sha"] for r in rows if r["sha"]}
        data = {
            "term": term,
            "sections": rows,
            "docs": {sha: doc_out[sha] for sha in sorted(used)},
        }
        with open(out_dir / f"{code}.json", "w", encoding="utf-8") as f:
            f.write(json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n")

    return {
        "courses": len(courses),
        "sections": sum(1 for rows in courses.values() for r in rows if r["sha"]),
        "docs": len(doc_out),
        "docs_with_summary": sum(1 for d in doc_out.values() if d["summary"]),
        "docs_without_pdf": no_pdf,
        "problems": problems,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build per-course outline data for the site (see module docstring).")
    ap.add_argument("--outlines", default=str(ROOT / "data/course_outlines"), help="outline store")
    ap.add_argument("--site-data", default=str(ROOT / "site/src/data/real"), help="site data dir (meta.json, courses/)")
    ap.add_argument("--out", default=None, help="course JSON dir (default: <site-data>/outlines)")
    ap.add_argument("--public", default=str(ROOT / "site/public/outlines"), help="dir for the copied PDFs")
    args = ap.parse_args(argv)
    os.umask(0o077)  # private data: dirs 0700, files 0600
    site_data = Path(args.site_data)
    out = Path(args.out) if args.out else site_data / "outlines"
    stats = build(args.outlines, site_data, out, args.public)
    if "skipped" in stats:
        print(f"outlines: nothing written ({stats['skipped']})")
        return 0
    print(f"outlines: courses {stats['courses']}, sections with outline {stats['sections']}, "
          f"docs {stats['docs']}, docs with summary {stats['docs_with_summary']}, "
          f"docs without PDF {stats['docs_without_pdf']}")
    for p in stats["problems"]:
        print(f"outlines: warning: {p}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
