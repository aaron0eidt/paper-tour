"""Documents that are no papers and no exercise sheets (manuals, reports, leaflets, recipes, forms, stories): the
front matter, tables and drawings without a caption, running heads, margin line numbers, figure numbers like 8.1,
columns of different heights and form labels, on synthetic PDFs."""

import re
import unittest
from unittest import mock

import pymupdf

import ingest
from test_ingest_layout import booktabs, column_text, plot

WORDS = ("the machine heats the water and the pump presses it through the coffee so that a cup of coffee is ready "
         "after a minute").split()


def write(page, x, y, text, size=10, font="tiro"):
    page.insert_text((x, y), text, fontsize=size, fontname=font)


def prose(page, x, y, width, lines, size=10, pitch=12):
    """Justified-looking body text from baseline y down; returns the baseline after it."""
    return column_text(page, x, y, width, lines, size=size, pitch=pitch)


def analyse(*setups, size=(595, 842)):
    """One page per setup function; returns (pages, figures by id, the whole result)."""
    doc = pymupdf.open()
    for setup in setups:
        setup(doc.new_page(width=size[0], height=size[1]))
    pdf = pymupdf.open("pdf", doc.tobytes())
    with mock.patch.object(ingest, "warn", lambda message: None):
        result = ingest.analyse(pdf)
    pages, _, figures, _, _ = result
    return pages, {f["id"]: f for f in figures}, result


def kind_of(page, start):
    return next(b.type for b in page.ordered if b.text.startswith(start))


def front_page(page, between):
    """A title, whatever sits between it and the first heading, and then a heading with a paragraph."""
    write(page, 72, 100, "Notes on the Parcel Service", size=24, font="tibo")
    y = between(page) if between else 130
    write(page, 72, y + 40, "1. First section", size=13, font="tibo")
    prose(page, 72, y + 62, 450, 6)


class FrontMatterTests(unittest.TestCase):
    """2.5: only a real author block is `authors`."""

    def test_a_subtitle_a_box_and_a_contents_list_are_text(self):
        def between(page):
            write(page, 72, 124, "A short note, written for testing", size=12, font="tiit")
            write(page, 72, 158, "Read this first. Keep the leaflet for later.", size=10, font="tibo")
            write(page, 80, 174, "• Ask your doctor if you have questions.")
            write(page, 72, 204, "What is in this leaflet", size=10, font="tibo")
            write(page, 72, 220, "1. What the medicine is")
            write(page, 72, 234, "2. How to take the medicine")
            return 250

        pages, _, _ = analyse(lambda p: front_page(p, between))
        page = pages[0]
        self.assertNotIn("authors", {b.type for b in page.ordered})
        by = {b.text[:12]: b for b in page.ordered}
        self.assertEqual(by["A short note"].type, "paragraph")
        self.assertEqual(by["Read this fi"].type, "paragraph")
        self.assertTrue(by["Read this fi"].sentences, "text before the first section has sentences a tour can mark")
        self.assertEqual(by["1. What the "].type, "paragraph")

    def test_a_heading_before_the_first_section_stays_a_heading(self):
        def between(page):
            write(page, 72, 130, "FEATURES", size=13, font="tibo")
            write(page, 72, 146, "• Linear output of 10 mV per degree")
            return 160

        pages, _, _ = analyse(lambda p: front_page(p, between))
        self.assertEqual(kind_of(pages[0], "FEATURES"), "heading")

    def test_authors_affiliations_and_addresses_are_authors(self):
        def between(page):
            write(page, 72, 124, "Jane Doe and John Roe", size=11)
            write(page, 72, 138, "Department of Physics, University of Somewhere", size=9)
            write(page, 72, 150, "jane.doe@somewhere.example", size=9)
            return 160

        pages, _, _ = analyse(lambda p: front_page(p, between))
        front = [b for b in pages[0].ordered if b.type not in ("title", "heading") and b.bbox[1] < 170]
        self.assertEqual({b.type for b in front}, {"authors"})
        self.assertEqual(len(front), 2, "the names, then the institution and the address")

    def test_a_table_of_document_data_is_no_author_block(self):
        """An e-mail address in a block that is also a date and a body is no author line."""
        def between(page):
            write(page, 72, 124, "Approved by", size=8, font="tibo")
            write(page, 72, 136, "Executive Board", size=10)
            write(page, 72, 148, "1 December 2027", size=10)
            write(page, 72, 160, "security@example.example", size=10)
            return 168

        pages, _, _ = analyse(lambda p: front_page(p, between))
        self.assertNotIn("authors", {b.type for b in pages[0].ordered})

    def front_types(self, rows, font="tiro", size=10):
        """The types of the blocks that rows (one printed line each) make between a title and the first section."""
        def between(page):
            for k, row in enumerate(rows):
                write(page, 72, 124 + 12 * k, row, size=size, font=font)
            return 130 + 12 * len(rows)

        pages, _, _ = analyse(lambda p: front_page(p, between))
        return [b.type for b in pages[0].ordered if b.type != "title" and b.bbox[1] < 124 + 12 * len(rows)]

    def test_addresses_degrees_footnote_numbers_and_capitals_are_authors(self):
        for rows in (["Jane Doe and John Roe", "Department of Physics, University of Somewhere", "Berlin, Germany",
                      "jane.doe@somewhere.example"],
                     ["Jane Doe", "Example Street 5, 10115 Berlin"],
                     ["jane.doe@somewhere.example", "Berlin, Germany"],                       # the e-mail address comes first
                     ["Jane Doe1,2, John Roe2 and Ann Lee1"],
                     ["Jane Doe, MD, and John Roe, PhD"],
                     ["Prof. Dr. John Q. Roe, MSc"],
                     ["JANE DOE AND JOHN ROE"]):
            with self.subTest(rows=rows):
                self.assertEqual(set(self.front_types(rows)), {"authors"})

    def test_a_row_after_the_names_must_still_look_like_an_address(self):
        for rows in (["Jane Doe", "Note: handle with care"],                                  # a label
                     ["Jane Doe", "Read this before you start."],                              # a sentence
                     ["Jane Doe", "3 May 2027"],                                               # a date
                     ["Jane Doe", "Example Street Number Five In The Old Quarter Of Berlin"]):   # too long for an address
            with self.subTest(rows=rows):
                self.assertNotIn("authors", self.front_types(rows))

    def test_a_heading_in_capitals_is_no_author_line(self):
        """The names of a person in capitals are authors; two capital words set as a heading are a heading."""
        self.assertEqual(self.front_types(["GENERAL DESCRIPTION"], font="tibo", size=13), ["heading"])
        self.assertEqual(set(self.front_types(["JANE DOE AND JOHN ROE"], font="tibo", size=13)), {"heading"})

    def test_what_is_a_person_name(self):
        for text in ("Rainer Maria Rilke", "J. R. R. Tolkien", "Ludwig van Beethoven", "Jane Doe¹", "Dr. Jane Doe"):
            self.assertTrue(ingest.is_person_name(text), text)
        for text in ("The Panther", "Zum Autor", "Im Jardin des Plantes", "Wirkstoff: Probanol", "Jane", "GENERAL DESCRIPTION"):
            self.assertFalse(ingest.is_person_name(text), text)
        self.assertTrue(ingest.is_person_name("JANE DOE", caps=True))
        self.assertFalse(ingest.is_person_name("The Panther", caps=True))

    def test_a_paper_keeps_every_line_before_its_abstract_as_authors(self):
        def between(page):
            write(page, 72, 124, "A subtitle that is no author", size=12, font="tiit")
            write(page, 72, 146, "Abstract", size=10, font="tibo")
            write(page, 72, 160, "We study how a parser reads a page.", size=10)
            return 170

        pages, _, _ = analyse(lambda p: front_page(p, between))
        self.assertEqual(kind_of(pages[0], "A subtitle"), "authors")


