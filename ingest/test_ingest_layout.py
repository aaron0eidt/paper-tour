"""Layout regressions for review findings L1-1, L1-2 and L1-7, on synthetic PDFs."""

import unittest
from unittest import mock

import pymupdf

import ingest

WORDS = ("the parser reads every line of the page and groups the lines into blocks so that a "
         "reader can follow the text from one column to the next").split()


def column_text(page, x, y, width, n, size=10, pitch=12, font="tiro"):
    """n lines of body text filling a column from baseline y; returns the baseline after them."""
    k = 0
    for i in range(n):
        line = []
        while pymupdf.get_text_length(" ".join(line + [WORDS[k % len(WORDS)]]), fontname=font, fontsize=size) <= width:
            line.append(WORDS[k % len(WORDS)])
            k += 1
        page.insert_text((x, y + i * pitch), " ".join(line), fontsize=size, fontname=font)
    return y + n * pitch


def centred(page, x0, x1, y, text, size=10, font="tiro"):
    w = pymupdf.get_text_length(text, fontname=font, fontsize=size)
    page.insert_text(((x0 + x1 - w) / 2, y), text, fontsize=size, fontname=font)


def booktabs(page, x0, x1, y, rows, number="1", caption=True, size=9):
    """A booktabs table (top, mid and bottom rule) below its caption; returns the bottom rule's y."""
    if caption:
        page.insert_text((x0, y - 8), f"Table {number}: Results of the study.", fontsize=size)
    cols = [x0 + 4] + [x0 + (x1 - x0) * f for f in (0.4, 0.6, 0.8)]
    for cx, t in zip(cols, ["Query", "Total", "Max.", "Gain"]):
        page.insert_text((cx, y + 11), t, fontsize=size)
    for i in range(rows):
        for cx, t in zip(cols, [f"q{i + 1}", f"2,{268 + i}", f"{332 + i}", f"{i}.5"]):
            page.insert_text((cx, y + 27 + 12 * i), t, fontsize=size)
    bottom = y + 21 + 12 * rows
    for yy, h in ((y, 0.8), (y + 15, 0.5), (bottom, 0.8)):
        page.draw_rect(pymupdf.Rect(x0, yy, x1, yy + h), color=None, fill=(0, 0, 0))
    return bottom


def plot(page, x0, x1, top, title=False, number="6"):
    """A matplotlib-style plot: four separate spines, grid lines, a curve, a legend and a caption
    below. Returns the y of the bottom spine."""
    if title:
        page.insert_text((x0 + 60, top + 6), "Run time per query", fontsize=8)
        top += 14
    bot = top + 80
    for a, b in (((x0, top), (x1, top)), ((x0, bot), (x1, bot)), ((x0, top), (x0, bot)), ((x1, top), (x1, bot))):
        page.draw_line(a, b, color=(0, 0, 0), width=0.6)
    for k in (1, 2, 3):
        page.draw_line((x0, top + 20 * k), (x1, top + 20 * k), color=(0.8, 0.8, 0.8), width=0.4)
    page.draw_polyline([(x0 + 10, bot - 7), (x0 + 60, bot - 32), (x0 + 110, bot - 42), (x1 - 10, bot - 62)],
                       color=(1, 0, 0))
    page.draw_line((x0 + 32, top + 8), (x0 + 49, top + 8), color=(0, 0, 1), width=0.8)
    page.insert_text((x0 + 53, top + 11), "SkinnerDB", fontsize=7)
    page.insert_text((x0 - 21, bot + 14), f"Figure {number}: Run time of the system.", fontsize=9)
    return bot


