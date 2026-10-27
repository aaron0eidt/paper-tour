#!/usr/bin/env python3
"""Prepare bounded, real image inputs for multimodal paper-tour generation.

    python tour_assets.py paper.pdf --doc doc.json --assets-dir assets --out images

images.json paths are relative to the output directory. Every PDF page is included,
followed by every extracted figure/table. Missing crops are rendered from the PDF.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import math
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import sys
import tempfile

import pymupdf


MAX_PAGES = 100
MAX_IMAGES = 200
MAX_TOTAL_BYTES = 32 * 1024 * 1024
PAGE_EDGE = 1280
FIGURE_EDGE = 1800
JPEG_QUALITY = 85
FIGURE_ID = re.compile(r"^(fig|tab)[0-9A-Za-z]+$")


class AssetError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


@contextmanager
def quiet_mupdf():
    """Keep native parser diagnostics out of the worker's JSON error channel."""
    errors = pymupdf.TOOLS.mupdf_display_errors()
    warnings = pymupdf.TOOLS.mupdf_display_warnings()
    pymupdf.TOOLS.mupdf_display_errors(False)
    pymupdf.TOOLS.mupdf_display_warnings(False)
    try:
        yield
    finally:
        pymupdf.TOOLS.mupdf_display_errors(errors)
        pymupdf.TOOLS.mupdf_display_warnings(warnings)


def safe_crop(root: Path, name: str) -> Path | None:
    """Missing files may fall back to PDF rendering; unsafe paths must fail."""
    if not isinstance(name, str) or not name or "\\" in name:
        raise AssetError("invalid_asset_path", "An analysis image has an invalid asset path.")
    relative = PurePosixPath(name)
    if (relative.is_absolute() or PureWindowsPath(name).is_absolute()
            or any(part in ("..", ".") for part in name.split("/"))
            or ":" in relative.parts[0]):
        raise AssetError("invalid_asset_path", "An analysis image leaves its asset directory.")
    candidate = root
    for part in relative.parts:
        candidate /= part
        if candidate.is_symlink():
            raise AssetError("invalid_asset_path", "Symbolic links are not allowed in analysis image paths.")
    if not candidate.resolve().is_relative_to(root):
        raise AssetError("invalid_asset_path", "An analysis image leaves its asset directory.")
    if candidate.exists() and not candidate.is_file():
        raise AssetError("invalid_asset_path", "An analysis image path is not a file.")
    return candidate if candidate.is_file() else None


def fit_pixmap(pixmap: pymupdf.Pixmap, maximum: int) -> pymupdf.Pixmap:
    if max(pixmap.width, pixmap.height) > maximum:
        ratio = maximum / max(pixmap.width, pixmap.height)
        pixmap = pymupdf.Pixmap(pixmap, max(1, int(pixmap.width * ratio)),
                               max(1, int(pixmap.height * ratio)), None)
    if pixmap.alpha:
        # Composite on paper-white rather than dropping premultiplied alpha,
        # which turns transparent margins black.
        with pymupdf.open() as image_pdf:
            page = image_pdf.new_page(width=pixmap.width, height=pixmap.height)
            page.insert_image(page.rect, pixmap=pixmap)
            pixmap = page.get_pixmap(colorspace=pymupdf.csRGB, alpha=False)
    if pixmap.colorspace is None or pixmap.colorspace.n != 3:
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, pixmap)
    return pixmap


def render_page(page: pymupdf.Page, maximum: int, clip=None) -> pymupdf.Pixmap:
    # Display lists, like PDF.js, apply the page's /Rotate value. Published
    # document boxes already use these displayed page coordinates.
    area = pymupdf.Rect(clip) if clip is not None else page.rect
    ratio = maximum / max(area.width, area.height)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(ratio, ratio), clip=area,
                            colorspace=pymupdf.csRGB, alpha=False)
    return fit_pixmap(pixmap, maximum)