class RunningHeadTests(unittest.TestCase):
    """2.6 and 2.2: running heads on a two-page document, a title that repeats the head, numbers in the middle."""

    def head_and_foot(self, page, number, bare=False):
        write(page, 72, 40, "Quarterly Note", size=9, font="tibo")
        write(page, 480, 40, "Harbour Authority", size=9)
        write(page, 290, 820, str(number) if bare else f"Page {number}", size=8)

    def test_a_two_page_document_has_its_running_head_on_both_pages(self):
        def page1(page):
            self.head_and_foot(page, 1)
            write(page, 72, 110, "Quarterly Note", size=24, font="tibo")
            write(page, 72, 160, "1. Overview", size=13, font="tibo")
            prose(page, 72, 182, 450, 8)

        def page2(page):
            self.head_and_foot(page, 2)
            write(page, 72, 110, "2. Outlook", size=13, font="tibo")
            prose(page, 72, 132, 450, 8)

        pages, _, _ = analyse(page1, page2)
        self.assertEqual(kind_of(pages[0], "Quarterly Note"), "header_footer")      # the head itself, in the margin
        self.assertEqual([b.type for b in pages[1].ordered[:2]], ["header_footer"] * 2)
        title = [b for b in pages[0].ordered if b.type == "title"]
        self.assertEqual([b.text for b in title], ["Quarterly Note"], "the title repeats the head but stays the title")

    def test_a_paper_keeps_a_title_that_repeats_its_running_head(self):
        def setup(n):
            def page(p):
                write(p, 72, 40, "A Study of Parsers", size=9)
                write(p, 290, 820, str(n), size=8)
                if n == 1:
                    write(p, 72, 110, "A Study of Parsers", size=24, font="tibo")
                    write(p, 72, 150, "Abstract", size=10, font="tibo")
                    prose(p, 72, 166, 450, 3)
                prose(p, 72, 260, 450, 8)
            return page

        pages, _, _ = analyse(setup(1), setup(2), setup(3))
        self.assertEqual([b.type for b in pages[0].ordered if b.text == "A Study of Parsers"], ["header_footer", "title"])

    def test_a_number_in_the_middle_of_a_page_is_no_page_number(self):
        def setup(n):
            def page(p):
                self.head_and_foot(p, n, bare=True)       # the bare page numbers make "#" a running text
                write(p, 72, 110, "1. Figures" if n == 1 else f"{n}. Notes", size=13, font="tibo")
                prose(p, 72, 132, 450, 4)
                if n == 1:
                    write(p, 300, 300, "2023", size=10)
                    write(p, 400, 300, "312", size=10)
                prose(p, 72, 340, 450, 4)
            return page

        pages, _, _ = analyse(setup(1), setup(2), setup(3))
        self.assertEqual(kind_of(pages[0], "2023"), "other")
        self.assertEqual(kind_of(pages[0], "312"), "other")
        self.assertEqual([b.type for b in pages[0].ordered if b.bbox[1] > 800], ["header_footer"])


    def test_a_number_in_the_middle_of_a_paper_page_is_no_page_number_either(self):
        """The bare page numbers repeat on every page of a paper too; a table cell with a number is not one of them."""
        def setup(n):
            def page(p):
                self.head_and_foot(p, n, bare=True)
                if n == 1:
                    write(p, 72, 110, "Abstract", size=10, font="tibo")
                    prose(p, 72, 124, 450, 2)
                write(p, 72, 180, "1. Figures" if n == 1 else f"{n}. Notes", size=13, font="tibo")
                prose(p, 72, 202, 450, 4)
                if n == 1:
                    write(p, 300, 300, "2023", size=10)
                    write(p, 400, 300, "312", size=10)
                prose(p, 72, 340, 450, 4)
            return page

        pages, _, _ = analyse(setup(1), setup(2), setup(3))
        self.assertEqual(kind_of(pages[0], "2023"), "other")
        self.assertEqual(kind_of(pages[0], "312"), "other")
        self.assertEqual([b.type for b in pages[0].ordered if b.bbox[1] > 800], ["header_footer"])

    def test_a_line_above_the_title_is_a_notice_only_in_the_margin_or_in_a_paper(self):
        """The name of a service or the date of a version, set above the title in the page body, is text a tour can read."""
        def setup(paper, y):
            def page(p):
                write(p, 72, y, "Effective 1 May 2027", size=9)
                write(p, 72, 150, "Terms of Service", size=24, font="tibo")
                if paper:
                    write(p, 72, 200, "Abstract", size=10, font="tibo")
                    prose(p, 72, 214, 450, 2)
                write(p, 72, 280, "1. Scope", size=13, font="tibo")
                prose(p, 72, 302, 450, 6)
            return page

        for paper, y, expected in ((False, 110, "paragraph"), (False, 50, "header_footer"), (True, 110, "header_footer")):
            with self.subTest(paper=paper, y=y):
                pages, _, _ = analyse(setup(paper, y))
                self.assertEqual(kind_of(pages[0], "Effective"), expected)