class LayoutTests(unittest.TestCase):
    def analyse(self, setup):
        """Build a one-page PDF with setup(page); returns (pages, sections, figures by id)."""
        doc = pymupdf.open()
        setup(doc.new_page(width=612, height=792))
        pdf = pymupdf.open("pdf", doc.tobytes())
        self.warnings = []
        with mock.patch.object(ingest, "warn", self.warnings.append):
            pages, sections, figures, _, _ = ingest.analyse(pdf)
        return pages, sections, {f["id"]: f for f in figures}

    def test_tall_booktabs_table_keeps_every_row(self):
        """L1-1: rules of the same extent link across a body taller than 90pt."""
        def setup(page):
            y = column_text(page, 60, 60, 480, 10)
            bottom = booktabs(page, 120, 480, y + 30, rows=10)
            column_text(page, 60, bottom + 30, 480, 8)
        pages, _, figures = self.analyse(setup)
        rows = [b for b in pages[0].ordered if b.raw_text.startswith("q")]
        self.assertEqual(len(rows), 10)
        self.assertEqual({b.type for b in rows}, {"table_text"})
        self.assertGreaterEqual(figures["tab1"]["bbox"][3], max(b.bbox[3] for b in rows))

    def test_side_by_side_tables_without_a_gutter_keep_apart(self):
        """L1-2: a page with no body text has no detected gutter; each table keeps its own text."""
        def setup(page):
            booktabs(page, 54, 300, 110, rows=4, number="4")
            booktabs(page, 319, 557, 110, rows=4, number="6")
        pages, _, figures = self.analyse(setup)
        self.assertIsNone(pages[0].gutter)
        self.assertLessEqual(figures["tab4"]["bbox"][2], 310)
        self.assertGreaterEqual(figures["tab6"]["bbox"][0], 310)
        for b in pages[0].ordered:
            if b.type == "table_text":
                self.assertTrue(b.bbox[2] <= 310 or b.bbox[0] >= 310, b.raw_text)

    def test_plot_under_a_table_stays_a_figure(self):
        """L1-2: the spines and grid lines of a plot right under a table are not table rules."""
        for title in (False, True):
            with self.subTest(title=title):
                at = {}

                def setup(page):
                    column_text(page, 54, 72, 246, 40)
                    y = column_text(page, 312, 72, 246, 6)
                    at["bottom"] = booktabs(page, 319, 557, y + 40, rows=4, number="6")
                    end = plot(page, 340, 540, at["bottom"] + 12, title=title)
                    column_text(page, 312, end + 40, 246, 8)
                _, _, figures = self.analyse(setup)
                self.assertLessEqual(figures["tab6"]["bbox"][3], at["bottom"] + 2)
                self.assertIn("fig6", figures, self.warnings)
                self.assertGreater(figures["fig6"]["bbox"][1], at["bottom"])

    def test_ieee_headings_abstract_and_table_caption(self):
        """L1-7: roman sections in capitals, italic lettered subsections, REFERENCES at body size,
        a run-in abstract, and a table caption whose text sits under its "TABLE I" label."""
        def setup(page):
            centred(page, 54, 558, 72, "A Synthetic Conference Paper", size=24)
            centred(page, 54, 558, 100, "Jane Doe and John Roe", size=11)
            page.insert_text((54, 140), "Abstract—We study how a parser reads a page.", fontsize=9, fontname="tibo")
            y = column_text(page, 54, 151, 246, 5, size=9, pitch=10.5, font="tibo")
            centred(page, 54, 300, y + 20, "I. INTRODUCTION")
            y = column_text(page, 54, y + 38, 246, 10)
            centred(page, 54, 300, y + 20, "II. RELATED WORK")
            y = column_text(page, 54, y + 38, 246, 8)
            # a subsection line only 14pt above its text joins it unless it is kept apart
            page.insert_text((54, y + 18), "A. Overview", fontsize=10, fontname="tiit")
            y = column_text(page, 54, y + 32, 246, 8)
            page.insert_text((54, y + 18), "B. Training Details", fontsize=10, fontname="tiit")
            column_text(page, 54, y + 32, 246, 6)
            centred(page, 312, 558, 150, "TABLE I", size=8)
            centred(page, 312, 558, 160, "RESULTS ON THE BENCHMARK", size=6.5)
            y = column_text(page, 312, booktabs(page, 340, 530, 168, rows=3, caption=False, size=8) + 30, 246, 20)
            centred(page, 312, 558, y + 20, "REFERENCES")
            page.insert_text((312, y + 36), "[1] A. Author and B. Writer, A study of things, 2020.", fontsize=8)
        pages, sections, figures = self.analyse(setup)
        self.assertEqual([(s["id"], s["level"]) for s in sections],
                         [("sec-i", 1), ("sec-ii", 1), ("sec-ii.a", 2), ("sec-ii.b", 2), ("sec-references", 1)])
        self.assertEqual([s["title"] for s in sections][2:4], ["Overview", "Training Details"])
        abstract = next(b for b in pages[0].ordered if b.raw_text.startswith("Abstract"))
        self.assertEqual(abstract.type, "paragraph")
        self.assertIn("RESULTS ON THE BENCHMARK", figures["tabI"]["caption"])


if __name__ == "__main__":
    unittest.main()
