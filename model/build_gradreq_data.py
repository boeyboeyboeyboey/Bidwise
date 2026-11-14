#!/usr/bin/env python3
"""Export the private graduation-requirements dataset as small public JSON files for the site.

Reads data/graduation_requirements/*.csv (private, never published) and writes, under
site/src/data/real/gradreq/:
  index.json        picker data only: school -> degree -> majors/tracks -> intake -> view id,
                    plus second majors per home degree and intake
  <view_id>.json    one requirement view, loaded on demand
  requisites.json   current prerequisite / antirequisite rules for the courses in those views
Stdlib only.  Run from anywhere:  python3 model/build_gradreq_data.py [--data DIR] [--out DIR] [--site-data DIR]

SCOPE
  Programmes without `superseded_by`; groups with view_status = authoritative only.
  Degree, major and track views of the schools in SCHOOLS (LKCSB, SCIS, SoA, SoE, SoSS, YPHSL; kind degree / major /
  track), plus second_major views of any offering school whose group home_degree is BBM or a SCIS degree.  A view is kept when it applies to at least one
  intake in AY2022/23..AY2026/27.  The view's intakeFrom / intakeTo are clipped to that window; openEnded is true
  when a group has no end intake (an intake newer than the last handbook inherits the rules).

HOW THE GROUP ROLES RELATE (requirement_groups.cu_role; checked against the data, see the build summary)
  additive     A CU allocation that counts towards the view total.  The additive groups of one view sum to
               totalCus (e.g. p4-lkcsb-bbm-ay2025: 6+4+2+11+6+7 = 36).
  component    A sub-allocation INSIDE one additive group, never added on top.  The parent is explicit, but not in a
               column: requirement_groups.rule_expression is `component_of:<group_id>` on every component row.  It is
               exported as `parent`.  The components of a parent sum to the parent's cus (Capabilities 6 = Managing 2
               + Modes 1 + Numeracy 1 + Writing 1 + Internship 1).  The parent can sit after its components in the
               file (scis-cs-ay2026-onward), so never infer the parent from row order.  A parent that has
               components holds no course list itself (missingList stays false).
  overlay      A policy, candidate set or extra check (Digital Technology, Global Exposure, optional baskets).  Not
               summed, may double-count with additive groups, often cus 0 or blank.
  alternative  A separately sourced route that replaces other requirements (e.g. "No Major").  Not summed.
  Roles are exported unchanged and groups are never merged across roles.  The only relation derived is `parent`.

MEMBERS
  cls  rule (required, listed_option, unresolved_title) | tagged (area_tagged) | hint (tagged_candidate,
       published_example).  mandatory comes from the dataset flag.
  code is the key the site uses (courses.boss_code, so dotted catalogue spellings and the two catalogue codes that
  share a BOSS code collapse to one).  A course with no key on the site keeps its best code and offeredKey false.
  Blank-code rows: rule-class ones are kept with code null and their title, blank-code hints are dropped.
  Dedupe is per (group, code), keeping the strongest class: rule > tagged > hint.
  intakes (tagged members only): the intakes named in the BOSS area evidence note, limited to the view's window;
  omitted when the member applies to every intake of the view.

PATHWAYS  An `alternative` group whose rule_expression reads `component_of:<parent> | pathway:<key>` is one route of an
  either-or choice (BSocSc majors, the two Economics pathways).  Those groups are taken out of the degree view and
  exported as one extra major view per key (id `<degree view id>-<key>`, kind major in the index, programme id
  `<degree id>-pathway-<key>`), with the role changed to additive, so the site's Major dropdown picks them like a
  BBM major.  The parent group stays in the degree view as an empty placeholder and is not flagged missingList.

ALIASES  A blank-code member whose normalised title appears in title_aliases.csv for exactly one course code gets that
  code (an ambiguous title, with two codes, stays title-only).

missingList: a basket / specific group with CUs that holds no rule or tagged member for any intake of the view
  (parents of components excluded).  missingIntakes lists the intakes lacking one when only some are covered.

basis: intake_basis shortened to stated (handbook_stated, workbook_stated) | inferred | newer, so no output says "handbook";
  the same word is dropped from group names and shortened to "hb" in group ids.

PRIVACY: only the fields above are written.  No notes, rule text, source ids, files, URLs or course status.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data/graduation_requirements"
DEFAULT_OUT = ROOT / "site/src/data/real/gradreq"
DEFAULT_SITE_DATA = ROOT / "site/src/data/real"

GENERATOR = "build_gradreq_data"
WIN_LO, WIN_HI = 2022, 2026  # intake AY2022/23 .. AY2026/27
SCHOOLS = {
    "LKCSB": "Lee Kong Chian School of Business",
    "SCIS": "School of Computing and Information Systems",
    "SoA": "School of Accountancy",
    "SoE": "School of Economics",
    "SoSS": "School of Social Sciences",
    "YPHSL": "Yong Pung How School of Law",
}
BBM_ID = "lkcsb-bbm"
SCIS_DEGREES = {"cs": "scis-cs", "is": "scis-is", "cl": "scis-cl", "se": "scis-se-wsd"}
# second-major workbook (double_count_rules.scope) per offering school
WORKBOOK = {"LKCSB": "LKCSB", "SCIS": "SCIS", "SoA": "SOA", "SoE": "SOE", "YPHSL": "SOL", "SoSS": "SOSS"}
RANK = {"required": 7, "listed_option": 6, "unresolved_title": 5, "area_tagged": 4, "tagged_candidate": 3,
        "published_example": 2}
CLS = {"required": "rule", "listed_option": "rule", "unresolved_title": "rule", "area_tagged": "tagged",
       "tagged_candidate": "hint", "published_example": "hint"}
CLS_ORDER = {"rule": 0, "tagged": 1, "hint": 2}
# display names of pathway keys (requirement_groups.rule_expression `pathway:<key>`); an unknown key is title-cased
PATHWAY_NAMES = {
    "posc": "Political Science",
    "psych": "Psychology",
    "soc": "Sociology",
    "ple": "Politics, Law and Economics (PLE)",
    "ple-extra-calculus": "Politics, Law and Economics (PLE), not exempt from Calculus",
    "international-economics": "International Economics",
    "trade-and-macro": "Trade and Macro",
}
PATHWAY_EXPR = re.compile(r"component_of:(\S+)\s*\|\s*pathway:(\S+)")
SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


# ---------------------------------------------------------------- small helpers

def ay_label(year: int) -> str:
    return f"AY{year}/{(year + 1) % 100:02d}"


def ay_year(label: str):
    m = re.fullmatch(r"AY(\d{4})/\d{2}", (label or "").strip())
    return int(m.group(1)) if m else None


def num(text):
    """'1.0' -> 1, '0.5' -> 0.5, '' -> None."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        v = float(text)
    except ValueError:
        return None
    return int(v) if v == int(v) else v