class LineNumberTests(unittest.TestCase):
    """2.7: numbers set in the margin of a story or a poem."""

    def page(self, numbers, x=60):
        def setup(page):
            prose(page, 90, 100, 430, 18)
            for k in numbers:
                write(page, x, 100 + 12 * (k - 1), str(5 * k), size=7)
        return setup

    def test_margin_numbers_stay_out_of_the_sentences(self):
        pages, _, _ = analyse(self.page([5, 10, 15]))
        text = " ".join(s["text"] for s in pages[0].sentences)
        for number in ("25", "50", "75"):
            self.assertNotIn(number, text)
        self.assertEqual([b.type for b in pages[0].ordered], ["paragraph"])
        self.assertGreaterEqual(pages[0].ordered[0].bbox[0], 89)

    def test_numbers_that_do_not_count_up_are_left_alone(self):
        """Two numbers, or numbers with no step, are no line numbering: nothing is dropped."""
        pages, _, _ = analyse(self.page([5, 10]))
        self.assertIn("25", " ".join(b.text for b in pages[0].ordered))
        pages, _, _ = analyse(self.page([2, 3, 9]))
        self.assertIn("10", " ".join(b.text for b in pages[0].ordered))


class FigureNumberTests(unittest.TestCase):
    """2.8: Figure 8.1 and Figure 8.2 are two figures."""

    def test_dotted_numbers_are_read_whole(self):
        def setup(page):
            prose(page, 72, 80, 450, 4)
            plot(page, 150, 450, 120, number="8.1")
            write(page, 72, 260, "Figure 8.2 shows the same run again, and Figure 8.1 the first.")
            plot(page, 150, 450, 330, number="8.2")
            prose(page, 72, 460, 450, 4)

        pages, figures, _ = analyse(setup)
        self.assertEqual(sorted(figures), ["fig81", "fig82"])
        self.assertEqual([figures[k]["number"] for k in sorted(figures)], ["8.1", "8.2"])
        self.assertEqual(len(figures["fig82"]["referenced_by"]), 1)
        self.assertEqual(len(figures["fig81"]["referenced_by"]), 1)
        # the IDs are valid in doc.json (schema pattern ^(fig|tab)[0-9A-Za-z]+$) and their panels are named after them
        self.assertTrue(all(re.fullmatch(r"(fig|tab)[0-9A-Za-z]+", k) for k in figures))

    def test_a_plain_number_and_a_sentence_end_are_unchanged(self):
        self.assertEqual(ingest.CAPTION_RE.match("Figure 3. Overview of the system").group(2), "3")
        self.assertEqual(ingest.CAPTION_RE.match("Figure 8.1. Structure").group(2), "8.1")
        self.assertEqual(ingest.CAPTION_RE.match("Table 2: Results").group(2), "2")
        self.assertIsNone(ingest.CAPTION_RE.match("Figure 8.1 shows the structure"))
        self.assertEqual(ingest.FIG_REF_RE.search("as in Figure 2. Then").group(2), "2")
        self.assertEqual(ingest.FIG_REF_RE.search("see Fig. 8.2.").group(2), "8.2")
        self.assertEqual(ingest._expand_numbers("8.1-8.3"), ["8.1", "8.2", "8.3"])
        self.assertEqual(ingest._expand_numbers("1-3"), ["1", "2", "3"])

    def test_figure_81_next_to_figure_8_1_gets_a_valid_id_of_its_own(self):
        def setup(page):
            prose(page, 72, 60, 450, 3)
            plot(page, 150, 450, 100, number="81")
            plot(page, 150, 450, 260, number="8.1")
            prose(page, 72, 420, 450, 3)

        _, figures, _ = analyse(setup)
        self.assertEqual(sorted(figures), ["fig81", "fig8d1"])
        self.assertEqual([figures[k]["number"] for k in sorted(figures)], ["81", "8.1"])
        self.assertTrue(all(re.fullmatch(r"(fig|tab)[0-9A-Za-z]+", k) for k in figures))

    def test_numbers_of_three_levels_are_captions_too(self):
        self.assertEqual(ingest.CAPTION_RE.match("Figure 4.2.1: Pressure curve").group(2), "4.2.1")
        self.assertEqual(ingest.CAPTION_RE.match("Fig. 3.2.1. Results").group(2), "3.2.1")
        self.assertEqual(ingest.CAPTION_RE.match("Table 4.2.2: Settings").group(2), "4.2.2")
        self.assertIsNone(ingest.CAPTION_RE.match("Figure 4.2.1 shows the curve"))
        self.assertEqual(ingest.FIG_REF_RE.search("see Fig. 3.2.1.").group(2), "3.2.1")
        self.assertEqual(ingest.FIG_REF_RE.search("as in Figure 2. Then").group(2), "2")
        self.assertEqual(ingest._expand_numbers("4.2.1-4.2.3"), ["4.2.1", "4.2.2", "4.2.3"])

        def setup(abstract):
            def page_setup(page):
                if abstract:
                    write(page, 72, 60, "Abstract", size=10, font="tibo")
                    prose(page, 72, 74, 450, 2)
                prose(page, 72, 110, 450, 3)
                write(page, 72, 170, "Figure 4.2.1 and Table 4.2.2 give the numbers.")
                plot(page, 150, 450, 190, number="4.2.1")
                booktabs(page, 100, 480, 340, 3, number="4.2.2")
                prose(page, 72, 440, 450, 3)
            return page_setup

        for abstract in (False, True):
            pages, figures, _ = analyse(setup(abstract))
            self.assertEqual(sorted(figures), ["fig421", "tab422"], abstract)
            self.assertEqual([figures[k]["number"] for k in sorted(figures)], ["4.2.1", "4.2.2"])
            self.assertEqual(len(figures["fig421"]["referenced_by"]), 1)
            self.assertEqual(len(figures["tab422"]["referenced_by"]), 1)


