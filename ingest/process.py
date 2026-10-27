#!/usr/bin/env python3
"""Worker-facing PDF analysis; result.json is written only after validation succeeds.

    python process.py paper.pdf --out output --max-pages 100

For existing hand-authored tours, --existing-doc path/to/doc.json --tour
path/to/tour.json imports the original analysis without assigning new IDs.
Successful output: doc.json, result.json, thumbnail.png, figures/, optional tour.json.
Failures: one JSON object {code, message} on stderr and a nonzero exit status.
"""

from __future__ import annotations

import argparse
from contextlib import redirect_stderr
import hashlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile

import pymupdf

import ingest
import validate


class AnalysisError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def load_json(path: Path, kind: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise AnalysisError("invalid_analysis", f"Cannot read {kind}: {error}") from error
    if not isinstance(value, dict):
        raise AnalysisError("invalid_analysis", f"{kind} must contain a JSON object.")
    return value


def safe_asset(base: Path, name: str) -> Path:
    """Only copy assets belonging to the imported analysis, never arbitrary paths."""
    root = base.resolve()
    path = (root / name).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise AnalysisError("invalid_analysis", f"Missing or invalid analysis asset: {name}")
    return path


def display_geometry(doc: dict, transforms: list[tuple]) -> None:
    """PyMuPDF extracts unrotated positions; PDF.js displays page rotation.

    Analyze with rotation cleared to keep layout heuristics in reading orientation,
    then transform every published rectangle into the displayed page's coordinates.
    """
    def rect(value, page):
        matrix = transforms[page - 1][0]
        return [round(x, 2) for x in pymupdf.Rect(value) * matrix]

    for page in doc["pages"]:
        _, width, height = transforms[page["n"] - 1]
        page.update(width=round(width, 2), height=round(height, 2))
    for key in ("blocks", "figures", "equations"):
        for item in doc[key]:
            item["bbox"] = rect(item["bbox"], item["page"])
            for panel in item.get("panels", []):
                panel["bbox"] = rect(panel["bbox"], item["page"])
    for item in doc["sentences"]:
        item["rects"] = [rect(value, item["page"]) for value in item["rects"]]


def process_pdf(pdf_path: str | Path, out_dir: str | Path, max_pages: int = 100,
                existing_doc: str | Path | None = None, tour: str | Path | None = None) -> dict:
    source, output = Path(pdf_path).resolve(), Path(out_dir).resolve()
    if max_pages < 1:
        raise AnalysisError("invalid_limit", "The page limit must be positive.")
    if not source.is_file():
        raise AnalysisError("invalid_pdf", "The PDF file does not exist.")
    try:
        if not source.read_bytes()[:1024].lstrip().startswith(b"%PDF-"):
            raise AnalysisError("invalid_pdf", "The file is not a PDF.")
        original = pymupdf.open(source)
    except (pymupdf.FileDataError, RuntimeError, OSError) as error:
        raise AnalysisError("invalid_pdf", "The PDF could not be opened.") from error
    try:
        if original.needs_pass:
            raise AnalysisError("password_required", "Password-protected PDFs are not supported yet.")
        if not original.is_pdf or original.page_count == 0:
            raise AnalysisError("invalid_pdf", "The PDF has no readable pages.")
        if original.page_count > max_pages:
            raise AnalysisError("page_limit", f"This PDF has {original.page_count} pages; the limit is {max_pages}.")
        sha = hashlib.sha256(source.read_bytes()).hexdigest()
        warnings = []
        for page in original:
            if len("".join(page.get_text().split())) < 40:
                warnings.append(f"Page {page.number + 1} contains little or no extractable text. OCR is not available yet; image-only content may need visual inspection.")
        transforms = [(pymupdf.Matrix(p.rotation_matrix), p.rect.width, p.rect.height) for p in original]
        output.mkdir(parents=True, exist_ok=True)
        # All generated content stays private to this invocation until it validates.
        with tempfile.TemporaryDirectory(prefix=".analysis-", dir=output) as temporary:
            stage = Path(temporary)
            shutil.copyfile(source, stage / "paper.pdf")
            diagnostics = io.StringIO()
            with redirect_stderr(diagnostics):
                if existing_doc:
                    path = Path(existing_doc).resolve()
                    doc = load_json(path, "doc.json")
                    errors = ingest.schema_errors(doc)
                    if errors:
                        raise AnalysisError("invalid_analysis", "Existing analysis validation failed: " + "; ".join(errors[:8]))
                    if doc.get("source", {}).get("sha256") != sha:
                        raise AnalysisError("source_mismatch", "The existing analysis belongs to a different PDF.")
                    for figure in doc["figures"]:
                        name = figure["image"]
                        destination = stage / name
                        if not destination.resolve().is_relative_to(stage.resolve()):
                            raise AnalysisError("invalid_analysis", "An asset path leaves the analysis directory.")
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(safe_asset(path.parent, name), destination)
                else:
                    # Alter only this in-memory handle; original PDF bytes stay untouched.
                    with pymupdf.open(source) as analysis_pdf:
                        for page in analysis_pdf:
                            page.set_rotation(0)
                        pages, sections, figures, equations, stats = ingest.analyse(analysis_pdf)
                        doc = ingest.build_doc(str(source), analysis_pdf, pages, sections, figures, equations, stats)
                        ingest.write_figures(figures, str(stage))
                        display_geometry(doc, transforms)
                doc["source"]["file"] = "paper.pdf"
                report = validate.Report()
                valid = validate.check_schema(doc, "doc.schema.json", "doc.json", report)
                if valid:
                    index, count = validate.check_doc(doc, str(stage), report)
                    if count != original.page_count:
                        report.error("doc.json", "$.pages", "Analysis page count does not match the original PDF.")
                    if tour:
                        tour_data = load_json(Path(tour), "tour.json")
                        if validate.check_schema(tour_data, "tour.schema.json", "tour.json", report):
                            validate.check_tour(tour_data, str(stage), doc, index, count, report, check_folder=False)
                        (stage / "tour.json").write_text(json.dumps(tour_data, ensure_ascii=False), encoding="utf-8")
                if report.errors:
                    raise AnalysisError("invalid_analysis", "Analysis validation failed: " + "; ".join(report.errors[:8]))
                warnings.extend(report.warnings)
            warnings.extend(line.removeprefix("warning: ").strip() for line in diagnostics.getvalue().splitlines() if line.strip())
            original[0].get_pixmap(matrix=pymupdf.Matrix(0.5, 0.5), alpha=False).save(stage / "thumbnail.png")
            (stage / "doc.json").write_text(ingest.dump_doc(doc), encoding="utf-8")
            assets = [{"kind": "thumbnail", "path": "thumbnail.png"}]
            assets.extend({"kind": "figure", "path": f["image"], "element_id": f["id"]} for f in doc["figures"])
            result = {
                "parser_version": doc["source"]["generator"],
                "sha256": sha,
                "page_count": original.page_count,
                "title": doc["source"].get("title") or original.metadata.get("title") or None,
                "warnings": list(dict.fromkeys(warnings)),
                "status": "limited" if warnings else "ready",
                "assets": assets,
            }
            # result.json is the completion marker; publish it last.
            for asset in assets:
                name = asset["path"]
                destination = output / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                (stage / name).replace(destination)
            (stage / "doc.json").replace(output / "doc.json")
            if tour:
                (stage / "tour.json").replace(output / "tour.json")
            (stage / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (stage / "result.json").replace(output / "result.json")
            return result
    except AnalysisError:
        raise
    except Exception as error:
        raise AnalysisError("analysis_failed", f"The PDF could not be analyzed: {error}") from error
    finally:
        original.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-pages", type=int, default=100)
    parser.add_argument("--existing-doc")
    parser.add_argument("--tour")
    args = parser.parse_args(argv)
    try:
        result = process_pdf(args.pdf, args.out, args.max_pages, args.existing_doc, args.tour)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except AnalysisError as error:
        print(json.dumps({"code": error.code, "message": error.message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
