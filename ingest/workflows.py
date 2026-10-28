#!/usr/bin/env python3
"""Local, provider-free document preparation. Outputs are uploadable PDFs plus source manifests.

python ingest/workflows.py pack OUT SLIDES.pdf SCRIPT.pdf EXAM.pdf
python ingest/workflows.py compare OUT OLD.pdf NEW.pdf
python ingest/workflows.py photo OUT PHOTO.jpg --language deu --tessdata PATH
Only use documents you may process. Output folders must be new; originals are never edited.
"""
import argparse
import difflib
import hashlib
import html
import json
from pathlib import Path

import pymupdf

MAX_PAGES = 100
MAX_BYTES = 50 * 1024 * 1024


def source(path):
    path = Path(path)
    if not path.is_file() or not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("Input must be a nonempty file of at most 50 MiB.")
    return {"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def open_pdf(path):
    pdf = pymupdf.open(path)
    if not pdf.is_pdf or pdf.needs_pass or not 0 < len(pdf) <= MAX_PAGES:
        pdf.close()
        raise ValueError("Use an unencrypted PDF with 1–100 pages.")
    return pdf


def pack(paths, out):
    """A single PDF keeps original pages, with bookmarks and a hash-bound page/source map."""
    if not 2 <= len(paths) <= 12:
        raise ValueError("A pack needs 2–12 PDFs.")
    manifest = {"kind": "course-pack", "sources": []}
    result = pymupdf.open()
    toc = []
    try:
        for path in paths:
            item = source(path)
            with open_pdf(path) as pdf:
                if len(result) + len(pdf) > MAX_PAGES:
                    raise ValueError("Combined PDF exceeds 100 pages.")
                start = len(result) + 1
                result.insert_pdf(pdf)
                toc.append([1, item["name"], start])
                manifest["sources"].append({**item, "first_page": start, "last_page": len(result)})
        result.set_toc(toc)
        out = Path(out)
        out.mkdir(parents=True, exist_ok=False)
        result.save(out / "paper.pdf")
        (out / "sources.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    finally:
        result.close()
    return manifest


def paragraphs(pdf):
    return [{"page": i + 1, "text": " ".join(block[4].split())}
            for i, page in enumerate(pdf) for block in page.get_text("blocks", sort=True)
            if block[6] == 0 and block[4].strip()]


def compare(old, new, out):
    """Literal aligned changes with page evidence; no legal assessment or inferred money totals."""
    old_source, new_source = source(old), source(new)
    with open_pdf(old) as before, open_pdf(new) as after:
        a, b = paragraphs(before), paragraphs(after)
        if not a or not b:
            raise ValueError("Both versions need a text layer. Run local OCR first for scans.")
        matcher = difflib.SequenceMatcher(None, [p["text"] for p in a], [p["text"] for p in b], autojunk=False)
        changes = [{"kind": tag, "before": a[i:j], "after": b[k:l]}
                   for tag, i, j, k, l in matcher.get_opcodes() if tag != "equal"]
    # The companion PDF contains the unchanged original pages; its map opens the evidence in the reader.
    manifest = pack([old, new], out)
    offset = manifest["sources"][1]["first_page"] - 1
    for change in changes:
        for p in change["before"]: p["target"] = f'page{p["page"]}'
        for p in change["after"]: p["target"] = f'page{offset + p["page"]}'
    report = {"kind": "literal-version-diff", "before": old_source, "after": new_source,
              "changes": changes, "note": "Text extraction and alignment can miss layout-only or image changes. Check both originals."}
    out = Path(out)
    (out / "changes.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    def cell(items, tag):
        return "".join(f'<p><small>Source page {p["page"]}; Reader {p["target"]}</small><br><{tag}>{html.escape(p["text"])}</{tag}></p>' for p in items) or "<p>—</p>"
    rows = "".join(f'<tr><td>{cell(c["before"], "del")}</td><td>{cell(c["after"], "ins")}</td></tr>' for c in changes)
    document = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>What changed</title><style>body{{font:16px system-ui;background:#171b26;color:#edf1f8;max-width:1100px;margin:32px auto;padding:16px}}table{{width:100%;table-layout:fixed;border-collapse:collapse}}td,th{{padding:16px;vertical-align:top;border:1px solid #555;overflow-wrap:anywhere}}del{{background:#532e39}}ins{{background:#204d42}}small{{color:#b6becd}}@media(max-width:600px){{td{{padding:8px}}}}</style>
<h1>What changed</h1><p>{html.escape(old_source["name"])} → {html.escape(new_source["name"])}</p>
<p>{html.escape(report["note"])}</p><p>Literal text comparison; no assessment of validity or advice to sign.</p>
<table><thead><tr><th>Before</th><th>After</th></tr></thead><tbody>{rows or '<tr><td colspan="2">No extracted text changes.</td></tr>'}</tbody></table></html>'''
    (out / "changes.html").write_text(document)
    return report


def photo(path, out, language="eng", tessdata=None, rotate=0):
    item = source(path)
    pix = pymupdf.Pixmap(str(path))
    if pix.width * pix.height > 20_000_000:
        raise ValueError("Photo exceeds 20 megapixels; resize locally first.")
    if pix.colorspace != pymupdf.csRGB:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if rotate:
        with pymupdf.open() as image_pdf:
            page = image_pdf.new_page(width=pix.width, height=pix.height)
            page.insert_image(page.rect, pixmap=pix)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(1, 1).prerotate(rotate))
    data = pix.pdfocr_tobytes(language=language, tessdata=str(tessdata) if tessdata else None)
    with pymupdf.open(stream=data, filetype="pdf") as pdf:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=False)
        pdf.save(out / "paper.pdf")
    manifest = {"kind": "local-photo-ocr", "source": item, "language": language,
                "review_required": "Compare every amount, deadline and reference with the original image. OCR may misread them."}
    (out / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("pack"); p.add_argument("out"); p.add_argument("pdfs", nargs="+")
    p = commands.add_parser("compare"); p.add_argument("out"); p.add_argument("old"); p.add_argument("new")
    p = commands.add_parser("photo"); p.add_argument("out"); p.add_argument("image")
    p.add_argument("--language", default="eng"); p.add_argument("--tessdata")
    p.add_argument("--rotate", type=int, choices=[0, 90, 180, 270], default=0)
    args = parser.parse_args()
    if args.command == "pack": pack(args.pdfs, args.out)
    elif args.command == "compare": compare(args.old, args.new, args.out)
    else: photo(args.image, args.out, args.language, args.tessdata, args.rotate)
    print(f"Prepared {args.out}/paper.pdf locally. No provider calls. Review sources.json and the original pages.")


if __name__ == "__main__":
    main()