class LooseFigureTests(unittest.TestCase):
    """2.1 and 2.4: tables and drawings without a caption, in a document that is no paper."""

    def table_page(self, paper=False):
        def setup(page):
            write(page, 72, 90, "Laboratory notes", size=22, font="tibo")
            write(page, 72, 130, "1. Results", size=13, font="tibo")
            y = prose(page, 72, 152, 450, 4)
            if paper:
                write(page, 72, 120, "Abstract", size=10, font="tibo")
            booktabs(page, 100, 480, y + 30, rows=5, caption=False)
            prose(page, 72, y + 140, 450, 4)
            if paper:
                write(page, 72, 700, "References", size=13, font="tibo")
                write(page, 72, 716, "[1] A. Author, A study of things, 2020.")
        return setup

    def test_an_uncaptioned_table_is_read_row_by_row(self):
        pages, figures, _ = analyse(self.table_page())
        self.assertEqual(list(figures), ["tab1"])
        self.assertEqual(figures["tab1"]["kind"], "table")
        self.assertEqual(figures["tab1"]["caption"], "Table on page 1")
        rows = [b.text for b in pages[0].ordered if b.type == "table_text"]
        self.assertEqual(len(rows), 6)
        self.assertEqual(rows[0], "Query Total Max. Gain")
        self.assertEqual(rows[1], "q1 2,268 332 0.5")
        self.assertNotIn("grid", figures["tab1"], "a table without a caption keeps its rows as text, no typed grid")

    def test_a_table_on_a_page_with_little_else_is_found(self):
        """Its columns of long text pass for the two columns of a page, and the rows of the first for body text."""
        names = ("Mean cell haemoglobin concentration", "Aspartate aminotransferase (AST)", "Thyroid-stimulating hormone (TSH)",
                 "Alanine aminotransferase (ALT)", "Estimated glomerular filtration", "Mean cell volume (MCV) in fL",
                 "White blood cell count (WBC)", "Red blood cell count (RBC)", "Haemoglobin concentration (Hb)",
                 "Platelet count in the blood")

        def setup(page):
            write(page, 72, 90, "Laboratory report", size=22, font="tibo")
            write(page, 72, 140, "Results", size=13, font="tibo")
            for yy, h in ((170, 0.8), (186, 0.5), (186 + 12 * len(names) + 6, 0.8)):
                page.draw_rect(pymupdf.Rect(72, yy, 520, yy + h), color=None, fill=(0, 0, 0))
            for x, t in ((74, "Test"), (330, "Reference range and flag")):
                write(page, x, 181, t, size=9, font="tibo")
            for k, name in enumerate(names):
                write(page, 74, 201 + 12 * k, name, size=9)
                write(page, 330, 201 + 12 * k, f"Normal range {k + 1}.0 to {k + 5}.0 for adults", size=9)

        pages, figures, _ = analyse(setup)
        self.assertEqual(list(figures), ["tab1"])
        self.assertIn("Platelet count in the blood Normal range 10.0 to 14.0 for adults",
                      [b.text for b in pages[0].ordered])

    def test_shaded_cells_of_a_table_are_no_drawing(self):
        """Empty shaded cells (no text inside) in a table are three bars, which only a drawing outside a table may have."""
        def setup(page):
            write(page, 72, 90, "Laboratory notes", size=22, font="tibo")
            write(page, 72, 130, "1. Results", size=13, font="tibo")
            y = prose(page, 72, 152, 450, 4)
            bottom = booktabs(page, 100, 480, y + 30, rows=5, caption=False)
            for k in range(3):                                   # cells with nothing to report, shaded grey
                top = y + 30 + 16 + 12 * (k + 1)
                page.draw_rect(pymupdf.Rect(435, top - 8, 475, top + 3), color=None, fill=(0.85, 0.85, 0.85))
            prose(page, 72, bottom + 40, 450, 4)

        _, figures, _ = analyse(setup)
        self.assertEqual(list(figures), ["tab1"])

    def test_a_paper_has_no_uncaptioned_tables(self):
        _, figures, _ = analyse(self.table_page(paper=True))
        self.assertEqual(figures, {})

    def test_a_drawing_with_callouts_is_a_figure_with_its_numbers(self):
        def setup(page):
            write(page, 72, 90, "Machine manual", size=22, font="tibo")
            write(page, 72, 130, "1. Overview", size=13, font="tibo")
            y = prose(page, 72, 152, 450, 3)
            top = y + 30
            page.draw_rect(pymupdf.Rect(200, top, 400, top + 120), color=(0.3, 0.3, 0.3), fill=(0.8, 0.8, 0.8))
            page.draw_rect(pymupdf.Rect(220, top + 20, 300, top + 50), color=(0, 0.4, 0), fill=(0.8, 1, 0.8))
            page.draw_circle((350, top + 60), 18, color=(0.3, 0.3, 0.3), fill=(0.9, 0.9, 0.9))
            for k, (x, dy) in enumerate(((160, 10), (160, 60), (440, 30), (440, 90))):
                page.draw_line((x + 8, top + dy), (200 if x < 300 else 400, top + dy + 6), color=(0.5, 0, 0), width=0.8)
                page.draw_circle((x, top + dy), 9, color=(0.5, 0, 0), fill=(0.5, 0.2, 0.1))
                write(page, x - 3, top + dy + 3.5, str(k + 1), size=9, font="tibo")
            prose(page, 72, top + 170, 450, 3)

        pages, figures, _ = analyse(setup)
        self.assertEqual(list(figures), ["fig1"])
        labels = sorted(b.text for b in pages[0].ordered if b.type == "figure_text")
        self.assertEqual(labels, ["1", "2", "3", "4"])
        self.assertEqual([b.type for b in pages[0].ordered if b.text in {"1", "2", "3", "4"}], ["figure_text"] * 4)

    def test_a_bar_chart_without_a_caption_is_a_figure_with_its_labels(self):
        """Filled bars and two axis lines have no image and no curve: three bars or more make the drawing."""
        def setup(page):
            write(page, 72, 90, "Annual report", size=22, font="tibo")
            write(page, 72, 130, "1. Revenue", size=13, font="tibo")
            y = prose(page, 72, 152, 450, 4)
            x0, y1 = 150, y + 180
            page.draw_line((x0, y1), (450, y1), color=(0, 0, 0), width=0.8)
            page.draw_line((x0, y1 - 150), (x0, y1), color=(0, 0, 0), width=0.8)
            for k, v in enumerate((60, 95, 120, 80, 140)):
                bx = x0 + 20 + 55 * k
                page.draw_rect(pymupdf.Rect(bx, y1 - v, bx + 30, y1), color=None, fill=(0.2, 0.4, 0.8))
                write(page, bx + 5, y1 + 12, str(2021 + k), size=8)
            for v in (0, 50, 100, 150):
                write(page, x0 - 20, y1 - v + 3, str(v), size=8)
            prose(page, 72, y1 + 40, 450, 4)

        pages, figures, _ = analyse(setup)
        self.assertEqual(list(figures), ["fig1"])
        labels = sorted(b.text for b in pages[0].ordered if b.type == "figure_text")
        self.assertEqual(labels, ["0", "100", "150", "2021", "2022", "2023", "2024", "2025", "50"])
        self.assertNotIn("other", {b.type for b in pages[0].ordered})

    def test_two_filled_boxes_are_no_bar_chart(self):
        def setup(page):
            write(page, 72, 90, "Annual report", size=22, font="tibo")
            write(page, 72, 130, "1. Revenue", size=13, font="tibo")
            y = prose(page, 72, 152, 450, 4)
            for k in range(2):
                page.draw_rect(pymupdf.Rect(150 + 120 * k, y + 40, 230 + 120 * k, y + 120), color=None, fill=(0.2, 0.4, 0.8))
            prose(page, 72, y + 160, 450, 4)

        _, figures, _ = analyse(setup)
        self.assertEqual(figures, {})

    def test_boxes_fields_checkboxes_and_logos_are_no_figures(self):
        def setup(page):
            # a logo in the head of the first page, beside the title
            page.draw_circle((90, 125), 18, color=(0, 0.3, 0.6), width=2)
            page.draw_line((90, 115), (90, 135), color=(0, 0.3, 0.6), width=2)
            page.draw_line((80, 125), (100, 125), color=(0, 0.3, 0.6), width=2)
            write(page, 130, 130, "Application form", size=22, font="tibo")
            write(page, 72, 170, "1. Applicant", size=13, font="tibo")
            prose(page, 72, 192, 450, 3)
            # an empty field with its small label, and checkboxes with their options
            page.draw_rect(pymupdf.Rect(72, 240, 280, 262), color=(0, 0, 0), width=0.5)
            write(page, 74, 238, "Name of the applicant", size=6)
            for k, label in enumerate(("Car", "Motorbike", "Trailer")):
                x = 72 + 90 * k
                for a, b in (((x, 290), (x + 10, 290)), ((x, 300), (x + 10, 300)), ((x, 290), (x, 300)),
                             ((x + 10, 290), (x + 10, 300))):
                    page.draw_line(a, b, color=(0, 0, 0), width=0.5)
                write(page, x + 14, 299, label, size=10)
            # a code listing: a grey box, drawn line by line as a word processor does, around lines of code
            for k in range(4):
                top = 330 + 14 * k
                page.draw_rect(pymupdf.Rect(72, top, 520, top + 14), color=None, fill=(0.93, 0.93, 0.93))
                page.draw_rect(pymupdf.Rect(72, top, 72.5, top + 14), color=None, fill=(0.6, 0.6, 0.6))
                page.draw_rect(pymupdf.Rect(519.5, top, 520, top + 14), color=None, fill=(0.6, 0.6, 0.6))
                write(page, 80, top + 10, f"curl -X GET https://api.example/v2/parcels/{k}", size=9, font="cour")
            prose(page, 72, 430, 450, 3)

        pages, figures, _ = analyse(setup)
        self.assertEqual(figures, {})
        self.assertNotIn("figure_text", {b.type for b in pages[0].ordered})

    def test_a_grid_of_empty_form_fields_is_no_table(self):
        def setup(page):
            write(page, 72, 90, "Application form", size=22, font="tibo")
            write(page, 72, 150, "1. Applicant", size=13, font="tibo")
            prose(page, 72, 172, 450, 3)
            for y in (250, 280, 310):                                 # six empty fields in a grid, each with a small label
                page.draw_line((72, y), (492, y), color=(0, 0, 0), width=0.5)
            for x in (72, 212, 352, 492):
                page.draw_line((x, 250), (x, 310), color=(0, 0, 0), width=0.5)
            for k, top in enumerate((250, 280)):
                for col, x in enumerate((72, 212, 352)):
                    write(page, x + 3, top + 8, ("First name", "Last name", "Town", "Street", "Number", "Phone")[3 * k + col], size=6)
            prose(page, 72, 360, 450, 3)

        pages, figures, _ = analyse(setup)
        self.assertEqual(figures, {})
        self.assertNotIn("table_text", {b.type for b in pages[0].ordered})

    def test_a_photo_or_a_drawing_right_under_the_title_is_a_figure_and_a_logo_beside_it_is_not(self):
        def photo(page, rect):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 200, 120))
            pix.clear_with(120)
            page.insert_image(rect, pixmap=pix)

        def drawing(page, top):
            page.draw_rect(pymupdf.Rect(200, top, 400, top + 120), color=(0.3, 0.3, 0.3), fill=(0.8, 0.8, 0.8))
            page.draw_circle((350, top + 60), 18, color=(0.3, 0.3, 0.3), fill=(0.9, 0.9, 0.9))
            for k, (x, dy) in enumerate(((160, 10), (160, 60), (440, 30), (440, 90))):
                page.draw_line((x + 8, top + dy), (200 if x < 300 else 400, top + dy + 6), color=(0.5, 0, 0), width=0.8)
                page.draw_circle((x, top + dy), 9, color=(0.5, 0, 0), fill=(0.5, 0.2, 0.1))
                write(page, x - 3, top + dy + 3.5, str(k + 1), size=9, font="tibo")

        def body(page):
            write(page, 72, 350, "1. Ingredients", size=13, font="tibo")
            prose(page, 72, 372, 450, 10)

        def title_and_photo(page):
            write(page, 72, 100, "Chicken and Vegetable Tray Bake", size=22, font="tibo")
            photo(page, pymupdf.Rect(150, 130, 450, 310))
            body(page)

        def title_and_drawing(page):
            write(page, 72, 100, "Chicken and Vegetable Tray Bake", size=22, font="tibo")
            drawing(page, 130)
            body(page)

        def title_and_logo(page):
            write(page, 150, 100, "Chicken and Vegetable Tray Bake", size=22, font="tibo")
            photo(page, pymupdf.Rect(60, 70, 130, 110))                   # a logo beside the title
            body(page)

        _, figures, _ = analyse(title_and_photo)
        self.assertEqual([(f["kind"], f["page"]) for f in figures.values()], [("figure", 1)])
        pages, figures, _ = analyse(title_and_drawing)
        self.assertEqual(list(figures), ["fig1"])
        self.assertEqual(sorted(b.text for b in pages[0].ordered if b.type == "figure_text"), ["1", "2", "3", "4"])
        _, figures, _ = analyse(title_and_logo)
        self.assertEqual(figures, {})

    def test_a_small_image_in_the_top_of_a_later_page_is_a_logo_and_a_photo_is_a_figure(self):
        def image(page, rect):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 80, 40))
            pix.clear_with(120)
            page.insert_image(rect, pixmap=pix)

        def first(page):
            write(page, 72, 90, "Letter", size=22, font="tibo")
            write(page, 72, 130, "1. Request", size=13, font="tibo")
            prose(page, 72, 152, 450, 4)

        def second(page):
            image(page, pymupdf.Rect(72, 110, 200, 150))             # the letterhead of a later page
            write(page, 300, 130, "Mrs Example, Example Road 5")
            write(page, 72, 190, "2. Reply", size=13, font="tibo")
            prose(page, 72, 212, 450, 4)
            image(page, pymupdf.Rect(150, 280, 400, 400))            # a picture in the text
            prose(page, 72, 430, 450, 4)

        _, figures, _ = analyse(first, second)
        self.assertEqual([(f["kind"], f["page"]) for f in figures.values()], [("figure", 2)])
        self.assertGreater(list(figures.values())[0]["bbox"][1], 270)

    def test_a_slide_deck_is_left_alone(self):
        def slide(page):
            write(page, 50, 70, "A slide", size=28, font="tibo")
            write(page, 50, 130, "The pump presses the water through the coffee and the cup fills.", size=14)
            page.draw_circle((300, 250), 40, color=(0, 0, 0), fill=(0.8, 0.8, 1))
            page.draw_rect(pymupdf.Rect(100, 200, 200, 300), color=(0, 0, 0), fill=(1, 0.8, 0.8))
            write(page, 250, 400, "a label", size=14)

        _, figures, _ = analyse(slide, slide, slide, size=(720, 540))
        self.assertEqual(figures, {})


