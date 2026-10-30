"""Typed table grids (table_grid.py): headers, row labels, numbers, hints, and the tables that get no grid at all."""

import unittest
from unittest import mock

import pymupdf

import ingest
import table_grid


def build(draw):
    """A page drawn by draw(page); returns it as PyMuPDF reads it back from a saved PDF."""
    doc = pymupdf.open()
    draw(doc.new_page(width=612, height=792))
    return pymupdf.open("pdf", doc.tobytes())[0]


def rule(page, x0, x1, y, h=0.6):
    page.draw_rect(pymupdf.Rect(x0, y, x1, y + h), color=None, fill=(0, 0, 0))
    return (x0, y, x1, y + h)


def text(page, x, y, s, size=9, font="helv"):
    page.insert_text((x, y), s, fontsize=size, fontname=font)


class Table:
    """A table drawn at x0, y0 with the given column x positions: header lines, then rows (a row is a list of
    cell strings; a tuple (y offset, string) places a cell off the line, a "-" row draws a rule across)."""

    def __init__(self, columns, header, rows, x0=100, x1=500, y0=100, pitch=12):
        self.columns, self.header, self.rows = columns, header, rows
        self.x0, self.x1, self.y0, self.pitch = x0, x1, y0, pitch

    def draw(self, page, rules=True):
        y = self.y0
        found = [rule(page, self.x0, self.x1, y - 2, 0.8)]
        for line in self.header:
            y += self.pitch
            for x, s in zip(self.columns, line):
                if s:
                    text(page, x, y, s)
        found.append(rule(page, self.x0, self.x1, y + 4, 0.5))
        y += 4
        for row in self.rows:
            y += self.pitch
            if row == "-":
                found.append(rule(page, self.x0, self.x1, y - self.pitch / 2 - 2, 0.4))
                continue
            for x, s in zip(self.columns, row):
                if s:
                    text(page, x, y, s)
        found.append(rule(page, self.x0, self.x1, y + 5, 0.8))
        self.bbox = [self.x0, self.y0 - 3, self.x1, y + 7]
        return found if rules else []

    def grid(self, rules=True):
        out = {}
        page = build(lambda p: out.setdefault("rules", self.draw(p, rules)))
        return table_grid.read_grid(page, self.bbox, out["rules"])


def columns_of(grid):
    return [(c["name"], c["kind"], c.get("unit"), c.get("better")) for c in grid["columns"]]


def cells_of(grid):
    return [[c["text"] for c in row["cells"]] for row in grid["rows"]]


class NumberTests(unittest.TestCase):
    def test_cells_that_are_one_number(self):
        cases = {
            "27.3": 27.3, "9": 9, "−0.006": -0.006, "+0.194": 0.194, "1,024": 1024, "0,5": 0.5, "2,268": 2268,
            "12.5%": 12.5, "$4.99": 4.99, "100K": 1e5, "65M": 6.5e7, ".25": 0.25, "1e-3": 1e-3,
            "2.3 × 10^19": 2.3e19, "3.3 · 10^18": 3.3e18, "10^6": None, "0.16 ± 0.11": 0.16, "≈14": 14,
            "0.006⋆": 0.006, "23.5†": 23.5, "5.1^a": 5.1, "36°C": 36,
        }
        for cell, value in cases.items():
            with self.subTest(cell):
                got = table_grid.parse_number(cell)
                if value is None:
                    self.assertIsNone(got)
                else:
                    self.assertAlmostEqual(got, value, delta=abs(value) * 1e-9 + 1e-12)

    def test_cells_that_are_not_one_number(self):
        for cell in ["", "—", "n/a", "0.16–0.40", "<0.001", "[0.090, 0.298]", "1/3", "WSJ only", "3 of 4", "a1", "p < 0.001",
                     "12 ms"]:
            with self.subTest(cell):
                self.assertIsNone(table_grid.parse_number(cell))