def valid_box(value, page: pymupdf.Page) -> pymupdf.Rect:
    if (not isinstance(value, list) or len(value) != 4
            or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in value)):
        raise AssetError("invalid_document", "An analysis image has invalid page geometry.")
    box = pymupdf.Rect(value)
    if box.is_empty or box.is_infinite:
        raise AssetError("invalid_document", "An analysis image has empty page geometry.")
    bounds = page.rect
    if box.x0 < -2 or box.y0 < -2 or box.x1 > bounds.width + 2 or box.y1 > bounds.height + 2:
        raise AssetError("invalid_document", "An analysis image extends outside its PDF page.")
    box &= bounds
    if box.is_empty:
        raise AssetError("invalid_document", "An analysis image does not intersect its PDF page.")
    return box


def prepare_images(pdf_path: str | Path, doc_path: str | Path, assets_dir: str | Path,
                   out_dir: str | Path, *, max_pages: int = MAX_PAGES,
                   max_images: int = MAX_IMAGES, max_total_bytes: int = MAX_TOTAL_BYTES) -> dict:
    source, document_file = Path(pdf_path), Path(doc_path)
    asset_path, output = Path(assets_dir), Path(out_dir)
    if source.is_symlink() or document_file.is_symlink() or asset_path.is_symlink() or output.is_symlink():
        raise AssetError("invalid_asset_path", "Input and output roots must not be symbolic links.")
    root = asset_path.resolve()
    if root.exists() and not root.is_dir():
        raise AssetError("invalid_asset_path", "The analysis asset root is not a directory.")
    if min(max_pages, max_images, max_total_bytes) < 1:
        raise AssetError("resource_limit", "The image preparation limits must be positive.")
    try:
        doc = json.loads(document_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise AssetError("invalid_document", "The document analysis could not be read.") from None
    if (not isinstance(doc, dict) or not isinstance(doc.get("source"), dict)
            or not isinstance(doc.get("pages"), list) or not isinstance(doc.get("figures"), list)):
        raise AssetError("invalid_document", "The document analysis is incomplete.")
    try:
        digest = hashlib.sha256()
        with source.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError:
        raise AssetError("invalid_pdf", "The source PDF could not be read.") from None
    if digest.hexdigest() != doc["source"].get("sha256"):
        raise AssetError("source_mismatch", "The document analysis belongs to a different PDF.")
    with quiet_mupdf():
        try:
            pdf = pymupdf.open(source)
        except Exception:
            raise AssetError("invalid_pdf", "The source PDF could not be opened.") from None
        try:
            if not pdf.is_pdf or pdf.needs_pass or not pdf.page_count:
                raise AssetError("invalid_pdf", "The source must be a readable, unencrypted PDF.")
            if pdf.page_count > max_pages:
                raise AssetError("resource_limit", "The source PDF exceeds the page limit.")
            if (len(doc["pages"]) != pdf.page_count or type(doc["source"].get("num_pages")) is not int
                    or doc["source"]["num_pages"] != pdf.page_count):
                raise AssetError("invalid_document", "The analysis page count does not match the PDF.")
            if pdf.page_count + len(doc["figures"]) > max_images:
                raise AssetError("resource_limit", "The paper exceeds the total image limit.")
            seen = set()
            for index, page_data in enumerate(doc["pages"], start=1):
                if (not isinstance(page_data, dict) or type(page_data.get("n")) is not int
                        or page_data["n"] != index):
                    raise AssetError("invalid_document", "The analysis has duplicate or invalid page identifiers.")
                page = pdf[index - 1]
                for field, expected in (("width", page.rect.width), ("height", page.rect.height)):
                    actual = page_data.get(field)
                    if (isinstance(actual, bool) or not isinstance(actual, (int, float))
                            or not math.isfinite(actual) or abs(actual - expected) > 1):
                        raise AssetError("invalid_document", "The analysis page dimensions do not match the PDF display.")
                seen.add(f"page{index}")
            figures = []
            for figure in doc["figures"]:
                if not isinstance(figure, dict):
                    raise AssetError("invalid_document", "An analysis figure is invalid.")
                target, kind, page_number = figure.get("id"), figure.get("kind"), figure.get("page")
                if not isinstance(target, str) or not FIGURE_ID.fullmatch(target) or target in seen:
                    raise AssetError("invalid_document", "The analysis has duplicate or invalid figure identifiers.")
                seen.add(target)
                if kind not in ("figure", "table") or type(page_number) is not int or not 1 <= page_number <= pdf.page_count:
                    raise AssetError("invalid_document", "An analysis figure has an invalid kind or page.")
                if not isinstance(figure.get("caption"), str):
                    raise AssetError("invalid_document", "An analysis figure has no valid caption.")
                box = valid_box(figure.get("bbox"), pdf[page_number - 1])
                crop = safe_crop(root, figure.get("image"))
                figures.append((figure, box, crop))
            output.mkdir(parents=True, exist_ok=True)
            images, total_bytes = [], 0
            with tempfile.TemporaryDirectory(prefix=".tour-images-", dir=output) as temporary:
                staging = Path(temporary)

                def add(pixmap, target, kind, page, label, relative):
                    nonlocal total_bytes
                    encoded = pixmap.tobytes("jpeg", jpg_quality=JPEG_QUALITY)
                    total_bytes += len(encoded)
                    if total_bytes > max_total_bytes:
                        raise AssetError("resource_limit", "The paper images exceed the total JPEG byte limit.")
                    destination = staging / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(encoded)
                    images.append({"target_id": target, "kind": kind, "page": page,
                                   "label": label, "path": relative, "mime_type": "image/jpeg"})

                for index in range(pdf.page_count):
                    target = f"page{index + 1}"
                    add(render_page(pdf[index], PAGE_EDGE), target, "page", index + 1,
                        f"Page {index + 1} ({target})", f"pages/page-{index + 1:03d}.jpg")
                for figure, box, crop in figures:
                    if crop:
                        try:
                            pixmap = fit_pixmap(pymupdf.Pixmap(crop), FIGURE_EDGE)
                        except Exception:
                            raise AssetError("invalid_asset", "An analysis image could not be decoded.") from None
                    else:
                        pixmap = render_page(pdf[figure["page"] - 1], FIGURE_EDGE, box)
                    label = f"{figure['kind'].capitalize()} {figure['id']} on page {figure['page']}: {' '.join(figure['caption'].split())}"
                    add(pixmap, figure["id"], figure["kind"], figure["page"], label,
                        f"figures/{figure['id']}.jpg")
                # Manifest is the completion marker; leave no published partial set.
                manifest = {"images": images}
                for image in images:
                    destination = output / image["path"]
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if destination.parent.is_symlink():
                        raise AssetError("invalid_asset_path", "Output image directories must not be symbolic links.")
                    (staging / image["path"]).replace(destination)
                (staging / "images.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                (staging / "images.json").replace(output / "images.json")
                return manifest
        except AssetError:
            raise
        except Exception:
            raise AssetError("render_failed", "The paper images could not be prepared.") from None
        finally:
            pdf.close()


class Arguments(argparse.ArgumentParser):
    def error(self, _message):
        raise AssetError("invalid_arguments", "Provide a PDF, --doc, --assets-dir and --out.")


def main(argv=None) -> int:
    parser = Arguments(description=__doc__)
    parser.add_argument("pdf")
    parser.add_argument("--doc", required=True)
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--out", required=True)
    try:
        args = parser.parse_args(argv)
        result = prepare_images(args.pdf, args.doc, args.assets_dir, args.out)
        total = sum((Path(args.out) / item["path"]).stat().st_size for item in result["images"])
        print(json.dumps({"image_count": len(result["images"]), "bytes": total}))
        return 0
    except AssetError as error:
        print(json.dumps({"code": error.code, "message": error.message}), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"code": "render_failed", "message": "The paper images could not be prepared."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