class CaptionedTableTests(unittest.TestCase):
    """A captioned table whose label column looks like body text keeps all its rows (the specification table of a
    manual: label, value, label, value)."""

    PROBLEMS = (("Machine does not switch on", "Plug not connected, no mains power at all", "Check the plug and the outlet of the room."),
                ("No hot water at the group head", "Tank empty or not seated correctly again", "Fill the tank and push it back in firmly."),
                ("Espresso is too weak or watery", "Grind too coarse or too little coffee used", "Use a finer grind and 18 g of ground coffee."),
                ("Espresso drips very slowly now", "Grind too fine or tamped too hard in", "Use a coarser grind and press more lightly."),
                ("Weak steam, milk does not foam", "Steam nozzle blocked by dried milk", "Let the wand cool, then clean the nozzle well."),
                ("Display shows the code dESC now", "200 brewing cycles reached since last", "Descale the machine as in section 4 above."),
                ("Display shows the code E04 now", "Boiler overheated after long steaming", "Switch off and wait 30 minutes before use."),
                ("Water under the machine on floor", "Drip tray full or tank not seated well", "Empty the drip tray and reseat the water tank."))
    SPECS = (("Rated voltage", "220 to 240 V, 50/60 Hz", "Brewing temperature", "93 degrees"),
             ("Rated power", "1450 W", "Heat-up time", "about 40 s"),
             ("Pump pressure", "15 bar", "Max. cup height", "11 cm"),
             ("Water tank", "1.2 L", "Dimensions (W x D x H)", "28 x 31 x 34 cm"),
             ("Cable length", "1.0 m", "Weight (empty)", "5.8 kg"),
             ("Protection class", "I", "Noise level", "56 dB(A)"))

    def rule(self, page, y, h, x0=60, x1=536):
        page.draw_rect(pymupdf.Rect(x0, y, x1, y + h), color=None, fill=(0, 0, 0))

    def test_the_specification_table_is_read_to_its_last_row(self):
        def setup(page):
            write(page, 60, 80, "5 Troubleshooting", size=13, font="tibo")
            prose(page, 60, 100, 476, 2, size=9)
            write(page, 60, 136, "Table 1: Troubleshooting guide", size=9)
            for y, h in ((144, 0.8), (158, 0.5), (344, 0.8)):
                self.rule(page, y, h)
            for x, text in ((60, "Problem"), (190, "Possible cause"), (361, "Remedy")):
                write(page, x, 154, text, size=9, font="tibo")
            for k, row in enumerate(self.PROBLEMS):
                # a narrow first column in a monospaced face: its lines end at one edge, as the left column of the page
                write(page, 60, 175 + 21 * k, f"Problem no.{k + 1:02d}", size=9, font="cour")
                write(page, 60, 185 + 21 * k, "(see list)  ", size=9, font="cour")
                for x, text in zip((190, 361), row[1:]):
                    write(page, x, 175 + 21 * k, text, size=9)
            write(page, 60, 380, "6 Technical specifications", size=13, font="tibo")
            write(page, 60, 404, "Table 2: Technical specifications", size=9)
            for y, h in ((416, 0.8), (434, 0.5), (434 + 12.2 * 6 + 8, 0.8)):
                self.rule(page, y, h, 80, 514)
            for x, text in ((82, "Feature"), (170, "Value"), (280, "Feature"), (390, "Value")):
                write(page, x, 429, text, size=9, font="tibo")
            for k, row in enumerate(self.SPECS):
                for x, text in zip((82, 170, 280, 390), row):
                    write(page, x, 449 + 12.2 * k, text, size=9)
            prose(page, 60, 560, 476, 3, size=9)

        pages, figures, _ = analyse(setup)
        self.assertGreater(figures["tab2"]["bbox"][3], 500)
        rows = [b.text for b in pages[0].ordered if b.type == "table_text" and b.bbox[1] > 410]
        self.assertEqual(len(rows), 7)
        self.assertEqual(rows[-1], "Protection class I Noise level 56 dB(A)")


