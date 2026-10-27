"""Synthetic regressions for the worker's public contract and PDF geometry."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import pymupdf

from process import AnalysisError, process_pdf


HERE = Path(__file__).resolve().parent


def paragraph(page, x, y, width=240, lines=5):
    for i in range(lines):
        page.insert_text((x, y + i * 14), "A scientific result needs a careful explanation.", fontsize=10)


def table(page, x, y, width=210, rows=12, number="1"):
    page.insert_text((x, y - 12), f"Table {number}: Experimental results.", fontsize=10)
    page.draw_line((x, y), (x + width, y))
    page.insert_text((x + 4, y + 13), "Method", fontsize=10)
    page.insert_text((x + 125, y + 13), "Score", fontsize=10)
    page.draw_line((x, y + 19), (x + width, y + 19))
    for i in range(rows):
        baseline = y + 34 + i * 14
        page.insert_text((x + 4, baseline), f"Model {i + 1}", fontsize=10)
        page.insert_text((x + 125, baseline), f"{80 + i}.5", fontsize=10)
    bottom = y + 40 + (rows - 1) * 14
    page.draw_line((x, bottom), (x + width, bottom))
    return bottom


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pdf = self.root / "input.pdf"

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, setup=None, pages=1):
        doc = pymupdf.open()
        for _ in range(pages):
            page = doc.new_page(width=600, height=800)
            if setup:
                setup(page)
        doc.save(self.pdf)
        doc.close()

    def run_analysis(self, name="out", **kwargs):
        out = self.root / name
        result = process_pdf(self.pdf, out, **kwargs)
        return result, json.loads((out / "doc.json").read_text()), out

    def test_contract_and_thumbnail(self):
        def setup(page):
            page.insert_text((50, 60), "A readable scientific paper", fontsize=20)
            page.insert_text((50, 110), "1 Introduction", fontsize=13)
            paragraph(page, 50, 140)
        self.save(setup)
        result, doc, out = self.run_analysis()
        self.assertEqual(set(result), {"parser_version", "sha256", "page_count", "title", "warnings", "status", "assets"})
        self.assertEqual(result, json.loads((out / "result.json").read_text()))
        self.assertEqual(doc["source"]["file"], "paper.pdf")
        self.assertEqual(result["sha256"], doc["source"]["sha256"])
        self.assertTrue((out / "thumbnail.png").is_file())
        self.assertTrue(doc["sentences"])
        self.assertEqual(result["status"], "ready")

    def test_scan_is_readable_but_limited(self):
        self.save(lambda p: p.draw_rect((40, 40, 550, 700), color=(0, 0, 0), fill=(0.7, 0.7, 0.7)))
        result, doc, _ = self.run_analysis()
        self.assertEqual(result["status"], "limited")
        self.assertIn("OCR", result["warnings"][0])
        self.assertEqual(doc["sentences"], [])

    def test_invalid_pdf_machine_readable_error(self):
        self.pdf.write_text("not a PDF")
        run = subprocess.run([sys.executable, str(HERE / "process.py"), str(self.pdf), "--out", str(self.root / "out")], capture_output=True, text=True)
        self.assertEqual(run.returncode, 1)
        self.assertEqual(json.loads(run.stderr)["code"], "invalid_pdf")
        self.assertFalse((self.root / "out/result.json").exists())

    def test_page_limit(self):
        self.save(pages=2)
        with self.assertRaises(AnalysisError) as raised:
            self.run_analysis(max_pages=1)
        self.assertEqual(raised.exception.code, "page_limit")

    def test_encrypted_pdf(self):
        doc = pymupdf.open()
        doc.new_page()
        doc.save(self.pdf, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner")
        doc.close()
        with self.assertRaises(AnalysisError) as raised:
            self.run_analysis()
        self.assertEqual(raised.exception.code, "password_required")

    def test_rotation_matches_display_and_mixed_sizes(self):
        def setup(page):
            page.insert_text((50, 70), "Scientific text remains aligned after rotation.", fontsize=12)
            paragraph(page, 50, 110)
        self.save(setup)
        _, unrotated, _ = self.run_analysis("normal")
        changed = self.root / "rotated.pdf"
        with pymupdf.open(self.pdf) as pdf:
            page = pdf[0]
            page.set_rotation(90)
            matrix = pymupdf.Matrix(page.rotation_matrix)
            pdf.new_page(width=420, height=300)
            pdf.save(changed)
        self.pdf = changed
        _, rotated, _ = self.run_analysis("rotated")
        self.assertEqual(rotated["pages"], [{"n": 1, "width": 800.0, "height": 600.0}, {"n": 2, "width": 420.0, "height": 300.0}])
        before = unrotated["blocks"][0]["bbox"]
        expected = [round(n, 2) for n in pymupdf.Rect(before) * matrix]
        self.assertEqual(rotated["blocks"][0]["bbox"], expected)
        for item in rotated["sentences"]:
            for rect in item["rects"]:
                self.assertGreaterEqual(rect[0], 0)
                self.assertLessEqual(rect[2], 800)
                self.assertLessEqual(rect[3], 600)

    def test_roman_smallcaps_headings_and_unpunctuated_table(self):
        def setup(page):
            page.insert_text((80, 60), "A Conference Paper", fontsize=20)
            page.insert_text((50, 110), "I. INTRODUCTION", fontsize=10)
            paragraph(page, 50, 140)
            page.insert_text((50, 240), "II. RELATED WORK", fontsize=10)
            paragraph(page, 50, 270)
            page.insert_text((50, 370), "III. EXPERIMENTS", fontsize=10)
            page.insert_text((50, 410), "TABLE I", fontsize=10)
            page.draw_line((50, 425), (270, 425))
            page.insert_text((55, 440), "Method", fontsize=10)
            page.insert_text((180, 440), "Score", fontsize=10)
            page.draw_line((50, 450), (270, 450))
            page.insert_text((55, 465), "Model", fontsize=10)
            page.insert_text((180, 465), "90.5", fontsize=10)
            page.draw_line((50, 475), (270, 475))
        self.save(setup)
        _, doc, _ = self.run_analysis()
        titles = {section["title"] for section in doc["sections"]}
        self.assertTrue({"INTRODUCTION", "RELATED WORK", "EXPERIMENTS"}.issubset(titles), titles)
        self.assertTrue(any(figure["id"] == "tabI" for figure in doc["figures"]))

    def test_tall_booktabs_keeps_body(self):
        expected = []
        def setup(page):
            paragraph(page, 50, 65)
            expected.append(table(page, 50, 200))
        self.save(setup)
        _, doc, _ = self.run_analysis()
        tab = next(figure for figure in doc["figures"] if figure["id"] == "tab1")
        self.assertGreaterEqual(tab["bbox"][3], expected[0] - 2)
        self.assertGreater(tab["bbox"][3] - tab["bbox"][1], 150)

    def test_two_column_tables_do_not_swallow_neighbor(self):
        def setup(page):
            paragraph(page, 50, 60, lines=10)
            paragraph(page, 330, 60, lines=10)
            table(page, 50, 280, rows=8, number="1")
            table(page, 330, 280, rows=8, number="2")
            paragraph(page, 50, 500, lines=8)
            paragraph(page, 330, 500, lines=8)
        self.save(setup)
        _, doc, _ = self.run_analysis()
        tables = {figure["id"]: figure for figure in doc["figures"]}
        self.assertIn("tab1", tables)
        self.assertIn("tab2", tables)
        self.assertLess(tables["tab1"]["bbox"][2], 300)
        self.assertGreater(tables["tab2"]["bbox"][0], 300)

    def test_existing_analysis_preserves_ids_and_rejects_wrong_source(self):
        self.save(lambda page: paragraph(page, 50, 90))
        _, source_doc, source_out = self.run_analysis("source")
        source_doc["sentences"][0]["id"] = "p1.s999"
        source_doc["blocks"][0]["sentences"][0] = "p1.s999"
        (source_out / "doc.json").write_text(json.dumps(source_doc))
        _, imported, _ = self.run_analysis("imported", existing_doc=source_out / "doc.json")
        self.assertEqual(imported["sentences"][0]["id"], "p1.s999")
        source_doc["source"]["sha256"] = "0" * 64
        (source_out / "doc.json").write_text(json.dumps(source_doc))
        with self.assertRaises(AnalysisError) as raised:
            self.run_analysis("wrong", existing_doc=source_out / "doc.json")
        self.assertEqual(raised.exception.code, "source_mismatch")


if __name__ == "__main__":
    unittest.main()
