#!/usr/bin/env python3
"""Validate a paper folder for Paper Tour.

    validate.py <paper-folder>

Checks doc.json, and tour.json when present, against schema/doc.schema.json and
schema/tour.schema.json, then checks referential integrity: every ID the tour points at
exists in doc.json, step and chapter IDs are unique, at_word and regions are in range,
and doc.json is internally consistent. Exit code 1 on any error, 0 otherwise; warnings
are printed but do not fail.
"""

import argparse
import json
import os
import re
import sys

import jsonschema

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_DIR = os.path.normpath(os.path.join(HERE, os.pardir, "schema"))
PAGE_ID_RE = re.compile(r"^page([1-9][0-9]*)$")
TOLERANCE = 0.5   # points; rounding slack for bbox containment


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, fname, path, msg):
        self.errors.append(f"{fname} {path}: {msg}")

    def warn(self, fname, path, msg):
        self.warnings.append(f"{fname} {path}: {msg}")


def plural(n, word):
    return f"{n} {word}{'' if n == 1 else 's'}"


def json_path(parts):
    return "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in parts)


def load(path, report):
    fname = os.path.basename(path)
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError as e:
        report.error(fname, "$", f"not valid JSON: {e.msg} at line {e.lineno}, column {e.colno}")
    except OSError as e:
        report.error(fname, "$", f"cannot read: {e.strerror}")
    return None


# ---------------------------------------------------------------------------- schema

def check_schema(instance, schema_name, fname, report):
    with open(os.path.join(SCHEMA_DIR, schema_name), encoding="utf-8") as fh:
        schema = json.load(fh)
    validator = jsonschema.Draft202012Validator(schema)
    before = len(report.errors)
    order = lambda e: [(0, p, "") if isinstance(p, int) else (1, 0, p) for p in e.absolute_path]
    for e in sorted(validator.iter_errors(instance), key=order):
        for path, msg in explain(e):
            report.error(fname, json_path(path), msg)
    return len(report.errors) == before


def explain(e):
    """Readable messages for a schema error; tour actions get the errors of their own type."""
    path = list(e.absolute_path)
    if e.validator == "oneOf" and isinstance(e.instance, dict) and isinstance(e.schema.get("oneOf"), list):
        branches = e.schema["oneOf"]
        kinds = [b.get("properties", {}).get("type", {}).get("const") for b in branches]
        kind = e.instance.get("type")
        if "type" not in e.instance:
            return [(path, "action has no 'type'")]
        if kind not in kinds:
            return [(path + ["type"], f"unknown action type {kind!r}; expected one of {', '.join(k for k in kinds if k)}")]
        idx = kinds.index(kind)
        sub = [c for c in e.context if c.relative_schema_path and c.relative_schema_path[0] == idx]
        out = []
        for c in sub:
            if c.validator == "additionalProperties":
                extra = sorted(set(c.instance) - set(c.schema.get("properties", {})))
                out.append((list(c.absolute_path), f"'{kind}' action does not take {', '.join(map(repr, extra))}"))
            else:
                out.append((list(c.absolute_path), c.message))
        return out or [(path, e.message)]
    if e.validator == "additionalProperties" and isinstance(e.instance, dict):
        extra = sorted(set(e.instance) - set(e.schema.get("properties", {})))
        return [(path, f"unexpected propert{'y' if len(extra) == 1 else 'ies'} {', '.join(map(repr, extra))}")]
    msg = e.message
    if len(msg) > 200:
        msg = msg[:197] + "..."
    return [(path, msg)]


# ---------------------------------------------------------------------------- doc.json

def items(doc, key):
    v = doc.get(key) if isinstance(doc, dict) else None
    return [(i, x) for i, x in enumerate(v) if isinstance(x, dict)] if isinstance(v, list) else []


def bbox_ok(b):
    return isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)


def check_bbox(b, fname, path, report, page=None):
    if not bbox_ok(b):
        return
    if b[0] > b[2] or b[1] > b[3]:
        report.error(fname, path, f"bbox {b} has x0 > x1 or y0 > y1")
    elif page and (b[0] < -2 or b[1] < -2 or b[2] > page[0] + 2 or b[3] > page[1] + 2):
        report.warn(fname, path, f"bbox {b} extends past the page ({page[0]:g} x {page[1]:g})")


