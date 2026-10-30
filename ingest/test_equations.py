"""The equation inventory: numbered displays keep their IDs, displays without a number become equ1, equ2, ... in
reading order, and nothing that is not a whole formula does. Synthetic PDFs."""

import unittest
from unittest import mock

import pymupdf

import ingest

WORDS = ("the parser reads every line of the page and groups the lines into blocks so that a reader can follow "
         "the text from one column to the next").split()


def paragraph(page, y, lines=3, x=72, width=468, size=10, pitch=12):
    """Lines of body text from baseline y; returns the y below them."""
    k = 0
    for i in range(lines):
        line = []
        while pymupdf.get_text_length(" ".join(line + [WORDS[k % len(WORDS)]]), fontname="tiro", fontsize=size) <= width:
            line.append(WORDS[k % len(WORDS)])
            k += 1
        page.insert_text((x, y + i * pitch), " ".join(line), fontsize=size, fontname="tiro")
    return y + lines * pitch


def display(page, y, text, x=250, number=None, font="symb"):
    """A display equation set in the symbol font, with its number at the right margin; returns the y below it."""
    page.insert_text((x, y), text, fontsize=10, fontname=font)
    if number:
        page.insert_text((505, y), f"({number})", fontsize=10, fontname="tiro")
    return y + 26


class EquationTests(unittest.TestCase):
    def analyse(self, setup):
        """The equations of a one-page PDF drawn by setup(page)."""
        doc = pymupdf.open()
        setup(doc.new_page(width=612, height=792))
        pdf = pymupdf.open("pdf", doc.tobytes())
        with mock.patch.object(ingest, "warn"):
            pages, _, figures, equations, _ = ingest.analyse(pdf)
        self.pages = pages
        return equations

    def test_numbered_keep_their_ids_and_unnumbered_follow_in_reading_order(self):
        def setup(page):
            y = paragraph(page, 80)
            y = display(page, y + 14, "f(x) = a x + b")
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "y = sin(x) + 1", number="1")
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "g(x) = x - c")
            y = paragraph(page, y + 14)
            display(page, y + 14, "z = f(x) + g(x)", number="2")

        eqs = self.analyse(setup)
        self.assertEqual([(e["id"], e["number"]) for e in eqs],
                         [("equ1", None), ("eq1", "1"), ("equ2", None), ("eq2", "2")])
        self.assertEqual(eqs[0]["text"], "f(x) = a x + b")
        self.assertEqual(eqs[1]["text"], "y = sin(x) + 1")
        for e in eqs:
            self.assertEqual(set(e), {"id", "number", "page", "bbox", "block", "text"})
            self.assertEqual(e["page"], 1)
            self.assertLess(e["bbox"][0], e["bbox"][2])

    def test_numbered_ids_do_not_depend_on_the_unnumbered_displays(self):
        """Adding a display without a number never renames a numbered equation."""
        def numbered(page):
            y = paragraph(page, 80)
            y = display(page, y + 14, "y = sin(x) + 1", number="1")
            y = paragraph(page, y + 14)
            display(page, y + 14, "z = f(x) + g(x)", number="2")

        def with_extra(page):
            y = paragraph(page, 80)
            y = display(page, y + 14, "a = b + c")
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "y = sin(x) + 1", number="1")
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "z = f(x) + g(x)", number="2")
            y = paragraph(page, y + 14)
            display(page, y + 14, "p = q - r")

        before = {e["id"]: e["text"] for e in self.analyse(numbered)}
        after = {e["id"]: e["text"] for e in self.analyse(with_extra) if e["number"]}
        self.assertEqual(before, after)

    def test_fragments_list_items_and_sentences_are_not_equations(self):
        def setup(page):
            y = paragraph(page, 80)
            y = display(page, y + 14, "x =")                         # the start of a bigger display
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "(i) X = I and y = (1, 2)", x=120)   # a list item
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "the end of this chapter is here", font="tiro")   # an indented sentence
            y = paragraph(page, y + 14)
            y = display(page, y + 14, "a + b + c")                    # no relation
            y = paragraph(page, y + 14)
            display(page, y + 14, "((a + b) = c", x=250)             # brackets that do not close

        self.assertEqual(self.analyse(setup), [])

    def test_pieces_of_a_numbered_display_are_not_extra_equations(self):
        """A fraction set in three stacked lines and its number are one equation."""
        def setup(page):
            y = paragraph(page, 80)
            page.insert_text((250, y + 14), "a", fontsize=10, fontname="symb")
            page.insert_text((290, y + 14), "=", fontsize=10, fontname="symb")
            page.insert_text((312, y + 6), "b + c", fontsize=10, fontname="symb")
            page.insert_text((312, y + 24), "d", fontsize=10, fontname="symb")
            page.insert_text((505, y + 14), "(7)", fontsize=10, fontname="tiro")
            paragraph(page, y + 50)

        eqs = self.analyse(setup)
        self.assertEqual([e["id"] for e in eqs], ["eq7"])

    def test_adjacent_lines_of_one_system_are_one_equation(self):
        def setup(page):
            y = paragraph(page, 80)
            page.insert_text((230, y + 14), "PE(a) = sin(a)", fontsize=10, fontname="symb")
            page.insert_text((230, y + 28), "PE(b) = cos(b)", fontsize=10, fontname="symb")
            paragraph(page, y + 60)

        eqs = self.analyse(setup)
        self.assertEqual([e["id"] for e in eqs], ["equ1"])
        self.assertIn("sin", eqs[0]["text"])
        self.assertIn("cos", eqs[0]["text"])


class RelationTests(unittest.TestCase):
    def test_looks_like_equation(self):
        yes = ["f(x) = a x + b", "x1 + 2x2 = 5, 3x1 + 4x2 = 6", "α0 = αL2,", "y ≈ x^2 + 1.", "S ∼ N(0, 1)"]
        no = ["x =", "= 5", "a + b + c", "(a + b = c", "(i) X = I and y = (1, 2)", "a) x = 2 and y = 3",
              "we then find the answer is equal to this", "x"]
        for text in yes:
            with self.subTest(text):
                self.assertTrue(ingest.looks_like_equation(text, 1), text)
        for text in no:
            with self.subTest(text):
                self.assertFalse(ingest.looks_like_equation(text, 1), text)

    def test_a_display_with_many_unmapped_glyphs_is_not_an_equation(self):
        self.assertFalse(ingest.looks_like_equation("���� = x�", 1))


if __name__ == "__main__":
    unittest.main()
