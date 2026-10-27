"""Actual-pixel regressions for the multimodal tour image preparation boundary."""

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pymupdf

from tour_assets import AssetError, prepare_images


HERE = Path(__file__).resolve().parent


class TourAssetsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.pdf_path = self.root / "private-source-name.pdf"
        self.doc_path = self.root / "doc.json"
        self.assets = self.root / "assets"
        (self.assets / "figures").mkdir(parents=True)
        self.out = self.root / "out"
        with pymupdf.open() as pdf:
            page = pdf.new_page(width=400, height=600)
            page.insert_text((30, 50), "Private scientific document text", fontsize=16)
            page.draw_rect((40, 100, 300, 300), color=None, fill=(0, 0, 1))
            scan = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 500, 700), False)
            scan.clear_with(210)
            page = pdf.new_page(width=500, height=700)
            page.insert_image(page.rect, pixmap=scan)
            page = pdf.new_page(width=300, height=500)
            page.draw_rect((20, 40, 140, 120), color=None, fill=(1, 0, 0))
            page.insert_text((20, 200), "A rotated source page", fontsize=12)
            page.set_rotation(90)
            display_box = list(pymupdf.Rect(20, 40, 140, 120) * page.rotation_matrix)
            pages = [{"n": index + 1, "width": item.rect.width, "height": item.rect.height} for index, item in enumerate(pdf)]
            pdf.save(self.pdf_path)
        crop = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2400, 1200), False)
        crop.clear_with(255)
        crop.set_rect(crop.irect, (255, 140, 0))
        crop.save(self.assets / "figures/fig1.png")
        self.doc = {
            "source": {"sha256": hashlib.sha256(self.pdf_path.read_bytes()).hexdigest(), "num_pages": 3},
            "pages": pages,
            "figures": [
                {"id": "fig1", "kind": "figure", "page": 1, "bbox": [40, 100, 300, 300],
                 "caption": "Original figure labels remain legible.", "image": "figures/fig1.png"},
                {"id": "tab1", "kind": "table", "page": 3, "bbox": display_box,
                 "caption": "Rotated table with no precomputed crop.", "image": "figures/tab1.png"},
            ],
        }
        self.write_doc()

    def tearDown(self):
        self.temporary.cleanup()

    def write_doc(self):
        self.doc_path.write_text(json.dumps(self.doc), encoding="utf-8")

    def prepare(self, **kwargs):
        return prepare_images(self.pdf_path, self.doc_path, self.assets, self.out, **kwargs)

    def assert_error(self, code, **kwargs):
        with self.assertRaises(AssetError) as raised:
            self.prepare(**kwargs)
        self.assertEqual(raised.exception.code, code)
        self.assertFalse((self.out / "images.json").exists())

    def test_all_pages_and_figures_are_actual_bounded_jpeg_images(self):
        result = self.prepare()
        self.assertEqual(result, json.loads((self.out / "images.json").read_text()))
        self.assertEqual([item["target_id"] for item in result["images"]], ["page1", "page2", "page3", "fig1", "tab1"])
        self.assertEqual([item["kind"] for item in result["images"]], ["page", "page", "page", "figure", "table"])
        for item in result["images"]:
            self.assertEqual(set(item), {"target_id", "kind", "page", "label", "path", "mime_type"})
            self.assertEqual(item["mime_type"], "image/jpeg")
            self.assertFalse(Path(item["path"]).is_absolute())
            encoded = (self.out / item["path"]).read_bytes()
            self.assertEqual(encoded[:2], b"\xff\xd8")
            pixmap = pymupdf.Pixmap(encoded)
            self.assertLessEqual(max(pixmap.width, pixmap.height), 1280 if item["kind"] == "page" else 1800)
            self.assertGreater(min(pixmap.width, pixmap.height), 0)
        self.assertEqual(result["images"][1]["page"], 2, "The scanned page must not disappear.")
        self.assertIn(self.doc["figures"][0]["caption"], result["images"][3]["label"])

    def test_existing_crop_pixels_are_used_and_resized(self):
        result = self.prepare()
        image = next(item for item in result["images"] if item["target_id"] == "fig1")
        pixmap = pymupdf.Pixmap(self.out / image["path"])
        self.assertEqual((pixmap.width, pixmap.height), (1800, 900))
        red, green, blue = pixmap.pixel(900, 450)
        self.assertGreater(red, 240)
        self.assertGreater(green, 120)
        self.assertLess(blue, 20)

    def test_missing_crop_uses_display_geometry_on_a_rotated_page(self):
        result = self.prepare()
        image = next(item for item in result["images"] if item["target_id"] == "tab1")
        self.assertEqual(image["page"], 3)
        pixmap = pymupdf.Pixmap(self.out / image["path"])
        self.assertEqual((pixmap.width, pixmap.height), (1200, 1800))
        red, green, blue = pixmap.pixel(pixmap.width // 2, pixmap.height // 2)
        self.assertGreater(red, 240)
        self.assertLess(green, 20)
        self.assertLess(blue, 20)

    def test_transparent_crop_margins_are_composited_on_white(self):
        crop = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 100, 100), True)
        crop.clear_with()
        crop.set_rect(pymupdf.IRect(30, 30, 70, 70), (255, 0, 0, 255))
        crop.save(self.assets / "figures/fig1.png")
        result = self.prepare()
        image = next(item for item in result["images"] if item["target_id"] == "fig1")
        pixmap = pymupdf.Pixmap(self.out / image["path"])
        self.assertGreater(min(pixmap.pixel(5, 5)), 240)

    def test_wrong_pdf_hash_is_rejected(self):
        self.doc["source"]["sha256"] = "0" * 64
        self.write_doc()
        self.assert_error("source_mismatch")

    def test_image_count_and_byte_limits_fail_without_partial_manifest(self):
        self.assert_error("resource_limit", max_images=4)
        self.assert_error("resource_limit", max_total_bytes=8)
        self.assertEqual(list(self.out.glob("**/*.jpg")), [])

    def test_page_limit_is_enforced_before_rendering(self):
        self.assert_error("resource_limit", max_pages=2)

    def test_duplicate_targets_and_invalid_page_associations_are_rejected(self):
        original = copy.deepcopy(self.doc)
        for change in ("duplicate", "page", "kind", "geometry", "page_number"):
            with self.subTest(change=change):
                self.doc = copy.deepcopy(original)
                if change == "duplicate":
                    self.doc["figures"][1]["id"] = "fig1"
                elif change == "page":
                    self.doc["figures"][0]["page"] = 9
                elif change == "kind":
                    self.doc["figures"][0]["kind"] = "unknown"
                elif change == "geometry":
                    self.doc["figures"][0]["bbox"] = [-50, 0, 400, 600]
                else:
                    self.doc["pages"][1]["n"] = 1
                self.write_doc()
                self.assert_error("invalid_document")

    def test_asset_path_traversal_and_absolute_paths_are_rejected(self):
        for name in ("../outside.png", "/etc/passwd", "figures/../../outside.png", "C:\\private\\outside.png", "figures/./fig1.png"):
            with self.subTest(path=name):
                self.doc["figures"][0]["image"] = name
                self.write_doc()
                self.assert_error("invalid_asset_path")

    def test_asset_symlink_traversal_is_rejected_even_within_the_root(self):
        (self.assets / "link.png").symlink_to(self.assets / "figures/fig1.png")
        self.doc["figures"][0]["image"] = "link.png"
        self.write_doc()
        self.assert_error("invalid_asset_path")
        (self.assets / "linked-folder").symlink_to(self.assets / "figures", target_is_directory=True)
        self.doc["figures"][0]["image"] = "linked-folder/fig1.png"
        self.write_doc()
        self.assert_error("invalid_asset_path")

    def test_output_symlink_cannot_escape_the_output_directory(self):
        self.out.mkdir()
        outside = self.root / "outside"
        outside.mkdir()
        (self.out / "pages").symlink_to(outside, target_is_directory=True)
        self.assert_error("invalid_asset_path")
        self.assertEqual(list(outside.iterdir()), [])

    def test_cli_logs_only_counts_and_structured_safe_errors(self):
        run = subprocess.run([sys.executable, str(HERE / "tour_assets.py"), str(self.pdf_path), "--doc", str(self.doc_path), "--assets-dir", str(self.assets), "--out", str(self.out)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        summary = json.loads(run.stdout)
        self.assertEqual(set(summary), {"image_count", "bytes"})
        self.assertEqual(summary["image_count"], 5)
        self.assertEqual(run.stderr, "")
        self.assertNotIn("Private scientific", run.stdout)
        self.doc_path.write_text("not JSON")
        bad = subprocess.run([sys.executable, str(HERE / "tour_assets.py"), str(self.pdf_path), "--doc", str(self.doc_path), "--assets-dir", str(self.assets), "--out", str(self.root / "bad")], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertEqual(json.loads(bad.stderr)["code"], "invalid_document")
        self.assertNotIn(str(self.root), bad.stderr)
        missing = subprocess.run([sys.executable, str(HERE / "tour_assets.py")], capture_output=True, text=True)
        self.assertEqual(json.loads(missing.stderr)["code"], "invalid_arguments")


if __name__ == "__main__":
    unittest.main()