def check_doc(doc, folder, report):
    """Internal consistency of doc.json; returns the ID index the tour is checked against."""
    f = "doc.json"
    src = doc.get("source", {}) if isinstance(doc.get("source"), dict) else {}
    pages = {p.get("n"): (p.get("width", 0), p.get("height", 0)) for _, p in items(doc, "pages")}
    num_pages = src.get("num_pages", len(pages))
    if len(pages) != num_pages:
        report.error(f, "$.pages", f"{len(pages)} pages listed but source.num_pages is {num_pages}")
    for i, p in items(doc, "pages"):
        if p.get("n") != i + 1:
            report.error(f, f"$.pages[{i}].n", f"expected {i + 1}, found {p.get('n')}")
    if src.get("file") and not os.path.isfile(os.path.join(folder, src["file"])):
        report.warn(f, "$.source.file", f"{src['file']!r} not found next to doc.json")

    def unique(key):
        seen = {}
        for i, x in items(doc, key):
            xid = x.get("id")
            if xid in seen:
                report.error(f, f"$.{key}[{i}].id", f"duplicate ID {xid!r} (first at $.{key}[{seen[xid]}])")
            else:
                seen[xid] = i
        return seen

    blocks = {x["id"]: x for _, x in items(doc, "blocks") if "id" in x}
    sentences = {x["id"]: x for _, x in items(doc, "sentences") if "id" in x}
    sections = {x["id"]: x for _, x in items(doc, "sections") if "id" in x}
    figures = {x["id"]: x for _, x in items(doc, "figures") if "id" in x}
    equations = {x["id"]: x for _, x in items(doc, "equations") if "id" in x}
    for key in ("blocks", "sentences", "sections", "figures", "equations"):
        unique(key)

    def check_page(x, path, idv):
        n = x.get("page")
        if n not in pages:
            report.error(f, path + ".page", f"page {n} is out of range 1..{num_pages}")
        m = re.match(r"^p(\d+)\.", idv or "")
        if m and int(m.group(1)) != n:
            report.error(f, path + ".page", f"ID {idv!r} names page {m.group(1)} but page is {n}")
        return pages.get(n)

    for i, b in items(doc, "blocks"):
        path = f"$.blocks[{i}]"
        page = check_page(b, path, b.get("id"))
        check_bbox(b.get("bbox"), f, path + ".bbox", report, page)
        if "section" in b and b["section"] not in sections:
            report.error(f, path + ".section", f"unknown section {b['section']!r}")
        for j, sid in enumerate(b.get("sentences", []) or []):
            s = sentences.get(sid)
            if s is None:
                report.error(f, f"{path}.sentences[{j}]", f"unknown sentence {sid!r}")
            elif s.get("block") != b.get("id"):
                report.error(f, f"{path}.sentences[{j}]", f"sentence {sid!r} belongs to block {s.get('block')!r}")
    for i, s in items(doc, "sentences"):
        path = f"$.sentences[{i}]"
        page = check_page(s, path, s.get("id"))
        b = blocks.get(s.get("block"))
        if b is None:
            report.error(f, path + ".block", f"unknown block {s.get('block')!r}")
        elif s.get("id") not in (b.get("sentences") or []):
            report.error(f, path + ".block", f"block {b['id']!r} does not list sentence {s.get('id')!r}")
        for j, r in enumerate(s.get("rects", []) or []):
            check_bbox(r, f, f"{path}.rects[{j}]", report, page)
    for i, s in items(doc, "sections"):
        path = f"$.sections[{i}]"
        b = blocks.get(s.get("block"))
        if b is None:
            report.error(f, path + ".block", f"unknown block {s.get('block')!r}")
            continue
        if b.get("type") != "heading":
            report.error(f, path + ".block", f"block {b['id']!r} is a {b.get('type')}, not a heading")
        if b.get("page") != s.get("page"):
            report.error(f, path + ".page", f"section is on page {s.get('page')} but its block is on page {b.get('page')}")
    panels = {}
    for i, fig in items(doc, "figures"):
        path = f"$.figures[{i}]"
        page = check_page(fig, path, None)
        check_bbox(fig.get("bbox"), f, path + ".bbox", report, page)
        if "caption_block" in fig and fig["caption_block"] not in blocks:
            report.error(f, path + ".caption_block", f"unknown block {fig['caption_block']!r}")
        if fig.get("image") and not os.path.isfile(os.path.join(folder, fig["image"])):
            report.warn(f, path + ".image", f"{fig['image']!r} not found")
        for j, pn in enumerate(fig.get("panels", []) or []):
            ppath = f"{path}.panels[{j}]"
            pid = pn.get("id", "")
            if not pid.startswith(f"{fig.get('id')}."):
                report.error(f, ppath + ".id", f"panel {pid!r} is not named after figure {fig.get('id')!r}")
            if pid in panels:
                report.error(f, ppath + ".id", f"duplicate panel ID {pid!r}")
            panels[pid] = pn
            pb, fb = pn.get("bbox"), fig.get("bbox")
            check_bbox(pb, f, ppath + ".bbox", report)
            if bbox_ok(pb) and bbox_ok(fb) and (pb[0] < fb[0] - TOLERANCE or pb[1] < fb[1] - TOLERANCE
                                                or pb[2] > fb[2] + TOLERANCE or pb[3] > fb[3] + TOLERANCE):
                report.error(f, ppath + ".bbox", f"panel {pb} is not inside its figure {fb}")
        for j, sid in enumerate(fig.get("referenced_by", []) or []):
            if sid not in sentences:
                report.error(f, f"{path}.referenced_by[{j}]", f"unknown sentence {sid!r}")
    for i, e in items(doc, "equations"):
        path = f"$.equations[{i}]"
        page = check_page(e, path, None)
        check_bbox(e.get("bbox"), f, path + ".bbox", report, page)
        if "block" in e and e["block"] not in blocks:
            report.error(f, path + ".block", f"unknown block {e['block']!r}")
    exercises = check_exercises(doc, blocks, check_page, report)

    index = {}
    for kind, ids in (("block", blocks), ("sentence", sentences), ("section", sections),
                      ("figure/table", figures), ("panel", panels), ("equation", equations)):
        for x in ids:
            index[x] = kind
    index.update(exercises)
    return index, num_pages


