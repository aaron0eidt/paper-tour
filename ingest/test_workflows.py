import tempfile
import unittest
import os
from pathlib import Path
import pymupdf
from workflows import pack, compare, open_pdf, photo


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name, text in [("old", "Rent is 800 EUR. <script>alert(1)</script>"), ("new", "Rent is 850 EUR. <script>alert(2)</script>")]:
            with pymupdf.open() as pdf:
                pdf.new_page().insert_text((40, 60), text)
                pdf.save(self.root / f"{name}.pdf")

    def tearDown(self):
        self.temp.cleanup()

    def test_pack_keeps_original_pages_and_evidence_map(self):
        out = self.root / "pack"
        m = pack([self.root / "old.pdf", self.root / "new.pdf"], out)
        self.assertEqual(m["sources"][1]["first_page"], 2)
        with pymupdf.open(out / "paper.pdf") as pdf:
            self.assertEqual(len(pdf), 2)
            self.assertIn("850", pdf[1].get_text())
            self.assertEqual(len(pdf.get_toc()), 2)
        with self.assertRaises(FileExistsError):
            pack([self.root / "old.pdf", self.root / "new.pdf"], out)

    def test_diff_is_literal_escaped_and_points_to_both_originals(self):
        out = self.root / "diff"
        report = compare(self.root / "old.pdf", self.root / "new.pdf", out)
        self.assertEqual(report["changes"][0]["before"][0]["target"], "page1")
        self.assertEqual(report["changes"][0]["after"][0]["target"], "page2")
        document = (out / "changes.html").read_text()
        self.assertNotIn("<script>", document)
        self.assertIn("&lt;script&gt;", document)
        self.assertIn("<del>", document)
        self.assertIn("<ins>", document)

    def test_empty_and_encrypted_inputs_fail_before_output(self):
        with pymupdf.open(self.root / "old.pdf") as pdf:
            pdf.save(self.root / "locked.pdf", encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="test")
        with self.assertRaises(ValueError): open_pdf(self.root / "locked.pdf")
        with self.assertRaises(ValueError): pack([self.root / "old.pdf"], self.root / "bad")
        self.assertFalse((self.root / "bad").exists())

    @unittest.skipUnless(os.environ.get("TESSDATA_PREFIX"), "Local Tesseract language data not configured")
    def test_photo_ocr_rotation_keeps_image_and_recovers_searchable_text(self):
        with pymupdf.open() as pdf:
            page = pdf.new_page(width=600, height=400)
            page.insert_text((45, 100), "Synthetic deadline 15 November 2026", fontsize=22)
            image = self.root / "photo.png"
            page.get_pixmap(matrix=pymupdf.Matrix(2, 2).prerotate(90)).save(image)
        out = self.root / "ocr"
        photo(image, out, "eng", os.environ["TESSDATA_PREFIX"], 270)
        with pymupdf.open(out / "paper.pdf") as pdf:
            self.assertIn("15 November 2026", pdf[0].get_text())
            self.assertTrue(pdf[0].get_images())