class HintTests(unittest.TestCase):
    def test_arrows_and_words_give_the_direction(self):
        self.assertEqual(table_grid.header_hints("BLEU ↑"), ("BLEU", None, "up"))
        self.assertEqual(table_grid.header_hints("Error ↓"), ("Error", None, "down"))
        self.assertEqual(table_grid.header_hints("Accuracy (higher is better)"), ("Accuracy", None, "up"))
        self.assertEqual(table_grid.header_hints("Loss [lower is better]"), ("Loss", None, "down"))
        self.assertEqual(table_grid.header_hints("Perplexity (the lower the better)")[2], "down")
        self.assertEqual(table_grid.header_hints("BLEU")[2], None)

    def test_units_and_scales(self):
        self.assertEqual(table_grid.header_hints("Latency (ms)"), ("Latency (ms)", "ms", None))
        self.assertEqual(table_grid.header_hints("Stiffness [N/m]"), ("Stiffness [N/m]", "N/m", None))
        self.assertEqual(table_grid.header_hints("params ×10^6")[1], "×10^6")
        self.assertEqual(table_grid.header_hints("Accuracy %")[1], "%")
        self.assertIsNone(table_grid.header_hints("Model (base)")[1])      # a remark, not a unit


class GridTests(unittest.TestCase):
    def test_a_booktabs_table(self):
        table = Table(
            [104, 250, 400, 470],
            [["Model", "BLEU (higher is better)", "Latency (ms)", "Params"]],
            [["Base", "27.3", "12.5", "65M"], ["Big", "28.4", "30.1", "213M"], ["Small", "25.8", "9", ""]],
            x0=100, x1=540,
        )
        grid = table.grid()
        self.assertEqual((grid["confidence"], grid["method"], grid["label_header"]), ("high", "spans", "Model"))
        self.assertEqual(columns_of(grid), [("BLEU", "number", None, "up"), ("Latency (ms)", "number", "ms", None),
                                            ("Params", "number", None, None)])
        self.assertEqual([r["label"] for r in grid["rows"]], ["Base", "Big", "Small"])
        self.assertEqual(cells_of(grid), [["27.3", "12.5", "65M"], ["28.4", "30.1", "213M"], ["25.8", "9", ""]])
        values = [[c.get("value") for c in r["cells"]] for r in grid["rows"]]
        self.assertEqual(values, [[27.3, 12.5, 6.5e7], [28.4, 30.1, 2.13e8], [25.8, 9.0, None]])
        self.assertTrue(all(len(r["cells"]) == len(grid["columns"]) for r in grid["rows"]))

    def test_a_blank_cell_has_no_value(self):
        table = Table([104, 250, 330], [["Run", "A", "B"]], [["one", "1.5", "2.5"], ["two", "", "3.5"], ["three", "4.5", ""]])
        grid = table.grid()
        self.assertEqual(cells_of(grid), [["1.5", "2.5"], ["", "3.5"], ["4.5", ""]])
        self.assertNotIn("value", grid["rows"][1]["cells"][0])

    def test_scripts_are_marked(self):
        def draw(page):
            self.rules = Table([104, 220, 330], [[]], []).draw(page)
            for x, s, dy in ((104, "Setting", 0),):
                text(page, x, 112, s)
            text(page, 220, 112, "d", 9)
            text(page, 225.5, 114, "model", 6)               # a subscript
            text(page, 330, 112, "Steps", 9)
            text(page, 104, 130, "base", 9)
            text(page, 220, 130, "2.3 × 10", 9)
            text(page, 255, 127, "19", 6)                    # a superscript
            text(page, 330, 130, "100K", 9)
            text(page, 104, 142, "big", 9)
            text(page, 220, 142, "512", 9)
            text(page, 330, 142, "300K", 9)

        table = Table([104, 220, 330], [[]], [])
        page = build(lambda p: (draw(p)))
        grid = table_grid.read_grid(page, [100, 97, 500, 148], [(100, 98, 500, 99), (100, 117, 500, 118), (100, 146, 500, 147)])
        self.assertIsNotNone(grid)
        self.assertEqual(grid["columns"][0]["name"], "d_model")
        self.assertEqual(grid["rows"][0]["cells"][0], {"text": "2.3 × 10^19", "value": 2.3e19})
        self.assertEqual(grid["rows"][0]["cells"][1]["value"], 100000)

    def test_a_header_over_two_columns_names_both(self):
        table = Table(
            [104, 230, 300, 370, 440],
            [["", "Cost", "", "Score", ""], ["Model", "EN-DE", "EN-FR", "EN-DE", "EN-FR"]],
            [["A", "1.5", "2.5", "10.1", "20.2"], ["B", "1.6", "2.6", "11.1", "21.2"], ["C", "1.7", "2.7", "12.1", "22.2"]],
        )
        # the span's own rule under "Cost" and "Score" shows which columns each reaches
        page = build(lambda p: table.draw(p))
        short = [(226, 114, 360, 114.5), (366, 114, 500, 114.5)]
        grid = table_grid.read_grid(page, table.bbox, [(100, 98, 500, 98.8), (100, 130, 500, 130.5),
                                                       (100, 183, 500, 183.8)] + short)
        self.assertIsNotNone(grid)
        names = [c["name"] for c in grid["columns"]]
        self.assertEqual(len(names), 4)
        self.assertEqual(len(set(names)), 4)                 # the same names get a number: they can be told apart
        self.assertTrue(all("EN-" in n for n in names), names)

    def test_rows_between_rules_share_a_group_label(self):
        table = Table(
            [104, 180, 300, 380],
            [["", "Setting", "Loss", "Acc"]],
            [["(A)", "h=1", "5.29", "24.9"], ["", "h=4", "5.00", "25.5"], ["", "h=16", "4.91", "25.8"], "-",
             ["(B)", "k=16", "5.16", "25.1"], ["", "k=32", "5.01", "25.4"]],
        )
        grid = table.grid()
        self.assertIsNotNone(grid)
        self.assertEqual([r.get("group", "") for r in grid["rows"]], ["(A)", "(A)", "(A)", "(B)", "(B)"])
        self.assertEqual([r["cells"][0]["text"] for r in grid["rows"]], ["h=1", "h=4", "h=16", "k=16", "k=32"])

    def test_a_fully_ruled_table_is_read_by_the_finder(self):
        def draw(page):
            xs, ys = [100, 200, 300, 400], [100, 118, 136, 154, 172]
            for y in ys:
                page.draw_line((xs[0], y), (xs[-1], y), width=0.6)
            for x in xs:
                page.draw_line((x, ys[0]), (x, ys[-1]), width=0.6)
            for x, s in zip(xs, ["Method", "Error", "Time"]):
                text(page, x + 4, 112, s)
            for i, row in enumerate([["Ours", "0.12", "3.4"], ["Base", "0.25", "5.1"], ["Other", "0.31", "2.2"]]):
                for x, s in zip(xs, row):
                    text(page, x + 4, 130 + 18 * i, s)

        page = build(draw)
        grid = table_grid.read_grid(page, [99, 99, 401, 173], [])
        self.assertIsNotNone(grid)
        self.assertEqual(grid["method"], "finder")
        self.assertEqual(grid["confidence"], "high")
        self.assertEqual([c["name"] for c in grid["columns"]], ["Error", "Time"])
        self.assertEqual([r["label"] for r in grid["rows"]], ["Ours", "Base", "Other"])
        self.assertEqual(cells_of(grid), [["0.12", "3.4"], ["0.25", "5.1"], ["0.31", "2.2"]])

    def test_a_table_without_rules_is_read_with_medium_confidence(self):
        table = Table([104, 230, 330], [["Model", "Acc", "F1"]],
                      [["A", "80.1", "70.2"], ["B", "81.1", "71.2"], ["C", "82.1", "72.2"]])
        grid = table.grid(rules=False)
        self.assertIsNotNone(grid)
        self.assertEqual(grid["confidence"], "medium")
        self.assertEqual(cells_of(grid), [["80.1", "70.2"], ["81.1", "71.2"], ["82.1", "72.2"]])

    def test_a_number_across_two_columns_is_shown_in_each_and_lowers_confidence(self):
        table = Table(
            [104, 230, 330, 380],
            [["Model", "Score", "Cost A", "Cost B"]],
            [["A", "10.1", "1.5", "2.5"], ["B", "11.1", "1.6", "2.6"], ["C", "12.1", "", ""]],
        )
        page = build(lambda p: (table.draw(p), text(p, 341, 152, "3,300,000")))   # one number over both costs
        grid = table_grid.read_grid(page, table.bbox, [(100, 98, 500, 98.8), (100, 118, 500, 118.5), (100, 171, 500, 171.8)])
        self.assertIsNotNone(grid)
        last = grid["rows"][-1]["cells"]
        self.assertEqual([c["text"] for c in last], ["12.1", "3,300,000", "3,300,000"])
        self.assertEqual(grid["confidence"], "medium")

    def test_no_grid_rather_than_a_wrong_one(self):
        # a text table whose cells wrap over several lines would read as rows of their own
        def wrapped(page):
            for x, s in zip([104, 240, 380], ["Question", "Claim", "Outcome"]):
                text(page, x, 112, s)
            rule(page, 100, 500, 98)
            rule(page, 100, 500, 118)
            for i, y in enumerate([135, 147, 159, 171, 183, 195]):
                for x, s in zip([104, 240, 380], [f"Is it true that q{i} holds", f"Claim {i} says", "yes"][:3 if i % 2 == 0 else 2]):
                    text(page, x, y, s if i % 2 == 0 else s.lower())
            rule(page, 100, 500, 205)

        self.assertIsNone(table_grid.read_grid(build(wrapped), [100, 97, 500, 206], [(100, 98, 500, 98.6), (100, 118, 500, 118.6),
                                                                                     (100, 205, 500, 205.6)]))
        # a header of numbers is a row of data: the real header is not in the box
        data = Table([104, 200, 300], [["a", "1.5", "2.5"]], [["b", "3.5", "4.5"], ["c", "5.5", "6.5"], ["d", "7.5", "8.5"]])
        self.assertIsNone(data.grid())
        # too little to be a table
        small = Table([104, 200], [["A", "B"]], [["x", "1.5"]])
        self.assertIsNone(small.grid())