def norm_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


BASIS = {"handbook_stated": "stated", "workbook_stated": "stated", "handbook_inferred": "inferred",
         "newer_source": "newer"}


def public_id(text: str) -> str:
    """Group ids keep their shape; the word 'handbook' (a source reference) is shortened so no file says it."""
    return re.sub(r"handbook", "hb", text, flags=re.I)


def public_name(text: str) -> str:
    out = re.sub(r"\bhandbook\b[\s:,-]*", "", text, flags=re.I).strip()
    return out[:1].upper() + out[1:]


def read_csv(path: Path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- intakes

def group_window(g) -> set:
    """Intake years (ints) a group applies to, clipped to the window.  A blank end is open."""
    lo = ay_year(g.get("intake_from", ""))
    hi = ay_year(g.get("intake_to", ""))
    lo = WIN_LO if lo is None else max(lo, WIN_LO)
    hi = WIN_HI if hi is None else min(hi, WIN_HI)
    return set(range(lo, hi + 1))


def parse_area_intakes(notes: str) -> set:
    """Intake years named in a BOSS area evidence note ("BOSS area evidence by intake [AY2025/26: ... | AY2026/27: ...]")."""
    m = re.search(r"BOSS area evidence by intake \[(.*?)\]\.", notes or "")
    if not m:
        return set()
    return {int(y) for y in re.findall(r"AY(\d{4})/\d{2}:", m.group(1))}


# ---------------------------------------------------------------- course key resolution

def unique_aliases(rows) -> dict:
    """title_aliases rows -> {normalised title: code}; a title that names two different codes is left out."""
    codes = defaultdict(set)
    for r in rows:
        code = (r.get("course_code") or "").strip()
        if code and (r.get("title") or "").strip():
            codes[norm_title(r["title"])].add(code)
    return {t: next(iter(c)) for t, c in codes.items() if len(c) == 1}


class Resolver:
    """Maps any catalogue / BOSS-form code to the site's course key."""

    def __init__(self, courses, site_keys, aliases=None):
        self.by_code = {c["course_code"]: c for c in courses}
        self.site_keys = set(site_keys)
        self.aliases = unique_aliases(aliases or [])

    def alias_code(self, title: str):
        """The one course code title_aliases.csv gives for this title (wording-normalised), else None."""
        return self.aliases.get(norm_title(title))

    def resolve(self, code: str):
        """-> (key, catalogue_row_or_None).  The key is courses.boss_code when present (that is what shared
        and dotted codes collapse on); a course without one follows a same-title `other_codes` alias; otherwise
        the code itself (dots dropped when that spelling is a site key)."""
        code = (code or "").strip()
        row = self.by_code.get(code)
        if row is not None:
            if row.get("boss_code"):
                return row["boss_code"], row
            for alias in filter(None, (a.strip() for a in row.get("other_codes", "").split(";"))):
                arow = self.by_code.get(alias)
                if arow and arow.get("boss_code") and norm_title(arow["course_title"]) == norm_title(row["course_title"]):
                    return arow["boss_code"], arow
            return code, row
        undotted = code.replace(".", "")
        return (undotted if undotted in self.site_keys else code), None

    def title_and_cus(self, key, row, fallback_title, fallback_cus):
        """Catalogue title / CUs; for a shared key prefer the row whose own code is the key."""
        best = self.by_code.get(key) or row
        title = (best or {}).get("course_title") or fallback_title or ""
        cus = num((best or {}).get("cus", "")) if best else None
        if cus is None:
            cus = num(fallback_cus)
        return title, cus


# ---------------------------------------------------------------- members

def build_members(rows, resolver, view_set, stats=None):
    """Members of one group from its group_courses rows -> (members, choice_sets).

    view_set: the intake years (ints) of the whole view; tagged members are limited to it.
    """
    best = {}  # dedupe key -> record
    for r in rows:
        status = r["membership_status"]
        if status not in RANK:
            continue
        cls = CLS[status]
        code = (r.get("course_code") or "").strip()
        if not code:
            code = resolver.alias_code(r.get("course_title", "")) or ""
            if code and stats is not None:
                stats["alias_coded"] += 1
        if code:
            key, crow = resolver.resolve(code)
            dkey = ("k", key)
        else:
            if cls != "rule":
                if stats is not None:
                    stats["blank_hint_dropped"] += 1
                continue
            key, crow = None, None
            dkey = ("t", norm_title(r.get("course_title", "")))
        intakes = None
        if cls == "tagged":
            intakes = parse_area_intakes(r.get("notes", "")) & view_set
            if not intakes:
                if stats is not None:
                    stats["tagged_no_intake"] += 1
                continue
        rec = best.get(dkey)
        if rec is None:
            best[dkey] = {"key": key, "crow": crow, "r": r, "rank": RANK[status], "cls": cls,
                          "mandatory": r.get("mandatory") == "true", "intakes": intakes,
                          "choice": (r.get("choice_set") or "").strip()}
            continue
        if stats is not None:
            stats["dups"] += 1
            if code and (r["course_code"].strip() or code) != (rec["r"]["course_code"].strip() or code):
                stats["dups_alias"] += 1
        rec["mandatory"] = rec["mandatory"] or r.get("mandatory") == "true"
        if RANK[status] > rec["rank"]:
            keep_choice = rec["choice"]
            rec.update(r=r, rank=RANK[status], cls=cls, intakes=intakes)
            rec["choice"] = (r.get("choice_set") or "").strip() or keep_choice
        elif cls == "tagged" and rec["cls"] == "tagged":
            rec["intakes"] = rec["intakes"] | intakes
        if not rec["choice"]:
            rec["choice"] = (r.get("choice_set") or "").strip()

    recs = sorted(best.values(), key=lambda x: (CLS_ORDER[x["cls"]], not x["mandatory"], x["key"] is None,
                                                 x["key"] or "", norm_title(x["r"].get("course_title", ""))))
    members, sets = [], defaultdict(list)
    for rec in recs:
        r = rec["r"]
        if rec["key"] is None:
            title, cus = r.get("course_title", ""), num(r.get("course_cus", ""))
        else:
            title, cus = resolver.title_and_cus(rec["key"], rec["crow"], r.get("course_title", ""), r.get("course_cus", ""))
        m = {"code": rec["key"], "title": title, "cus": cus, "cls": rec["cls"]}
        if rec["mandatory"]:
            m["mandatory"] = True
        if rec["intakes"] and rec["intakes"] != view_set:
            m["intakes"] = [ay_label(y) for y in sorted(rec["intakes"])]
        if rec["key"] is not None and rec["key"] not in resolver.site_keys:
            m["offeredKey"] = False
        if rec["cls"] == "rule" and rec["choice"]:
            sets[rec["choice"]].append(len(members))
        members.append(m)
    choice_sets = [{"id": cid, "members": idx} for cid, idx in sets.items() if len(idx) >= 2]
    return members, choice_sets


# ---------------------------------------------------------------- views

def home_degree(label: str):
    """Workbook home-degree tab label -> (degree programme id, variant) or (None, None)."""
    l = (label or "").strip().lower()
    if l == "bbm":
        return BBM_ID, None
    if l.startswith("bsc (cs)"):
        return SCIS_DEGREES["cs"], None
    if l.startswith("bsc (c&l)"):
        return SCIS_DEGREES["cl"], None
    if l.startswith("bsc (se)"):
        return SCIS_DEGREES["se"], None
    if l.startswith("bsc (is") or l.startswith("bsc (smt"):
        m = re.search(r"(?:—|:)\s*(.+)$", label)
        variant = m.group(1).replace(" Mjr", "").strip() if m else None
        if l.startswith("bsc (smt"):
            variant = "SMT"
        elif l.startswith("bsc (is/smt"):
            variant = "IS/SMT"
        return SCIS_DEGREES["is"], variant
    return None, None


def home_short(degree_id: str, variant) -> str:
    base = {BBM_ID: "BBM", "scis-cs": "BSc (CS)", "scis-cl": "BSc (C&L)", "scis-se-wsd": "BSc (SE)",
            "scis-is": "BSc (IS)"}[degree_id]
    return f"{base} {variant}" if variant else base


def prog_name(p) -> str:
    kind = p["kind"]
    if kind == "degree":
        return p["degree_name"] or p["major_or_track"]
    if kind == "second_major":
        return p["major_or_track"] if p["degree_name"] in ("", "Second Major") else (p["degree_name"] or p["major_or_track"])
    # major / track
    return p["major_or_track"] or p["degree_name"]


def norm_node_name(name: str) -> str:
    """'Information Systems: Business Analytics' and 'Business Analytics' are one track."""
    return norm_title(name.split(":", 1)[1] if ":" in name else name)


def scis_degree_of(p):
    m = re.match(r"^scis-(?:2019-)?(cs|is|cl|se)\b", p["programme_id"])
    return SCIS_DEGREES[m.group(1)] if m else None


def min_not_shared(rules, school: str, window: set):
    """Numeric min_cu_not_shared of the second-major workbook for this offering school (scope-level)."""
    wb = WORKBOOK.get(school)
    vals = set()
    for d in rules:
        if d["rule"] != "min_unshared_second_major_with_first_major" or not (d.get("min_cu_not_shared") or "").strip():
            continue
        m = re.match(r"workbook:SecondMajor(\w+?)\.\w+(?:\|intake_from=(AY\d{4}/\d{2}))?", d["scope"])
        if not m or m.group(1) != wb:
            continue
        start = ay_year(m.group(2) or "")
        if start is not None and min(window) < start:
            continue
        vals.add(num(d["min_cu_not_shared"]))
    return vals.pop() if len(vals) == 1 else None


def build_views(data, resolver, stats):
    """-> list of view dicts (with private bookkeeping keys starting with '_')."""
    programmes = {p["programme_id"]: p for p in data["programmes"]}
    live = {pid for pid, p in programmes.items() if not p["superseded_by"]}
    by_view = defaultdict(list)
    for g in data["groups"]:
        if g["view_status"] == "authoritative" and g["programme_id"] in live:
            by_view[g["curriculum_view_id"]].append(g)
    members_by_group = defaultdict(list)
    wanted = {g["group_id"] for gs in by_view.values() for g in gs}
    for r in data["group_courses"]:
        if r["group_id"] in wanted:
            members_by_group[r["group_id"]].append(r)

    views = []
    for vid, gs in by_view.items():
        if not SAFE_ID.match(vid):
            raise ValueError(f"unsafe view id {vid!r}")
        primary_id = Counter(g["programme_id"] for g in gs).most_common(1)[0][0]
        p = programmes[primary_id]
        kind, school = p["kind"], p["school"]
        home_id = home_var = home_label = None
        if kind == "second_major":
            homes = Counter(g["home_degree"] for g in gs)
            home_label = homes.most_common(1)[0][0]
            home_id, home_var = home_degree(home_label)
            if home_id is None:
                continue
        elif kind in ("degree", "major", "track"):
            if school not in SCHOOLS:
                continue
        else:
            continue
        window = set()
        for g in gs:
            window |= group_window(g)
        if not window:
            stats["views_out_of_window"] += 1
            continue
        open_ended = any(not g["intake_to"].strip() for g in gs)
        ids = {g["group_id"] for g in gs}
        parents = {}
        for g in gs:
            m = re.fullmatch(r"component_of:(\S+)", g["rule_expression"].strip())
            if g["cu_role"] == "component" and m and m.group(1) in ids:
                parents[g["group_id"]] = m.group(1)
        parent_ids = set(parents.values())
        # pathway groups: alternative routes of one either-or choice, exported as extra major views below
        pathway_of = {}
        for g in gs:
            m = PATHWAY_EXPR.fullmatch(g["rule_expression"].strip())
            if g["cu_role"] == "alternative" and m and m.group(1) in ids:
                pathway_of[g["group_id"]] = (m.group(1), m.group(2))
        pathway_parents = {par for par, _ in pathway_of.values()}

        groups = []
        pathways = defaultdict(list)  # key -> [(group dict, group window, group row)]
        for g in gs:
            members, csets = build_members(members_by_group.get(g["group_id"], []), resolver, window, stats)
            gw = group_window(g)
            has_list = [m for m in members if m["cls"] in ("rule", "tagged")]
            covered = set()
            for m in has_list:
                if m["cls"] == "rule":
                    covered |= gw
                else:
                    covered |= {ay_year(a) for a in m.get("intakes", [])} or gw
            cus = num(g["cus_required"])
            gtype = g["group_type"]
            if gtype == "basket" and g["basket_rule"].strip().startswith("any_course:SMU") and not members:
                gtype = "free_elective"  # any SMU course: the site counts leftover courses here, no list needed
            needs = (gtype in ("basket", "specific") and g["group_id"] not in parent_ids | pathway_parents
                     and ((cus or 0) > 0 or (gtype == "basket" and bool(g["basket_rule"].strip()))))
            missing_all = bool(needs and not (covered & window))
            missing_some = sorted(window - covered) if needs and not missing_all else []
            out = {"id": public_id(g["group_id"]), "name": public_name(g["group_name"]), "type": gtype, "role": g["cu_role"],
                   "cus": cus, "minCourses": num(g["min_courses"])}
            if g["group_id"] in parents:
                out["parent"] = public_id(parents[g["group_id"]])
            if gw != window:
                out["intakes"] = [ay_label(y) for y in sorted(gw)]
                stats["groups_narrower"] += 1
            if csets:
                out["choiceSets"] = csets
            out["missingList"] = missing_all
            if missing_some and not missing_all:
                out["missingIntakes"] = [ay_label(y) for y in missing_some]
            out["members"] = members
            if g["group_id"] in pathway_of:
                pathways[pathway_of[g["group_id"]][1]].append((out, gw, g))
            else:
                groups.append(out)

        totals = Counter(num(g["view_total_cus"]) for g in gs if num(g["view_total_cus"]) is not None)
        total = totals.most_common(1)[0][0] if totals else num(p["total_cus"])
        name = prog_name(p)
        label = name
        if kind == "second_major":
            label = f"{name} second major ({home_short(home_id, home_var)})"
        view = {"id": vid, "label": label, "intakeFrom": ay_label(min(window)), "intakeTo": ay_label(max(window)),
                "openEnded": open_ended, "totalCus": total, "basis": BASIS.get(p["intake_basis"])}
        if kind == "second_major":
            view["homeDegree"] = home_id
            if home_var:
                view["homeVariant"] = home_var
            mns = min_not_shared(data["double_count_rules"], school, window)
            if mns is not None:
                view["minNotShared"] = mns
        view["groups"] = groups
        view["_meta"] = {"programme": p, "kind": kind, "school": school, "window": window, "home": home_id,
                         "variant": home_var, "name": name}
        views.append(view)
        for key, items in pathways.items():
            views.append(pathway_view(view, key, items))
    return views


def pathway_view(degree_view, key, items):
    """One route of an either-or choice as a major view: its groups become additive, the total is their sum."""
    meta = degree_view["_meta"]
    window = set()
    for _, gw, _ in items:
        window |= gw
    groups = []
    for out, gw, _ in items:
        g = {k: v for k, v in out.items() if k != "parent"}
        g["role"] = "additive"
        if gw == window:
            g.pop("intakes", None)  # `out` carries intakes only when narrower than the degree view; here narrower than the pathway
        groups.append(g)
    name = PATHWAY_NAMES.get(key) or key.replace("-", " ").title()
    vid = f"{degree_view['id']}-{key}"
    if not SAFE_ID.match(vid):
        raise ValueError(f"unsafe view id {vid!r}")
    total = sum((g["cus"] or 0) for g in groups)
    open_ended = any(not g["intake_to"].strip() for _, _, g in items)
    view = {"id": vid, "label": name, "intakeFrom": ay_label(min(window)), "intakeTo": ay_label(max(window)),
            "openEnded": open_ended, "totalCus": int(total) if total == int(total) else total,
            "basis": degree_view["basis"], "groups": groups}
    base_id = meta["programme"]["base_programme_id"] or meta["programme"]["programme_id"]
    view["_meta"] = {"programme": meta["programme"], "kind": "major", "school": meta["school"], "window": window,
                     "home": None, "variant": None, "name": name, "node_id": f"{base_id}-pathway-{key}"}
    return view


# ---------------------------------------------------------------- index

def school_degrees(programmes) -> dict:
    """school -> ids of its (non-superseded, canonical) degree programmes, e.g. SoA -> ['soa-bacc']."""
    out = defaultdict(list)
    for pid, p in programmes.items():
        if p["kind"] == "degree" and not p["superseded_by"] and not p["base_programme_id"]:
            out[p["school"]].append(pid)
    return out


def degree_of(p, school, school_degs):
    """Programme id of the degree node a view hangs under, or None.  LKCSB has the one BBM node, SCIS derives the
    degree from the programme id; any other school uses its degree programme (the only one, else the one whose id
    prefixes the programme's base id)."""
    if school == "LKCSB":
        return BBM_ID
    if school == "SCIS":
        return scis_degree_of(p)
    cands = school_degs.get(school, [])
    if len(cands) == 1:
        return cands[0]
    pid = p["base_programme_id"] or p["programme_id"]
    best = [c for c in cands if pid == c or pid.startswith(c + "-")]
    return max(best, key=len) if best else None


def build_index(views, programmes):
    school_degs = school_degrees(programmes)

    def base(p):
        return programmes.get(p["base_programme_id"]) or p

    def put(node, view):
        meta = view["_meta"]
        for y in sorted(meta["window"]):
            lab = ay_label(y)
            cur = node["views"].get(lab)
            if cur and cur != view["id"]:
                node.setdefault("_conflicts", []).append((lab, cur, view["id"]))
                continue
            node["views"][lab] = view["id"]

    degrees = {}  # degree programme id -> node

    def degree_node(pid, school):
        if pid not in degrees:
            p = programmes.get(pid) or {"degree_name": pid}
            degrees[pid] = {"id": pid, "name": p.get("degree_name") or pid, "school": school, "views": {},
                            "majors": {}, "tracks": {}, "secondMajors": {}}
        return degrees[pid]

    conflicts, orphans = [], []
    for view in views:
        meta = view["_meta"]
        p, kind = meta["programme"], meta["kind"]
        if kind == "second_major":
            hid = meta["home"]
            hnode = degree_node(hid, "LKCSB" if hid == BBM_ID else "SCIS")
            key = (p["school"], norm_node_name(meta["name"]))
            sm = hnode["secondMajors"].setdefault(key, {"id": base(p)["programme_id"], "name": meta["name"],
                                                       "school": p["school"], "views": {}})
            for y in sorted(meta["window"]):
                lab = ay_label(y)
                entry = {"id": view["id"]}
                if meta["variant"]:
                    entry["variant"] = meta["variant"]
                sm["views"].setdefault(lab, []).append(entry)
            continue
        dpid = degree_of(p, meta["school"], school_degs)
        if dpid is None:
            orphans.append(view["id"])
            continue
        dnode = degree_node(dpid, meta["school"])
        if kind == "degree":
            put(dnode, view)
            if "_conflicts" in dnode:
                conflicts += dnode.pop("_conflicts")
            continue
        bp = base(p)
        nkey = norm_node_name(meta["name"])
        if kind == "major":
            node = dnode["majors"].setdefault(nkey, {"id": meta.get("node_id") or bp["programme_id"], "name": meta["name"], "views": {},
                                                     "tracks": {}, "_deg": bp["degree_name"]})
        else:
            parent_major = None
            if meta["school"] == "LKCSB":
                want = norm_title(re.sub(r"\s+major$", "", p["degree_name"].strip(), flags=re.I))
                for mk, mnode in dnode["majors"].items():
                    if norm_title(mnode["name"]) == want or mk == want:
                        parent_major = mnode
                        break
                if parent_major is None:
                    parent_major = dnode["majors"].setdefault(
                        want, {"id": None, "name": re.sub(r"\s+major$", "", p["degree_name"].strip(), flags=re.I),
                               "views": {}, "tracks": {}, "_deg": ""})
            container = parent_major["tracks"] if parent_major else dnode["tracks"]
            node = container.setdefault(nkey, {"id": bp["programme_id"], "name": meta["name"].split(": ", 1)[-1]
                                               if ": " in meta["name"] else meta["name"], "views": {}})
        put(node, view)
        if "_conflicts" in node:
            conflicts += node.pop("_conflicts")

    def fin(node):
        node.pop("_deg", None)
        node["views"] = dict(sorted(node["views"].items()))
        return node

    out_schools = []
    for sid, sname in SCHOOLS.items():
        ds = []
        for d in sorted((d for d in degrees.values() if d["school"] == sid), key=lambda d: d["name"]):
            majors = []
            for mn in sorted(d["majors"].values(), key=lambda n: n["name"]):
                fin(mn)
                mn["tracks"] = [fin(n) for n in sorted(mn["tracks"].values(), key=lambda n: n["name"])]
                if not mn["tracks"]:
                    del mn["tracks"]
                majors.append(mn)
            tracks = [fin(n) for n in sorted(d["tracks"].values(), key=lambda n: n["name"])]
            sms = sorted(d["secondMajors"].values(), key=lambda n: (n["name"], n["school"]))
            for sm in sms:
                sm["views"] = dict(sorted(sm["views"].items()))
            node = {"id": d["id"], "name": d["name"], "views": dict(sorted(d["views"].items()))}
            if majors:
                node["majors"] = majors
            if tracks:
                node["tracks"] = tracks
            if sms:
                node["secondMajors"] = sms
            ds.append(node)
        out_schools.append({"id": sid, "name": sname, "degrees": ds})
    index = {"generator": GENERATOR, "intakes": [ay_label(y) for y in range(WIN_LO, WIN_HI + 1)],
             "schools": out_schools}
    return index, conflicts, orphans


# ---------------------------------------------------------------- requisites

_TOKEN = re.compile(r"\s*(\(|\)|AND(?![\w])|OR(?![\w])|(?:COR-)?[A-Z]{2,5}\.?\d{3,4}[A-Z]?(?![\w.]))")


def parse_expression(expr: str):
    """'(A OR (B AND C))' -> ['or', 'A', ['and', 'B', 'C']]; a bare code -> 'A'.
    Anything beyond course codes, AND, OR and parentheses (grades, CU counts, CONDITION(n), UNRESOLVED...) -> None."""
    toks, pos = [], 0
    expr = expr.strip()
    while pos < len(expr):
        m = _TOKEN.match(expr, pos)
        if not m:
            return None
        toks.append(m.group(1))
        pos = m.end()
    if not toks:
        return None
    i = 0

    def group():
        nonlocal i
        items, op = [], None
        while i < len(toks):
            t = toks[i]
            if t == "(":
                i += 1
                node = group()
                if node is None or i >= len(toks) or toks[i] != ")":
                    return None
                i += 1
                items.append(node)
            elif t in ("AND", "OR"):
                if op not in (None, t) or not items:
                    return None
                op = t
                i += 1
                if i >= len(toks) or toks[i] in ("AND", "OR", ")"):
                    return None
                continue
            elif t == ")":
                break
            else:
                items.append(t)
                i += 1
            if i < len(toks) and toks[i] not in ("AND", "OR", ")"):
                return None
        if not items or (len(items) > 1 and op is None):
            return None
        if len(items) == 1:
            return items[0]
        flat = []
        for it in items:
            if isinstance(it, list) and it[0] == op.lower():
                flat += it[1:]
            else:
                flat.append(it)
        return [op.lower()] + flat

    tree = group()
    return tree if tree is not None and i == len(toks) else None


def map_leaves(tree, fn):
    if isinstance(tree, str):
        return fn(tree)
    return [tree[0]] + [map_leaves(t, fn) for t in tree[1:]]


def build_requisites(rows, keys, resolver):
    """{key: {prereq?, antireq?, uncertain}} for current rules of the given course keys.

    Only `confirmed` rules that are plain AND/OR trees of course codes are kept as trees.  Any other current rule
    (uncertain confidence, grades, CU counts, CONDITION(n), enrolment semantics) contributes uncertain: true and no
    tree, so the site warns instead of filtering.  Corequisites are not exported."""
    acc = defaultdict(lambda: {"prereq": [], "antireq": [], "uncertain": False})
    for r in rows:
        if r["is_current"] != "true" or r["relation"] not in ("prerequisite", "antirequisite"):
            continue
        key, _ = resolver.resolve(r["course_code"])
        if key not in keys:
            continue
        slot = acc[key]
        field = "prereq" if r["relation"] == "prerequisite" else "antireq"
        tree = parse_expression(r["expression"]) if r["confidence"] == "confirmed" else None
        if tree is None:
            slot["uncertain"] = True
            continue
        tree = map_leaves(tree, lambda c: resolver.resolve(c)[0])
        if tree not in slot[field]:
            slot[field].append(tree)
    out = {}
    for key in sorted(acc):
        slot, entry = acc[key], {}
        for field in ("prereq", "antireq"):
            trees = slot[field]
            if len(trees) == 1:
                entry[field] = trees[0]
            elif len(trees) > 1:  # two catalogue codes of one key disagree
                slot["uncertain"] = True
        entry["uncertain"] = slot["uncertain"]
        out[key] = entry
    return out


# ---------------------------------------------------------------- build / main

def load_data(data_dir: Path):
    return {
        "programmes": read_csv(data_dir / "programmes.csv"),
        "groups": read_csv(data_dir / "requirement_groups.csv"),
        "group_courses": read_csv(data_dir / "group_courses.csv"),
        "courses": read_csv(data_dir / "courses.csv"),
        "requisites": read_csv(data_dir / "requisites.csv"),
        "double_count_rules": read_csv(data_dir / "double_count_rules.csv"),
        "title_aliases": read_csv(data_dir / "title_aliases.csv"),
    }


def load_site_keys(site_dir: Path):
    with open(site_dir / "index.json", encoding="utf-8") as f:
        return {c["code"]: c for c in json.load(f)}


def build(data, site_courses):
    """-> (index, views, requisites, stats).  site_courses: {code: index.json row}."""
    resolver = Resolver(data["courses"], site_courses, data.get("title_aliases", []))
    stats = Counter()
    views = build_views(data, resolver, stats)
    programmes = {p["programme_id"]: p for p in data["programmes"]}
    index, conflicts, orphans = build_index(views, programmes)
    stats["index_conflicts"] = len(conflicts)
    stats["orphans"] = len(orphans)
    keys = {m["code"] for v in views for g in v["groups"] for m in g["members"] if m["code"]}
    requisites = build_requisites(data["requisites"], keys, resolver)
    return index, views, requisites, stats, conflicts, orphans


def write_json(path: Path, obj):
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def write_output(out_dir: Path, index, views, requisites):
    out_dir.mkdir(parents=True, exist_ok=True)
    marker = out_dir / "index.json"
    if marker.exists():  # only clear files an earlier run of this script wrote
        try:
            with open(marker, encoding="utf-8") as f:
                if json.load(f).get("generator") == GENERATOR:
                    for old in out_dir.glob("*.json"):
                        old.unlink()
        except (OSError, ValueError):
            pass
    for v in views:
        body = {k: val for k, val in v.items() if not k.startswith("_")}
        write_json(out_dir / f"{v['id']}.json", body)
    write_json(out_dir / "requisites.json", requisites)
    write_json(out_dir / "index.json", index)


def summarise(views, stats, resolver_site, conflicts, orphans, data):
    lines = [f"views: {len(views)}"]
    bad_sum = bad_comp = 0
    for v in views:
        for y in sorted(v["_meta"]["window"]):  # a group narrower than the view counts only for its own intakes
            add = sum((g["cus"] or 0) for g in v["groups"]
                      if g["role"] == "additive" and ay_label(y) in g.get("intakes", [ay_label(y)]))
            if v["totalCus"] is not None and abs(add - v["totalCus"]) > 1e-9:
                bad_sum += 1
                break
        by_parent = defaultdict(float)
        cus = {g["id"]: g["cus"] or 0 for g in v["groups"]}
        for g in v["groups"]:
            if g.get("parent"):
                by_parent[g["parent"]] += g["cus"] or 0
        bad_comp += sum(1 for p, s in by_parent.items() if abs(cus.get(p, 0) - s) > 1e-9)
    lines.append(f"views whose additive CUs != totalCus: {bad_sum}; parents whose components != parent CUs: {bad_comp}")
    nokey = Counter()
    offered = Counter()
    nulls = Counter()
    for v in views:
        for g in v["groups"]:
            for m in g["members"]:
                if m["code"] is None:
                    nulls[m["cls"]] += 1
                elif m.get("offeredKey") is False:
                    nokey[m["cls"]] += 1
                elif resolver_site.get(m["code"], {}).get("offeredNow"):
                    offered[m["cls"]] += 1
    lines.append(f"members, code null: {dict(nulls)}; coded but no site key: {dict(nokey)}; "
                 f"with site key and offeredNow: {dict(offered)}")
    lines.append(f"stats: {dict(stats)}")
    lines.append(f"index conflicts: {conflicts[:5]}; orphans: {orphans[:5]}")
    return "\n".join(lines)


def main(argv=None) -> int:
    os.umask(0o077)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=DEFAULT_DATA, help="graduation_requirements directory")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    ap.add_argument("--site-data", type=Path, default=DEFAULT_SITE_DATA, help="site data dir holding index.json (course keys)")
    args = ap.parse_args(argv)
    data = load_data(args.data)
    site_courses = load_site_keys(args.site_data)
    index, views, requisites, stats, conflicts, orphans = build(data, site_courses)
    write_output(args.out, index, views, requisites)
    print(summarise(views, stats, site_courses, conflicts, orphans, data))
    return 0


if __name__ == "__main__":
    sys.exit(main())