def check_exercises(doc, blocks, check_page, report):
    """Tasks and parts of an exercise sheet: unique IDs named after their task, known blocks in reading
    order, each block in one task, and every part inside its parent. Returns {ID: kind}."""
    f = "doc.json"
    order = {b["id"]: i for i, b in items(doc, "blocks") if "id" in b}
    kinds, owner = {}, {}

    def check(x, path, parent, outer):
        xid = x.get("id")
        if xid in kinds:
            report.error(f, path + ".id", f"duplicate exercise ID {xid!r}")
        kinds[xid] = "exercise" if parent is None else "exercise part"
        if parent is not None and xid != f"{parent}.{x.get('label')}":
            report.error(f, path + ".id", f"part {xid!r} is not named after {parent!r} and its label "
                                          f"{x.get('label')!r}")
        check_page(x, path, None)
        ids = [b for b in x.get("blocks", []) or [] if isinstance(b, str)]
        for j, bid in enumerate(ids):
            if bid not in blocks:
                report.error(f, f"{path}.blocks[{j}]", f"unknown block {bid!r}")
            elif outer is not None and bid not in outer:
                report.error(f, f"{path}.blocks[{j}]", f"block {bid!r} is not one of {parent!r}'s blocks")
        known = [order[b] for b in ids if b in order]
        if known != sorted(set(known)):
            report.error(f, path + ".blocks", "blocks are not in reading order, or one is listed twice")
        if ids and ids[0] in blocks and blocks[ids[0]].get("page") != x.get("page"):
            report.error(f, path + ".page", f"page is {x.get('page')} but the first block {ids[0]!r} is on page "
                                            f"{blocks[ids[0]].get('page')}")
        for j, part in enumerate(x.get("parts", []) or []):
            if isinstance(part, dict):
                check(part, f"{path}.parts[{j}]", xid, set(ids))
        return ids

    for i, ex in items(doc, "exercises"):
        path = f"$.exercises[{i}]"
        ids = check(ex, path, None, None)
        if ex.get("block") not in blocks:
            report.error(f, path + ".block", f"unknown block {ex.get('block')!r}")
        elif ids and ids[0] != ex["block"]:
            report.error(f, path + ".block", f"{ex['block']!r} is not the first of the exercise's blocks")
        for bid in ids:
            if bid in owner and owner[bid] != ex.get("id"):
                report.error(f, path + ".blocks", f"block {bid!r} also belongs to {owner[bid]!r}")
            owner.setdefault(bid, ex.get("id"))
    return kinds


# ---------------------------------------------------------------------------- tour.json

def kind_of(target):
    if target.startswith("sec-"):
        return "section"
    if target.startswith(("fig", "tab")):
        return "panel" if "." in target else "figure/table"
    if target.startswith("eq"):
        return "equation"
    if re.match(r"^ex([A-Z]?\d|[IVX])", target):
        return "exercise part" if re.search(r"\.[a-z]+$", target) else "exercise"
    if re.match(r"^p\d+\.b", target):
        return "block"
    if re.match(r"^p\d+\.s", target):
        return "sentence"
    return "ID"