class ColumnTests(unittest.TestCase):
    """2.3: two columns of different heights are read one after the other."""

    def two_columns(self, paper=False):
        def setup(page):
            write(page, 72, 80, "Recipe card", size=22, font="tibo")
            if paper:
                write(page, 72, 100, "Abstract", size=10, font="tibo")
            write(page, 72, 140, "Ingredients", size=13, font="tibo")
            write(page, 300, 140, "Steps", size=13, font="tibo")
            for k, y in enumerate((170, 250, 330)):                       # left column: three short groups
                write(page, 72, y, f"Group {k + 1}", size=9, font="tibo")
                prose(page, 72, y + 14, 95, 4, size=9)
            for k, y in enumerate((165, 215, 265, 315, 365, 415)):        # right column: six steps, taller
                write(page, 300, y, f"{k + 1} Step", size=10, font="tibo")
                prose(page, 300, y + 12, 230, 2)
        return setup

    def test_the_left_column_comes_before_the_right(self):
        pages, _, _ = analyse(self.two_columns())
        ordered = pages[0].ordered
        left = [i for i, b in enumerate(ordered) if b.bbox[2] < 260 and b.type != "title"]
        right = [i for i, b in enumerate(ordered) if b.bbox[0] > 280]
        self.assertEqual(len(left), 7)           # "Ingredients", three group labels and their three lists
        self.assertEqual(len(right), 13)         # "Steps" and six steps with their texts
        self.assertLess(max(left), min(right), [b.text[:12] for b in ordered])
        self.assertEqual([b.text for b in ordered if b.text.startswith("Group")], ["Group 1", "Group 2", "Group 3"])

    def test_the_columns_have_no_gutter_of_their_own(self):
        """The check that this layout needs the new reading order: the gutter is not found line by line."""
        pages, _, _ = analyse(self.two_columns())
        self.assertIsNone(pages[0].gutter)

    def test_a_paper_is_not_touched(self):
        pages, _, _ = analyse(self.two_columns(paper=True))
        self.assertIsNone(pages[0].columns)

    def test_rows_of_label_and_value_stay_in_row_order(self):
        """Single lines side by side (a form, the date and the name under a letter) are rows, not two columns."""
        def setup(page):
            write(page, 72, 80, "Application", size=20, font="tibo")
            prose(page, 72, 120, 450, 6)
            rows = (("Place, date", "Berlin, 3 May"), ("Received on:", "7 May"), ("Fee paid:", "yes"), ("Valid until:", "2030"))
            for k, (label, value) in enumerate(rows):
                write(page, 72, 300 + 30 * k, label)
                write(page, 300, 300 + 30 * k, value)

        pages, _, _ = analyse(setup)
        texts = [b.text for b in pages[0].ordered]
        order = [texts.index(t) for t in ("Place, date", "Berlin, 3 May", "Received on:", "7 May", "Fee paid:", "yes", "Valid until:", "2030")]
        self.assertEqual(order, sorted(order), texts)

    def test_a_column_of_three_lines_beside_single_lines_is_still_a_column(self):
        def setup(page):
            write(page, 72, 80, "Recipe card", size=22, font="tibo")
            for k, y in enumerate((170, 250)):
                write(page, 72, y, f"Group {k + 1}", size=9, font="tibo")
                prose(page, 72, y + 14, 95, 3, size=9)
            for k, y in enumerate((165, 215, 265, 315)):
                write(page, 300, y, f"{k + 1} Step", size=10, font="tibo")
                write(page, 300, y + 12, "One line per step")

        pages, _, _ = analyse(setup)
        ordered = pages[0].ordered
        left = [i for i, b in enumerate(ordered) if b.bbox[2] < 260 and b.type != "title"]
        right = [i for i, b in enumerate(ordered) if b.bbox[0] > 280]
        self.assertLess(max(left), min(right), [b.text[:12] for b in ordered])