class IngestTests(unittest.TestCase):
    """A table found by the ingest gets the grid of its body, and one that cannot be read stays a picture."""

    def analyse(self, setup):
        doc = pymupdf.open()
        setup(doc.new_page(width=612, height=792))
        pdf = pymupdf.open("pdf", doc.tobytes())
        with mock.patch.object(ingest, "warn"):
            _, _, figures, _, _ = ingest.analyse(pdf)
        return {f["id"]: f for f in figures}

    def test_the_grid_is_part_of_the_table_record(self):
        def setup(page):
            text(page, 100, 92, "Table 1: Results of the study.")
            Table([104, 250, 330, 410], [["Query", "Total", "Max.", "Gain"]],
                  [[f"q{i}", f"2,{268 + i}", f"{332 + i}", f"{i}.5"] for i in range(4)], x0=100, x1=500).draw(page)
            text(page, 100, 200, "Table 1")

        figures = self.analyse(setup)
        grid = figures["tab1"].get("grid")
        self.assertIsNotNone(grid, figures)
        self.assertEqual(grid["label_header"], "Query")
        self.assertEqual([c["name"] for c in grid["columns"]], ["Total", "Max.", "Gain"])
        self.assertEqual(grid["rows"][1]["cells"][0], {"text": "2,269", "value": 2269})
        self.assertNotIn("_rules", figures["tab1"].get("grid", {}))

    def test_a_figure_has_no_grid(self):
        def setup(page):
            page.draw_rect(pymupdf.Rect(100, 100, 300, 200), color=(0, 0, 1), fill=(0.8, 0.8, 1))
            text(page, 100, 215, "Figure 1: A blue box.")

        for f in self.analyse(setup).values():
            self.assertNotIn("grid", f)


if __name__ == "__main__":
    unittest.main()