def check_tour(tour, folder, doc, index, num_pages, report, *, check_folder=True):
    f = "tour.json"
    paper = os.path.basename(os.path.normpath(os.path.abspath(folder)))
    if check_folder and isinstance(tour.get("paper"), str) and tour["paper"] != paper:
        report.error(f, "$.paper", f"{tour['paper']!r} does not match the folder name {paper!r}")
    sha = (doc or {}).get("source", {}).get("sha256") if isinstance(doc, dict) else None
    if "doc_sha256" in tour and sha and tour["doc_sha256"] != sha:
        report.error(f, "$.doc_sha256", f"does not match doc.json source.sha256 ({sha[:12]}…); "
                                       "the tour was written against a different PDF")
    voices = tour.get("voices") if isinstance(tour.get("voices"), dict) else {}

    def check_id(target, path):
        if not isinstance(target, str) or index is None:
            return
        m = PAGE_ID_RE.match(target)
        if m:
            if not 1 <= int(m.group(1)) <= num_pages:
                report.error(f, path, f"{target!r} is out of range page1..page{num_pages}")
        elif target not in index:
            report.error(f, path, f"unknown {kind_of(target)} {target!r} (not in doc.json)")

    chapter_ids, step_ids, n_steps = {}, {}, 0
    for ci, ch in items(tour, "chapters"):
        cpath = f"$.chapters[{ci}]"
        cid = ch.get("id")
        if cid in chapter_ids:
            report.error(f, cpath + ".id", f"duplicate chapter ID {cid!r} (first at {chapter_ids[cid]})")
        else:
            chapter_ids[cid] = cpath
        for si, step in items(ch, "steps"):
            n_steps += 1
            spath = f"{cpath}.steps[{si}]"
            sid = step.get("id")
            if sid in step_ids:
                report.error(f, spath + ".id", f"duplicate step ID {sid!r} (first at {step_ids[sid]})")
            else:
                step_ids[sid] = spath
            n_words = len(step["say"].split()) if isinstance(step.get("say"), str) else 0
            speaker = step.get("speaker")
            if isinstance(speaker, str) and speaker not in voices:
                report.warn(f, spath + ".speaker", f"speaker {speaker!r} has no entry in $.voices; the default voice is used")
            for ai, act in items(step, "actions"):
                apath = f"{spath}.actions[{ai}]"
                for key in ("target", "anchor"):
                    if key in act:
                        check_id(act[key], f"{apath}.{key}")
                for ti, t in enumerate(act.get("targets", []) if isinstance(act.get("targets"), list) else []):
                    check_id(t, f"{apath}.targets[{ti}]")
                aw = act.get("at_word")
                if isinstance(aw, int) and aw >= max(n_words, 1):
                    report.error(f, apath + ".at_word", f"{aw} is past the end of `say` ({n_words} words, so 0..{n_words - 1})")
                reg = act.get("region")
                if isinstance(reg, list) and len(reg) == 4 and all(isinstance(v, (int, float)) for v in reg):
                    if not (reg[0] < reg[2] and reg[1] < reg[3]):
                        report.error(f, apath + ".region", f"{reg} needs x0 < x1 and y0 < y1")
    return len(items(tour, "chapters")), n_steps


# ---------------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description="Validate doc.json and tour.json of a paper folder.")
    ap.add_argument("folder", help="paper folder, e.g. demo/attention")
    args = ap.parse_args(argv)
    folder = args.folder
    if not os.path.isdir(folder):
        sys.exit(f"error: {folder} is not a folder")

    report = Report()
    summary = []
    doc_path, tour_path = os.path.join(folder, "doc.json"), os.path.join(folder, "tour.json")
    doc, index, num_pages = None, None, 0
    if not os.path.isfile(doc_path):
        report.error("doc.json", "$", "missing; run ingest/ingest.py on the PDF first")
    else:
        doc = load(doc_path, report)
        if doc is not None and check_schema(doc, "doc.schema.json", "doc.json", report):
            index, num_pages = check_doc(doc, folder, report)
            summary.append(f"doc.json: {len(doc['blocks'])} blocks, {len(doc['sentences'])} sentences, "
                           f"{len(doc['sections'])} sections, {len(doc['figures'])} figures/tables, "
                           f"{len(doc['equations'])} equations"
                           + (f", {plural(len(doc['exercises']), 'exercise')}" if doc.get("exercises") else ""))
        elif doc is not None:
            summary.append("doc.json: schema errors, integrity checks skipped")
    if os.path.isfile(tour_path):
        tour = load(tour_path, report)
        if tour is not None:
            check_schema(tour, "tour.schema.json", "tour.json", report)
            if isinstance(tour, dict):
                if index is None:
                    report.warn("tour.json", "$", "IDs not checked because doc.json is missing or invalid")
                n_ch, n_st = check_tour(tour, folder, doc, index, num_pages, report)
                summary.append(f"tour.json: {plural(n_ch, 'chapter')}, {plural(n_st, 'step')}")
    else:
        summary.append("no tour.json")

    for e in report.errors:
        print(f"error    {e}")
    for w in report.warnings:
        print(f"warning  {w}")
    status = "FAILED" if report.errors else "OK"
    print(f"validate {folder}: {status}, {plural(len(report.errors), 'error')}, "
          f"{plural(len(report.warnings), 'warning')} ({'; '.join(summary)})")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