class FormTests(unittest.TestCase):
    """2.9: labels that start with a digit, and the small labels of form fields."""

    def test_an_option_that_starts_with_a_digit_is_no_heading(self):
        def setup(page):
            write(page, 72, 80, "Application", size=20, font="tibo")
            write(page, 72, 120, "3 Validity", size=11, font="tibo")
            prose(page, 72, 145, 450, 3, size=8, pitch=10)
            write(page, 72, 200, "Desired validity *", size=10)
            write(page, 200, 200, "1 year", size=10)
            write(page, 252, 200, "2 years", size=10)
            write(page, 72, 240, "4 Documents", size=11, font="tibo")
            prose(page, 72, 262, 450, 3, size=8, pitch=10)

        pages, _, _ = analyse(setup)
        kinds = {b.text: b.type for b in pages[0].ordered}
        self.assertEqual(kinds["3 Validity"], "heading")
        self.assertEqual(kinds["4 Documents"], "heading")
        self.assertEqual(kinds["1 year"], "paragraph")
        self.assertEqual(kinds["2 years"], "paragraph")

    def test_numbered_headings_beside_a_narrow_sidebar_stay_headings(self):
        """A sidebar overlaps the headings in height; it is no field beside them (other size, a column of lines)."""
        def setup(page):
            write(page, 72, 80, "Recipe card", size=22, font="tibo")
            for k in range(40):                                       # a narrow sidebar of short lines
                write(page, 60, 130 + 14 * k, ("200 g flour", "2 eggs", "1 tsp salt", "100 ml milk")[k % 4], size=9)
            y = 130
            for n, title in ((1, "Preparation"), (2, "Baking"), (3, "Serving")):
                write(page, 135, y, f"{n} {title}", size=13, font="tibo")
                y = prose(page, 135, y + 22, 400, 10) + 20

        pages, _, result = analyse(setup)
        sections = result[1]
        kinds = {b.text: b.type for b in pages[0].ordered}
        self.assertEqual([kinds[f"{n} {t}"] for n, t in ((1, "Preparation"), (2, "Baking"), (3, "Serving"))], ["heading"] * 3)
        self.assertEqual(len(sections), 3)

    def test_a_label_under_the_top_edge_of_a_field_is_no_footnote(self):
        def field(page):
            write(page, 72, 80, "Application", size=20, font="tibo")
            prose(page, 72, 120, 450, 30, size=10)
            for a, b in (((72, 560), (250, 560)), ((72, 590), (250, 590)), ((72, 560), (72, 590)), ((250, 560), (250, 590))):
                page.draw_line(a, b, color=(0, 0, 0), width=0.6)
            write(page, 75, 569, "Name of the applicant", size=6)

        def separator(page):
            write(page, 72, 80, "Application", size=20, font="tibo")
            prose(page, 72, 120, 450, 30, size=10)
            page.draw_line((72, 560), (150, 560), color=(0, 0, 0), width=0.6)
            write(page, 72, 572, "1 A note at the foot of the page.", size=7)

        pages, _, _ = analyse(field)
        self.assertEqual(kind_of(pages[0], "Name of the"), "paragraph")
        pages, _, _ = analyse(separator)
        self.assertEqual(kind_of(pages[0], "1 A note"), "footnote")


if __name__ == "__main__":
    unittest.main()
