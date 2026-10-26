#!/usr/bin/env python3
"""Print a paper's doc.json as a compact, greppable ID outline for tour authors.

    outline.py <paper-folder> [--page N] [--full]

Shows the title, the section tree, figures and tables (with panels and citing sentences),
equations, and then every block and sentence of each page with its ID. This is the text a
tour author (human or LLM) works from: tours point at these IDs, never at coordinates.
"""

import argparse
import json
import os
import sys

TRUNCATE = 160


def clip(text, full):
    text = " ".join(text.split())
    if full or len(text) <= TRUNCATE:
        return text
    return text[: TRUNCATE - 1] + "…"


def fmt_bbox(b):
    return "[" + ", ".join(f"{v:g}" for v in b) + "]"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Print the ID outline of a paper folder's doc.json.")
    ap.add_argument("folder", help="paper folder containing doc.json, e.g. demo/attention")
    ap.add_argument("--page", type=int, help="only list blocks and sentences of this page")
    ap.add_argument("--full", action="store_true", help="do not truncate long texts")
    args = ap.parse_args(argv)

    path = os.path.join(args.folder, "doc.json")
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"error: cannot read {path}: {e}")

    src = doc["source"]
    sentences = {s["id"]: s for s in doc["sentences"]}
    out = []
    out.append(f"# {src.get('title', src['file'])}")
    out.append(f"# {src['file']}, {src['num_pages']} pages, sha256 {src['sha256'][:12]}, {src['generator']}")
    out.append(f"# {len(doc['blocks'])} blocks, {len(doc['sentences'])} sentences, "
               f"{len(doc['sections'])} sections, {len(doc['figures'])} figures/tables, "
               f"{len(doc['equations'])} equations; whole pages are page1..page{len(doc['pages'])}")

    out.append("")
    out.append("## Sections")
    for s in doc["sections"]:
        label = f"{s['number']} {s['title']}" if s.get("number") else s["title"]
        indent = "  " * (s["level"] - 1)
        out.append(f"{s['id']:<28} {indent}{label}  (p{s['page']}, {s['block']})")

    out.append("")
    out.append("## Figures and tables")
    for f in doc["figures"]:
        out.append(f"{f['id']:<6} {f['kind']:<6} p{f['page']:<3} {fmt_bbox(f['bbox'])}  {f['image']}")
        out.append(f"       caption {f.get('caption_block', '-')}: {clip(f['caption'], args.full)}")
        if f["panels"]:
            panels = ", ".join(p["id"] + (f" {p['label']}" if p.get("label") else "") for p in f["panels"])
            out.append(f"       panels: {panels}")
        refs = " ".join(f["referenced_by"]) or "-"
        out.append(f"       referenced_by: {refs}")

    out.append("")
    out.append("## Equations")
    if not doc["equations"]:
        out.append("(none)")
    for e in doc["equations"]:
        out.append(f"{e['id']:<6} p{e['page']:<3} {e.get('block', '-'):<8} {clip(e['text'], args.full)}")

    for page in doc["pages"]:
        n = page["n"]
        if args.page and n != args.page:
            continue
        out.append("")
        out.append(f"## Page {n}  (page{n}, {page['width']:g} x {page['height']:g} pt)")
        for b in doc["blocks"]:
            if b["page"] != n:
                continue
            sec = b.get("section", "-")
            if b["sentences"]:
                out.append(f"[{b['id']} {b['type']} {sec}]")
                for sid in b["sentences"]:
                    s = sentences.get(sid)
                    text = clip(s["text"], args.full) if s else "(missing sentence)"
                    out.append(f"{sid:<9} {text}")
            else:
                out.append(f"[{b['id']} {b['type']} {sec}] {clip(b['text'], args.full)}")

    try:
        print("\n".join(out))
    except BrokenPipeError:          # e.g. piped into head
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
