"""Exercise sheets: tasks, parts and points in doc.json, on synthetic sheets built in a temp folder."""

import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest import mock

import pymupdf

import ingest
import outline
import validate


def write(page, x, y, text, size=10, font="tiro"):
    page.insert_text((x, y), text, fontsize=size, fontname=font)


def run_in(page, x, y, bold, rest, size=10):
    """A bold run-in heading followed by plain text on the same line."""
    write(page, x, y, bold, size, "tibo")
    write(page, x + pymupdf.get_text_length(bold, fontname="tibo", fontsize=size) + 3, y, rest, size)


STATEMENT = ("A ball is kicked from level ground with an initial speed of 20 m/s at an angle of 30 degrees above"
             " the horizontal")


def paragraph(page, y, text, x=72, width=451, size=10, lines=3):
    """A justified paragraph whose first baseline is about y: its lines end on one edge, as typeset text does, so the
    page has a column edge and the paragraph reads as body text."""
    rect = pymupdf.Rect(x, y - size, x + width, y + 13 * lines)
    page.insert_textbox(rect, text, fontsize=size, fontname="tiro", align=pymupdf.TEXT_ALIGN_JUSTIFY)


def sketch(page, x, y, labels=(("R1", 45, 60), ("U0", 30, 20))):
    """A hand-made circuit with its top left corner at (x, y), 120 x 70 points: four wires, a zigzag resistor, a circle
    for the source and its labels."""
    for a, b in (((x, y), (x + 120, y)), ((x + 120, y), (x + 120, y + 70)), ((x + 120, y + 70), (x, y + 70)),
                 ((x, y + 70), (x, y))):
        page.draw_line(a, b, color=(0, 0, 0), width=1)
    page.draw_polyline([(x + 30, y + 35), (x + 40, y + 25), (x + 50, y + 45), (x + 60, y + 25), (x + 70, y + 45),
                        (x + 80, y + 35)], color=(0, 0, 0), width=1)
    page.draw_circle((x + 20, y + 35), 6, color=(0, 0, 0), width=1)
    for text, dx, dy in labels:
        write(page, x + dx, y + dy, text)


def punnett(page, x, y):
    """A blank 2 x 2 grid of 30-point cells with its top left corner at (x, y) and "T", "t" labels above and left."""
    for k in range(3):
        page.draw_line((x, y + 30 * k), (x + 60, y + 30 * k), color=(0, 0, 0), width=0.6)
        page.draw_line((x + 30 * k, y), (x + 30 * k, y + 60), color=(0, 0, 0), width=0.6)
    for k, letter in enumerate("Tt"):
        write(page, x + 12 + 30 * k, y - 5, letter)
        write(page, x - 11, y + 19 + 30 * k, letter)


def german_sheet(page):
    write(page, 72, 50, "Lineare Algebra I, WiSe 2026/27", size=9)
    write(page, 72, 90, "Übungsblatt 3", size=16, font="tibo")
    write(page, 72, 110, "Abgabe bis Freitag, 14.11.2026, 10:00 Uhr")
    write(page, 72, 150, "Aufgabe 1 (4 Punkte)", size=11, font="tibo")
    write(page, 72, 168, "Gegeben seien die Matrix A = (1 2; 3 4) und der Vektor b = (5, 6).")
    write(page, 72, 182, "a) Berechnen Sie die Determinante det(A) = ad - bc.")
    write(page, 72, 196, "b) Lösen Sie das lineare Gleichungssystem Ax = b, also")
    write(page, 220, 216, "x1 + 2 x2 = 5,   3 x1 + 4 x2 = 6", font="symb")
    write(page, 86, 236, "und prüfen Sie Ihr Ergebnis durch Einsetzen.")


class ExerciseTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = tmp.name

    def build(self, *pages, name="sheet"):
        """A PDF with one page per setup function, in a folder of its own; returns its path."""
        folder = os.path.join(self.root, name)
        os.makedirs(folder)
        path = os.path.join(folder, "paper.pdf")
        doc = pymupdf.open()
        for setup in pages:
            setup(doc.new_page(width=595, height=842))
        doc.save(path)
        doc.close()
        return path

    def run_ingest(self, path, out=None):
        """ingest.py's command line on path; returns the doc.json text."""
        args = [path] + (["--out", out] if out else [])
        with contextlib.redirect_stdout(io.StringIO()), mock.patch.object(ingest, "warn"):
            self.assertEqual(ingest.main(args), 0)
        with open(os.path.join(out or os.path.dirname(path), "doc.json"), encoding="utf-8") as fh:
            return fh.read()

    def ingest(self, *pages, name="sheet"):
        """Ingest a synthetic sheet; returns doc.json, with self.blocks indexing its blocks by ID."""
        path = self.build(*pages, name=name)
        self.folder = os.path.dirname(path)
        self.doc = json.loads(self.run_ingest(path))
        self.blocks = {b["id"]: b for b in self.doc["blocks"]}
        return self.doc

    def text(self, block_id):
        return self.blocks[block_id]["text"]

    def assert_valid(self):
        report = validate.Report()
        self.assertTrue(validate.check_schema(self.doc, "doc.schema.json", "doc.json", report), report.errors)
        index, _ = validate.check_doc(self.doc, self.folder, report)
        self.assertEqual(report.errors, [])
        return index

    def test_german_linear_algebra_sheet(self):
        doc = self.ingest(german_sheet)
        self.assertEqual(len(doc["exercises"]), 1)
        ex = doc["exercises"][0]
        self.assertEqual((ex["id"], ex["number"], ex["points"], ex["page"]), ("ex1", "1", 4, 1))
        self.assertNotIn("title", ex)
        self.assertEqual(self.text(ex["block"]), "Aufgabe 1 (4 Punkte)")
        self.assertEqual(ex["blocks"][0], ex["block"])
        self.assertEqual([(p["id"], p["label"]) for p in ex["parts"]], [("ex1.a", "a"), ("ex1.b", "b")])
        a, b = ex["parts"]
        self.assertTrue(self.text(a["blocks"][0]).startswith("a) Berechnen Sie die Determinante"))
        self.assertTrue(self.text(b["blocks"][0]).startswith("b) Lösen Sie"))
        # the givens are the task's own statement, ahead of its parts
        statement = [i for i in ex["blocks"][1:] if i not in a["blocks"] + b["blocks"]]
        self.assertEqual([self.text(i) for i in statement],
                         ["Gegeben seien die Matrix A = (1 2; 3 4) und der Vektor b = (5, 6)."])
        # the display formula and the line after it belong to part b
        self.assertIn("equation", [self.blocks[i]["type"] for i in b["blocks"]])
        self.assertTrue(self.text(b["blocks"][-1]).startswith("und prüfen Sie"))
        self.assertEqual(ex["blocks"][-1], b["blocks"][-1])
        # the course line, the title and the due date stay outside, and the heading is no author line
        types = {blk["text"]: blk["type"] for blk in doc["blocks"]}
        self.assertEqual(types["Übungsblatt 3"], "title")
        self.assertEqual(types["Aufgabe 1 (4 Punkte)"], "heading")
        self.assertFalse({i for i, blk in self.blocks.items() if "Abgabe" in blk["text"] or "Lineare" in blk["text"]}
                         & set(ex["blocks"]))
        # every part starts a block of its own, so its sentences can be lit up alone
        for part in ex["parts"]:
            first = self.blocks[part["blocks"][0]]
            self.assertTrue(first["sentences"])
        index = self.assert_valid()
        self.assertEqual((index["ex1"], index["ex1.b"]), ("exercise", "exercise part"))

    def test_english_problem_set(self):
        def page(p):
            write(p, 72, 80, "Problem Set 4", size=18)
            write(p, 72, 102, "Linear Algebra for Machine Learning, due Friday at noon")
            write(p, 72, 140, "Exercise 2 [6 points]", size=12, font="tibo")
            write(p, 72, 160, "Let A be the symmetric matrix with rows (2, 1) and (1, 2).")
            write(p, 72, 180, "(a) Show that A is positive definite.")
            write(p, 72, 200, "(b) Compute the eigenvalues of A.")
            write(p, 72, 220, "(c) Find an orthonormal basis of eigenvectors and write A = Q D Q^T.")
        doc = self.ingest(page)
        self.assertEqual([(e["id"], e["number"], e["points"]) for e in doc["exercises"]], [("ex2", "2", 6)])
        ex = doc["exercises"][0]
        self.assertEqual(self.text(ex["block"]), "Exercise 2 [6 points]")
        self.assertEqual([p["id"] for p in ex["parts"]], ["ex2.a", "ex2.b", "ex2.c"])
        self.assertEqual([self.text(p["blocks"][0])[:3] for p in ex["parts"]], ["(a)", "(b)", "(c)"])
        self.assertTrue(all(p["page"] == 1 and len(p["blocks"]) == 1 for p in ex["parts"]))
        self.assertNotIn("Problem Set 4", [self.text(i) for i in ex["blocks"]])
        self.assert_valid()

    def test_two_tasks_on_one_page(self):
        def page(p):
            write(p, 72, 80, "Hausaufgabenblatt 5", size=16, font="tibo")
            write(p, 72, 120, "Aufgabe 1: Determinanten (3 Punkte)", font="tibo")
            write(p, 72, 136, "Berechnen Sie die Determinante der Matrix B = (2 0; 1 3).")
            run_in(p, 72, 170, "Aufgabe 2.", "(Basiswechsel, 2+2 Punkte) Sei V = R² mit den Basen B und C.")
            write(p, 72, 184, "a) Bestimmen Sie die Übergangsmatrix von B nach C.")
            write(p, 72, 198, "b) Geben Sie die Koordinaten von v = (1, 1) bezüglich C an.")
        doc = self.ingest(page)
        first, second = doc["exercises"]
        self.assertEqual((first["id"], first["title"], first["points"], first["parts"]),
                         ("ex1", "Determinanten", 3, []))
        self.assertEqual((second["id"], second["title"], second["points"]), ("ex2", "Basiswechsel", 4))
        self.assertEqual([self.text(i) for i in first["blocks"]],
                         ["Aufgabe 1: Determinanten (3 Punkte)",
                          "Berechnen Sie die Determinante der Matrix B = (2 0; 1 3)."])
        # a run-in heading shares its block with the statement
        self.assertTrue(self.text(second["block"]).startswith("Aufgabe 2. (Basiswechsel, 2+2 Punkte) Sei V"))
        self.assertEqual([p["id"] for p in second["parts"]], ["ex2.a", "ex2.b"])
        self.assertFalse(set(first["blocks"]) & set(second["blocks"]))
        order = [b["id"] for b in doc["blocks"]]
        self.assertLess(order.index(first["blocks"][-1]), order.index(second["block"]))
        self.assert_valid()

    def test_paper_paragraph_is_not_a_task(self):
        """"Problem 3 is hard" opening a paragraph is prose; so is a paper's bold run-in "Task 1:". Without
        tasks, doc.json is exactly what the pipeline writes without the exercise step."""
        def paper(p):
            write(p, 72, 80, "Solving Hard Problems Quickly", size=18, font="tibo")
            write(p, 72, 104, "Jane Doe and John Roe", size=11)
            write(p, 72, 140, "Abstract", size=11, font="tibo")
            write(p, 72, 158, "We study search problems whose state spaces grow quickly with the input size.")
            write(p, 72, 172, "Our method prunes most of the space and finds solutions in practice.")
            write(p, 72, 206, "1 Introduction", size=12, font="tibo")
            write(p, 72, 226, "Problem 3 is hard because its search space grows exponentially with the input.")
            write(p, 72, 240, "Earlier work solved it only for small inputs, and we show how to scale it up.")
            run_in(p, 72, 270, "Task 1:", "Named entity recognition on news text, scored by F1 on the test set.")

        def notes(p):
            write(p, 72, 80, "Notes on Search", size=16, font="tibo")
            write(p, 72, 120, "Problem 3 is hard because its search space grows exponentially with the input.")
            write(p, 72, 134, "Problem 4 is easier: a greedy choice is always safe there.")

        for setup in (paper, notes):
            with self.subTest(setup.__name__):
                path = self.build(setup, name=setup.__name__)
                text = self.run_ingest(path)
                self.assertNotIn('"exercises"', text)
                with mock.patch.object(ingest, "mark_task_heads", return_value=False):
                    self.assertEqual(self.run_ingest(path), text)
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    outline.main([os.path.dirname(path)])
                self.assertNotIn("## Exercises", out.getvalue())

    def test_sub_parts_points_and_a_closing_note(self):
        def page(p):
            write(p, 72, 80, "Homework 3", size=16, font="tibo")
            write(p, 72, 120, "Problem 1 (10 pts)", size=12, font="tibo")
            write(p, 72, 140, "Consider the logistic loss L(w) = log(1 + exp(-y w x)).")
            write(p, 80, 160, "(a) [3 points] Show that L is convex in w.")
            write(p, 80, 180, "(b) [7 points] Compute the gradient of L")
            write(p, 100, 196, "(i) at w = 0;")
            write(p, 100, 210, "(ii) at w = 1.")
            write(p, 72, 236, "Hint: use the chain rule.")
        doc = self.ingest(page)
        ex = doc["exercises"][0]
        self.assertEqual((ex["id"], ex["points"]), ("ex1", 10))
        a, b = ex["parts"]
        self.assertEqual([(p["id"], p.get("points")) for p in (a, b)], [("ex1.a", 3), ("ex1.b", 7)])
        self.assertNotIn("parts", a)
        self.assertEqual([(s["id"], s["label"]) for s in b["parts"]], [("ex1.b.i", "i"), ("ex1.b.ii", "ii")])
        for sub in b["parts"]:
            self.assertTrue(set(sub["blocks"]) <= set(b["blocks"]))
        self.assertTrue(self.text(b["parts"][1]["blocks"][0]).startswith("(ii) at w = 1."))
        # the hint after the list belongs to the task, not to part (b)
        hint = next(i for i in ex["blocks"] if self.text(i).startswith("Hint"))
        self.assertNotIn(hint, b["blocks"])
        self.assertEqual(ex["blocks"][-1], hint)
        self.assert_valid()

    def test_numbering_variants(self):
        def homework(p):
            write(p, 72, 80, "Hausaufgabe H1 (3 Punkte)", size=11, font="tibo")
            write(p, 72, 98, "Zeigen Sie, dass jede konvergente Folge beschränkt ist.")
            write(p, 72, 130, "Hausaufgabe H2 (3 P.)", size=11, font="tibo")
            write(p, 72, 148, "Geben Sie eine beschränkte Folge an, die nicht konvergiert.")

        def number_first(p):
            write(p, 72, 80, "1. Aufgabe (1,5 Punkte)", size=11, font="tibo")
            write(p, 72, 98, "Bestimmen Sie den Rang der Matrix M = (1 2; 2 4).")

        def dotted(p):
            write(p, 72, 80, "Problem 3.1 (Gaussian elimination) [5 points]", size=12, font="tibo")
            write(p, 72, 100, "Solve the system x + y = 2, x - y = 0 by elimination.")
            write(p, 72, 120, "(a) Write down the augmented matrix.")
            write(p, 72, 140, "(b) Reduce it to row echelon form.")

        def bare_points(p):     # points without brackets; "4 Punkte" in a statement are no points
            write(p, 72, 80, "Aufgabe 3 - Determinanten - 4 Punkte", size=11, font="tibo")
            write(p, 72, 98, "Berechnen Sie die Determinante von M = (2 1; 1 2).")
            write(p, 72, 130, "Aufgabe 4: Zeigen Sie, dass 4 Punkte im Raum nicht immer in einer Ebene liegen.")

        def repeated(p):        # two sheets in one PDF, each with its own Aufgabe 1
            for y, sheet in ((80, "Blatt 1"), (400, "Blatt 2")):
                write(p, 72, y, sheet, size=16, font="tibo")
                write(p, 72, y + 40, "Aufgabe 1 (2 Punkte)", size=11, font="tibo")
                write(p, 72, y + 58, "Berechnen Sie 2 + 2 und begründen Sie Ihr Vorgehen.")

        def titled(p):          # "Übung 5" set as the sheet's title is not a task, nor is the grading table
            write(p, 72, 80, "Übung 5", size=20, font="tibo")
            write(p, 300, 70, "Aufgabe  1  2  Summe", font="tibo")
            write(p, 300, 84, "Punkte")
            write(p, 72, 130, "Aufgabe 1", size=11, font="tibo")
            write(p, 72, 148, "Zeigen Sie, dass die Abbildung f linear ist.")
            write(p, 72, 180, "Aufgabe 2", size=11, font="tibo")
            write(p, 72, 198, "Bestimmen Sie den Kern von f.")

        cases = {       # (ID, number, points, title, part IDs) per task
            homework: [("exH1", "H1", 3, None, []), ("exH2", "H2", 3, None, [])],
            number_first: [("ex1", "1", 1.5, None, [])],
            dotted: [("ex3.1", "3.1", 5, "Gaussian elimination", ["ex3.1.a", "ex3.1.b"])],
            bare_points: [("ex3", "3", 4, "Determinanten", []), ("ex4", "4", None, None, [])],
            repeated: [("ex1", "1", 2, None, []), ("ex1-2", "1", 2, None, [])],
            titled: [("ex1", "1", None, None, []), ("ex2", "2", None, None, [])],
        }
        for setup, expected in cases.items():
            with self.subTest(setup.__name__):
                doc = self.ingest(setup, name=setup.__name__)
                self.assertEqual([(e["id"], e["number"], e.get("points"), e.get("title"), [p["id"] for p in e["parts"]])
                                  for e in doc["exercises"]], expected)
                self.assert_valid()
                if setup is titled:
                    self.assertEqual((doc["blocks"][0]["text"], doc["blocks"][0]["type"]), ("Übung 5", "title"))

    def test_points_set_apart(self):
        """Points at the right margin ("Aufgabe 2 <hfill> (5 Punkte)") or after a part's text."""
        def page(p):
            write(p, 72, 80, "Übungsblatt 7", size=16, font="tibo")
            write(p, 72, 120, "Aufgabe 2", size=11, font="tibo")
            write(p, 470, 120, "(5 Punkte)")
            write(p, 72, 138, "Sei A eine reelle 3 x 3-Matrix mit A² = A.")
            write(p, 72, 156, "a) Zeigen Sie, dass jeder Eigenwert von A gleich 0 oder 1 ist.")
            write(p, 470, 156, "(2 Punkte)")
            write(p, 72, 174, "b) Folgern Sie, dass A diagonalisierbar ist, und geben Sie eine Basis aus")
            write(p, 86, 188, "Eigenvektoren für A = diag(1, 0, 0) an. (3 P.)")
        doc = self.ingest(page)
        ex = doc["exercises"][0]
        self.assertEqual((ex["id"], ex["points"]), ("ex2", 5))
        self.assertEqual([(p["id"], p["points"]) for p in ex["parts"]], [("ex2.a", 2), ("ex2.b", 3)])
        self.assertIn("(5 Punkte)", [self.text(i) for i in ex["blocks"]])
        self.assert_valid()

    def test_points_notes_are_no_title_and_split_over_the_parts(self):
        """"Problem 1. (20: 10,10 pts.) (Binary paradox)": 20 points in all, 10 for each part, and "Binary paradox"
        is the name; "(20: 3,2 pts.)" alone names nothing, so the task is its number only."""
        def page(p):
            write(p, 72, 70, "Problem Set 3", size=16, font="tibo")
            run_in(p, 72, 110, "Problem 1.", "(20: 10,10 pts.) (Binary paradox) Two children are born to one family.")
            write(p, 80, 126, "(a) Find the probability that both are girls.")
            write(p, 80, 140, "(b) Find it given that the older one is a girl.")
            run_in(p, 72, 170, "Problem 2.", "(25: 5,10,5,5 pts.) (Dice) A drawer holds four dice.")
            for k, part in enumerate("abcd"):
                write(p, 80, 186 + 14 * k, f"({part}) Compute the probability of case {k + 1}.")
            run_in(p, 72, 260, "Problem 3.", "(20: 12,8 points)")
            write(p, 80, 276, "(a) Show that the expected value exists.")
            write(p, 80, 290, "(b) Compute it.")
            run_in(p, 72, 320, "Problem 4.", "(6 points) (The blue taxi) Witnesses report a taxi.")
        doc = self.ingest(page)
        got = {e["number"]: e for e in doc["exercises"]}
        self.assertEqual([(e["number"], e.get("title"), e.get("points")) for e in doc["exercises"]],
                         [("1", "Binary paradox", 20), ("2", "Dice", 25), ("3", None, 20), ("4", "The blue taxi", 6)])
        self.assertEqual([p.get("points") for p in got["1"]["parts"]], [10, 10])
        self.assertEqual([p.get("points") for p in got["2"]["parts"]], [5, 10, 5, 5])
        self.assertEqual([p.get("points") for p in got["3"]["parts"]], [12, 8])
        for e in doc["exercises"]:
            self.assertNotRegex(e.get("title", ""), r"\d|pts|points")
        self.assert_valid()

    def test_an_imperative_after_the_number_is_the_statement_not_a_name(self):
        """"Aufgabe 4.1. Löse das lineare Gleichungssystem" names nothing; "Aufgabe 4.2. (Eigenwerte)" does."""
        def page(p):
            write(p, 72, 80, "Arbeitsblatt 4", size=16, font="tibo")
            write(p, 72, 120, "Aufgabe 4.1. Löse das lineare Gleichungssystem")
            write(p, 72, 136, "2x + 3y = 7 und 5x + 4y = 3.")
            write(p, 72, 170, "Aufgabe 4.2. Zeige, dass das lineare Gleichungssystem")
            write(p, 72, 186, "x + y = 0 nur die triviale Lösung besitzt.")
            write(p, 72, 220, "Aufgabe 4.3 (Eigenwerte)", font="tibo")
            write(p, 72, 236, "Berechne die Eigenwerte der Matrix A.")
        doc = self.ingest(page)
        self.assertEqual([(e["number"], e.get("title")) for e in doc["exercises"]],
                         [("4.1", None), ("4.2", None), ("4.3", "Eigenwerte")])
        self.assert_valid()

    def test_points_statements(self):
        """The points of a statement: a sum, a decimal comma, a total with its parts; none for "je 2 Punkte"."""
        parse = ingest.parse_points
        self.assertEqual((parse("4 Punkte"), parse("2+3 P."), parse("1,5 points"), parse("(6 pts)")), (4, 5, 1.5, 6))
        self.assertEqual((parse("20: 10,10 pts."), parse("25: 5,10,5,5 pts."), parse("20: 3,2,10,5 pts.")), (20, 25, 20))
        self.assertEqual(ingest.points_match("20: 10,10 pts.")[2], [10, 10])
        self.assertIsNone(ingest.points_match("4 Punkte")[2])
        self.assertIsNone(parse("je 2 Punkte"))
        # the parts of a total that does not add up are not parts: "20: 7,8 pts." reads as a number and its decimal
        self.assertEqual(ingest.points_match("20: 7,8 pts.")[1:], (7.8, None))
        self.assertEqual(ingest.points_only("(25: 5,10,5,5 pts.)"), 25)
        self.assertEqual(ingest.task_name(["20: 10,10 pts.", "Dice"]), "Dice")
        self.assertEqual(ingest.task_name(["Simplifying, 4 points"]), "Simplifying")
        self.assertEqual(ingest.task_name(["20: 10,10 pts.", "5 pts"]), "")

    def test_points_wrapped_onto_the_next_line(self):
        """"(2 Punkte)" broken after its number, as a justified line often breaks it."""
        def page(p):
            write(p, 72, 80, "Übungsblatt 2", size=16, font="tibo")
            write(p, 72, 120, "Aufgabe 1 (4 Punkte)", size=11, font="tibo")
            write(p, 72, 138, "Gegeben ist die Gleichung 3x - 7 = 2x + 5.")
            write(p, 72, 156, "a) Lösen Sie die Gleichung nach x auf. (2 Punkte)")
            write(p, 72, 174, "b) Machen Sie die Probe, indem Sie Ihr Ergebnis in beide Seiten der Gleichung (2")
            write(p, 86, 188, "Punkte)")
        doc = self.ingest(page)
        self.assertEqual([(p["id"], p.get("points")) for p in doc["exercises"][0]["parts"]], [("ex1.a", 2), ("ex1.b", 2)])
        self.assert_valid()

    def test_a_bracketed_title_makes_the_rest_of_the_line_the_statement(self):
        """"Problem 2. (Simplifying, 4 points) Simplify the expression" above a display formula: the title is
        "Simplifying", and "Simplify the expression" is where the statement starts."""
        def page(p):
            write(p, 72, 80, "Homework 5", size=16, font="tibo")
            for k, line in enumerate(("Hand in your solutions at the start of the lecture on Monday, written clearly and",
                                      "in full sentences. Show every step of your work and justify each of your answers,",
                                      "since answers without a justification receive no credit, even when they are right.")):
                write(p, 72, 100 + 14 * k, line)
            run_in(p, 72, 160, "Problem 1.", "(Derivatives, 6 points) Let f(x) = x^3 - 6x^2 + 9x + 1 for every real")
            write(p, 72, 174, "number x, and write f' for its derivative, which exists everywhere on the real line.")
            write(p, 80, 192, "(a) Compute the derivative of f.")
            run_in(p, 72, 222, "Problem 2.", "(Simplifying, 4 points) Simplify the expression")
            write(p, 250, 244, "(x^2 - 9) / (x - 3)")
            write(p, 72, 266, "for x other than 3, and evaluate the result at x = 5.")
        doc = self.ingest(page)
        self.assertEqual([(e["id"], e.get("title"), e.get("points")) for e in doc["exercises"]],
                         [("ex1", "Derivatives", 6), ("ex2", "Simplifying", 4)])
        self.assertTrue(self.text(doc["exercises"][1]["block"]).startswith("Problem 2. (Simplifying, 4 points) Simplify"))
        self.assert_valid()

    def test_task_labels_in_a_lecture_are_no_tasks(self):
        """A lecture on transfer learning labels the sides of each diagram "Task 1" and "Task 2": a number twice on
        one page, or three times in a document, is a label. A problem set's bare "Problem 1", "Problem 2" stay."""
        def diagram(p):
            write(p, 72, 80, "Transfer learning", size=20, font="tibo")
            for y in (160, 320):
                write(p, 90, y, "Task 1", size=14, font="tibo")
                write(p, 90, y + 18, "Source domain")
                write(p, 330, y, "Task 2", size=14, font="tibo")
                write(p, 330, y + 18, "Target domain")

        def summary(p):
            write(p, 72, 80, "Settings", size=20, font="tibo")
            for i, (y, text) in enumerate(((150, "Same inputs, new labels"), (230, "New inputs, same labels"),
                                           (310, "Both change"))):
                write(p, 90, y, f"Task {i + 1}", size=14, font="tibo")
                write(p, 90, y + 18, text)

        path = self.build(diagram, summary, name="lecture")
        self.assertNotIn('"exercises"', self.run_ingest(path))

        def problems(p):
            write(p, 72, 80, "Problem Set 2", size=18)
            write(p, 72, 130, "Problem 1", size=12, font="tibo")
            write(p, 72, 150, "Show that the sum of two even numbers is even.")
            write(p, 72, 190, "Problem 2", size=12, font="tibo")
            write(p, 72, 210, "Find all real x with x^2 = 4.")
        doc = self.ingest(problems, name="problems")
        self.assertEqual([e["id"] for e in doc["exercises"]], ["ex1", "ex2"])

    def test_task_across_a_page_break(self):
        def first(p):
            write(p, 72, 40, "Analysis I - Blatt 2", size=9)
            write(p, 72, 90, "Analysis I - Blatt 2", size=16, font="tibo")     # the title repeats the running head
            write(p, 72, 140, "Aufgabe 1 (2 Punkte)", size=11, font="tibo")
            write(p, 72, 158, "Zeigen Sie, dass die Folge 1/n gegen 0 konvergiert.")
            write(p, 72, 700, "Aufgabe 2 (4 Punkte)", size=11, font="tibo")
            write(p, 72, 718, "Sei f(x) = x² - 2. Wir suchen eine Nullstelle von f.")
            write(p, 72, 736, "a) Zeigen Sie, dass f auf [1, 2] eine Nullstelle hat.")
            write(p, 290, 810, "1", size=9)

        def second(p):
            write(p, 72, 40, "Analysis I - Blatt 2", size=9)
            write(p, 72, 90, "b) Berechnen Sie zwei Schritte des Newton-Verfahrens ab x0 = 1.")
            write(p, 72, 104, "c) Schätzen Sie den Fehler nach dem zweiten Schritt ab.")
            write(p, 290, 810, "2", size=9)

        doc = self.ingest(first, second)
        one, two = doc["exercises"]
        self.assertEqual((two["id"], two["page"], two["points"]), ("ex2", 1, 4))
        self.assertEqual([(p["id"], p["page"]) for p in two["parts"]], [("ex2.a", 1), ("ex2.b", 2), ("ex2.c", 2)])
        self.assertEqual({self.blocks[i]["page"] for i in two["blocks"]}, {1, 2})
        # the course line repeated on both pages and the page numbers are in no task; the title stays one
        lines = [i for i, b in self.blocks.items() if b["text"] in ("Analysis I - Blatt 2", "1", "2")]
        self.assertEqual(sorted(self.blocks[i]["type"] for i in lines), ["header_footer"] * 4 + ["title"])
        self.assertFalse(set(lines) & set(one["blocks"] + two["blocks"]))
        self.assert_valid()

    def test_validate_reports_broken_exercises(self):
        self.ingest(german_sheet)
        index = self.assert_valid()
        title = next(b["id"] for b in self.doc["blocks"] if b["type"] == "title")
        original = json.dumps(self.doc)
        cases = {
            "unknown block 'p1.b99'": lambda d: d["exercises"][0]["blocks"].append("p1.b99"),
            "is not one of 'ex1'": lambda d: d["exercises"][0]["parts"][0]["blocks"].insert(0, title),
            "duplicate exercise ID 'ex1'": lambda d: d["exercises"].append(dict(d["exercises"][0], parts=[])),
            "also belongs to 'ex1'": lambda d: d["exercises"].append(dict(d["exercises"][0], id="ex2", parts=[])),
            "is not named after 'ex1'": lambda d: d["exercises"][0]["parts"][1].update(id="ex1.c"),
            "not in reading order": lambda d: d["exercises"][0]["blocks"].reverse(),
            "is not the first": lambda d: d["exercises"][0].update(block=d["exercises"][0]["blocks"][1]),
        }
        for message, corrupt in cases.items():
            with self.subTest(message):
                doc = json.loads(original)
                corrupt(doc)
                report = validate.Report()
                validate.check_doc(doc, self.folder, report)
                self.assertTrue(any(message in e for e in report.errors), report.errors)
        # a tour may point at a task or a part; unknown ones are reported
        tour = {"chapters": [{"id": "c1", "steps": [{"id": "s1", "say": "Read part a first.", "actions": [
            {"type": "highlight", "targets": ["ex1.a"]}, {"type": "box", "target": "ex1"},
            {"type": "box", "target": "ex9.b"}]}]}]}
        report = validate.Report()
        validate.check_tour(tour, self.folder, self.doc, index, 1, report, check_folder=False)
        self.assertEqual(report.errors, ["tour.json $.chapters[0].steps[0].actions[2].target: "
                                         "unknown exercise part 'ex9.b' (not in doc.json)"])

    def test_outline_lists_exercises(self):
        self.ingest(german_sheet)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            outline.main([self.folder])
        text = out.getvalue()
        # the sheet's system of equations is a display without a number: it is the equation equ1
        self.assertIn(", 1 equations, 1 exercises;", text)
        self.assertRegex(text, r"(?m)^equ1 +p1 +p1\.b\d+ +x1 \+ 2 x2 = 5, 3 x1 \+ 4 x2 = 6$")
        self.assertRegex(text, r"(?m)^## Exercises\nex1 +p1 +4 points, p1\.b\d+ … p1\.b\d+ \(\d+ blocks\)$")
        self.assertRegex(text, r"(?m)^ +heading p1\.b\d+: Aufgabe 1 \(4 Punkte\)$")
        self.assertRegex(text, r"(?m)^  ex1\.a +p1 +p1\.b\d+: a\) Berechnen Sie")

    def test_margin_points_do_not_move_the_statement_before_its_heading(self):
        """"Exercise 2 <hfill> (10 pts)": the points row opened the statement's block, which then started on the
        heading's line, sorted ahead of it and put the statement into the task before."""
        def page(p):
            write(p, 72, 80, "Exercise Sheet 6", size=16, font="tibo")
            # the second heading's points sit a hair above its baseline, as typesetting leaves them
            for y, name, pts, shift in ((130, "Exercise 1: Projectile motion", "(8 pts)", 0.0),
                                        (300, "Exercise 2: Block on an incline", "(10 pts)", -0.1)):
                write(p, 72, y, name, size=11, font="tibo")
                write(p, 480, y + shift, pts, size=11)
                write(p, 72, y + 16, STATEMENT + ".")
                write(p, 72, y + 30, "Give every answer to two significant figures.")
                write(p, 80, y + 50, "a) What is the maximum height the ball reaches above the ground?")
                write(p, 480, y + 50, "[2 pts]")
                write(p, 80, y + 68, "b) How far from the kicking point does it land? State the result and show the steps")
                write(p, 94, y + 82, "of your calculation in full.")
                write(p, 480, y + 82, "[3 pts]")
        doc = self.ingest(page)
        one, two = doc["exercises"]
        self.assertEqual([(e["id"], e["title"], e["points"]) for e in (one, two)],
                         [("ex1", "Projectile motion", 8), ("ex2", "Block on an incline", 10)])
        for e in (one, two):
            texts = [self.text(i) for i in e["blocks"]]
            self.assertTrue(texts[0].startswith("Exercise"), texts)
            self.assertEqual(texts[1], f"({e['points']} pts)")       # the points are a block of their own
            self.assertTrue(texts[2].startswith("A ball is kicked"), texts)
            self.assertEqual([p.get("points") for p in e["parts"]], [2, 3])
            self.assertFalse(set(e["blocks"][:3]) & {i for p in e["parts"] for i in p["blocks"]})
        self.assertFalse(set(one["blocks"]) & set(two["blocks"]))
        self.assert_valid()

    def test_points_blocks_at_a_page_margin_are_no_running_heads(self):
        """"[2 pts]" beside the last part of a page and "[3 pts]" beside the first of the next repeat as the same
        text in the margins, but they are points, not a running head."""
        def first(p):
            write(p, 72, 40, "Mechanics 101", size=9)
            write(p, 72, 90, "Exercise Sheet 6", size=16, font="tibo")
            write(p, 72, 130, "Exercise 1 (7 pts)", size=11, font="tibo")
            write(p, 72, 148, "A block slides down a rough incline and then compresses a spring on level ground.")
            write(p, 80, 170, "a) Find the speed of the block at the bottom of the incline.")
            write(p, 480, 170, "[2 pts]")
            write(p, 80, 190, "b) Find the acceleration of the block while it slides down the incline.")
            write(p, 480, 190, "[2 pts]")
            write(p, 80, 780, "c) Find the compression of the spring when the block comes to rest.")
            write(p, 480, 780, "[2 pts]")

        def second(p):
            write(p, 72, 40, "Mechanics 101", size=9)
            write(p, 80, 75, "d) How much energy is dissipated by friction on the way?")
            write(p, 480, 75, "[3 pts]")
        doc = self.ingest(first, second)
        self.assertEqual([(b["text"], b["type"]) for b in doc["blocks"] if "pts]" in b["text"]],
                         [("[2 pts]", "paragraph")] * 3 + [("[3 pts]", "paragraph")])
        ex = doc["exercises"][0]
        self.assertEqual([(p["id"], p["points"]) for p in ex["parts"]],
                         [("ex1.a", 2), ("ex1.b", 2), ("ex1.c", 2), ("ex1.d", 3)])
        self.assertNotIn("header_footer", [self.blocks[i]["type"] for i in ex["blocks"]])
        self.assert_valid()

    def test_points_in_bewertungseinheiten(self):
        """German school sheets count in BE: "Aufgabe 1 (6 BE)" has 6 points and no title called "6 BE"."""
        def page(p):
            write(p, 72, 80, "Mathe-Arbeitsblatt 5", size=16, font="tibo")
            write(p, 72, 120, "Aufgabe 1 (6 BE)", size=11, font="tibo")
            write(p, 72, 138, "Löse die quadratischen Gleichungen.")
            write(p, 72, 156, "a) x^2 - 6x + 8 = 0 (2 BE)")
            write(p, 72, 174, "b) x^2 + 4x + 5 = 0 (4 BE)")
            write(p, 72, 210, "Aufgabe 2 (7 Bewertungseinheiten)", size=11, font="tibo")
            write(p, 72, 228, "Berechne den Flächeninhalt des Dreiecks.")
        doc = self.ingest(page)
        self.assertEqual([(e["id"], e.get("title"), e.get("points")) for e in doc["exercises"]],
                         [("ex1", None, 6), ("ex2", None, 7)])
        self.assertEqual([p.get("points") for p in doc["exercises"][0]["parts"]], [2, 4])
        self.assert_valid()

    def test_points_units(self):
        for text, expected in (("6 BE", 6), ("(2 Pkt.)", 2), ("3 P.", 3), ("4 Punkte", 4), ("5 pts", 5), ("6 points", 6),
                               ("7 marks", 7), ("1,5 BE", 1.5), ("2+3 BE", 5)):
            with self.subTest(text):
                self.assertEqual(ingest.parse_points(text), expected)
        self.assertIsNone(ingest.parse_points("je 2 BE"))
        self.assertEqual(ingest.points_only("(6 BE)"), 6)

    def test_caption_words(self):
        """"Abbildung 1:", "Abb. 2", "Bild 3", "Tabelle 4:" and "Fig. 5" start a caption; "Bildung 1" and "Abbildung eins" do not."""
        for text, kind in (("Abbildung 1: Schaltung", "figure"), ("Abb. 2 Das Ergebnis", "figure"),
                           ("Bild 3: Skizze", "figure"), ("Tabelle 4: Werte", "table"), ("Fig. 5. A graph", "figure"),
                           ("Figure 6: A graph", "figure"), ("Table 7: Data", "table")):
            with self.subTest(text):
                m = ingest.CAPTION_RE.match(text)
                self.assertIsNotNone(m)
                self.assertEqual("table" if m.group(1).lower().startswith("tab") else "figure", kind)
        for text in ("Bildung 1: Ein Wort", "Abbildung eins zeigt", "Tabellen sind nützlich"):
            with self.subTest(text):
                self.assertIsNone(ingest.CAPTION_RE.match(text))
        found = [m.group(1) + " " + m.group(2) for m in ingest.FIG_REF_RE.finditer(
            "Siehe Abbildung 1, Abb. 2 und Tabelle 3 sowie Bild 4 und Table 5.")]
        self.assertEqual(found, ["Abbildung 1", "Abb. 2", "Tabelle 3", "Bild 4", "Table 5"])

    def test_german_caption_makes_a_figure(self):
        def page(p):
            write(p, 72, 80, "Übungsblatt 2", size=16, font="tibo")
            write(p, 72, 130, "Aufgabe 1 (4 Punkte)", size=11, font="tibo")
            paragraph(p, 148, "Die Schaltung in Abbildung 1 besteht aus einer Spannungsquelle und zwei Widerständen, die "
                              "in Reihe geschaltet sind. Die Quelle liefert eine Gleichspannung von zwölf Volt, und die "
                              "Leitungen sind ideal. Alle Ergebnisse sind mit Einheit und auf zwei Stellen genau anzugeben.")
            sketch(p, 230, 215)
            write(p, 190, 305, "Abbildung 1: Eine Quelle mit zwei Widerständen.")
            write(p, 80, 340, "a) Berechnen Sie den Gesamtwiderstand der Schaltung.")
        doc = self.ingest(page)
        fig, = doc["figures"]
        self.assertEqual((fig["id"], fig["kind"], fig["number"]), ("fig1", "figure", "1"))
        self.assertTrue(fig["caption"].startswith("Abbildung 1: Eine Quelle"), fig["caption"])
        self.assertEqual(self.text(fig["caption_block"]), fig["caption"])
        self.assertLessEqual(fig["bbox"][0], 230)
        self.assertGreaterEqual(fig["bbox"][2], 350)
        self.assertEqual(len(fig["referenced_by"]), 1)
        self.assert_valid()

    def test_small_drawings_low_on_the_first_of_two_pages_are_kept(self):
        """The type area of a two-page sheet is not the mean of its pages: a short second page made the small
        drawings low on the first page look like margin clutter."""
        def first(p):
            write(p, 72, 80, "Exercise Sheet 3", size=16, font="tibo")
            write(p, 72, 130, "Exercise 1 (4 points)", size=11, font="tibo")
            paragraph(p, 148, "Draw the two Lewis structures below and explain why each atom has an octet in it. Remember "
                              "that the central atom is the one that forms the most bonds with the rest of the molecule, "
                              "and that hydrogen never takes more than two electrons around it in any structure.")
            for x in (200, 340):         # two small drawings, 24 points high, under the text
                p.draw_polyline([(x, 610), (x + 14, 622), (x + 28, 610), (x + 42, 622)], color=(0, 0, 0), width=1)
                p.draw_line((x + 21, 598), (x + 21, 622), color=(0, 0, 0), width=1)
            write(p, 200, 645, "Figure 1: Two small drawings.")
            paragraph(p, 700, "Remember that the central atom is the one that forms the most bonds with the rest of the "
                              "molecule, and that the octet rule holds for the second period only, where eight electrons "
                              "fill the shell. Use the bonds and the lone pairs to account for all of the valence electrons.",
                      lines=5)

        def second(p):
            write(p, 72, 100, "Exercise 2 (4 points)", size=11, font="tibo")
            paragraph(p, 118, "Give the formal charge of every atom in the second structure of Exercise 1, and say why the "
                              "sum of the charges is what it is. Compare it with the charge of the first structure drawn.",
                      lines=2)
        doc = self.ingest(first, second)
        fig, = doc["figures"]
        self.assertEqual(fig["id"], "fig1")
        self.assertLessEqual(fig["bbox"][0], 201)
        self.assertGreaterEqual(fig["bbox"][2], 380)

    def test_drawings_without_a_caption_are_figures_of_their_task(self):
        def page(p):
            p.draw_line((72, 62), (523, 62), color=(0, 0, 0), width=0.5)          # the running head's rule
            write(p, 72, 55, "Genetics and Mechanics", size=9)
            write(p, 72, 90, "Exercise Sheet 6", size=16, font="tibo")
            write(p, 72, 130, "Exercise 1 (6 pts)", size=11, font="tibo")
            paragraph(p, 148, "Two heterozygous tall plants are crossed; tall (T) is dominant over dwarf (t) stems in this "
                              "species. Give the genotypes and the phenotypes of all offspring with their frequencies, and "
                              "say which of the genotypes are heterozygous in the end.")
            punnett(p, 250, 205)
            write(p, 80, 295, "a) Complete the Punnett square and give the ratio of the genotypes.")
            p.draw_line((330, 295), (450, 295), color=(0, 0, 0), width=0.5)        # a line to fill in
            for a, b in (((72, 310), (222, 310)), ((222, 310), (222, 340)), ((222, 340), (72, 340)),
                         ((72, 340), (72, 310))):                                    # a box around a text
                p.draw_line(a, b, color=(0, 0, 0), width=0.5)
            write(p, 80, 328, "Answer: tall")
            write(p, 72, 380, "Exercise 2 (8 pts)", size=11, font="tibo")
            paragraph(p, 398, "A resistor and a source are wired in a loop as in the sketch below, with a source voltage of "
                              "twelve volts. The wires are ideal and the resistor has a resistance of four ohms. Give each "
                              "result with its unit and with two significant figures, and say what you assumed.")
            sketch(p, 230, 450)
            write(p, 80, 550, "a) Find the current through the resistor in the loop drawn above this line of text.")
        doc = self.ingest(page)
        self.assertEqual([(f["id"], f["kind"], f["number"], f["caption"], f["page"]) for f in doc["figures"]],
                         [("tab1", "table", "1", "Table in Exercise 1", 1),
                          ("fig1", "figure", "1", "Figure in Exercise 2", 1)])
        table, figure = doc["figures"]
        for f in doc["figures"]:
            self.assertNotIn("caption_block", f)
            self.assertEqual((f["panels"], f["referenced_by"]), ([], []))
            self.assertTrue(os.path.exists(os.path.join(self.folder, f["image"])), f["image"])
        self.assertNotIn("grid", table)                   # a blank form has no grid to read
        # the box takes the grid and its labels, the other the circuit and its labels, and nothing else
        self.assertLessEqual(table["bbox"][0], 250 - 9)
        self.assertLessEqual(table["bbox"][1], 205 - 9)
        self.assertGreaterEqual(table["bbox"][2], 310)
        self.assertGreaterEqual(table["bbox"][3], 265)
        self.assertLessEqual(table["bbox"][3], 272)
        self.assertLessEqual(figure["bbox"][:2], [230, 450])
        self.assertGreaterEqual(figure["bbox"][2:], [350, 520])
        self.assertLessEqual(figure["bbox"][3], 525)
        one, two = doc["exercises"]
        inside = lambda e, kind: sorted(self.text(i) for i in e["blocks"] if self.blocks[i]["type"] == kind)
        self.assertEqual((inside(one, "table_text"), inside(two, "figure_text")), (["T", "T t", "t"], ["R1", "U0"]))
        # the rule, the line to fill in and the box around the text are no figures; the parts are where they were
        self.assertEqual([p["id"] for p in one["parts"] + two["parts"]], ["ex1.a", "ex2.a"])
        self.assert_valid()

    def test_a_logo_in_the_page_body_is_no_figure(self):
        """A logo set in the page body beside the course line ends below the 12 % band of the page, but it is above the
        first task, so it belongs to no task; a logo that sits in the foot of every page is repeated. A drawing that
        stands above the first heading of a page that goes on from an earlier one is a drawing of that task."""
        def logo():
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), False)
            pix.set_rect(pix.irect, (30, 90, 160))
            return pix.tobytes("png")

        def first(p):
            write(p, 72, 101, "Analysis I, Wintersemester 2026/27", size=9)
            p.insert_image(pymupdf.Rect(455, 58, 531, 105), stream=logo())        # ends at 105, which is 12.5 % of 842
            write(p, 72, 150, "Uebungsblatt 3", size=16, font="tibo")
            write(p, 72, 190, "Aufgabe 1 (4 Punkte)", size=11, font="tibo")
            paragraph(p, 208, "Gegeben ist die Funktion f mit f(x) = x^2 - 4x + 3. Bestimmen Sie die Nullstellen von f und "
                              "begruenden Sie jeden Schritt Ihrer Rechnung mit einem kurzen Satz in Ihren eigenen Worten.")
            p.insert_image(pymupdf.Rect(480, 725, 531, 765), stream=logo())        # in the foot: starts at 86 %
            write(p, 72, 780, "Seite 1", size=8)

        def second(p):
            sketch(p, 230, 100)                                                     # the circuit of Aufgabe 1, going on
            write(p, 72, 230, "Aufgabe 2 (4 Punkte)", size=11, font="tibo")
            paragraph(p, 248, "Berechnen Sie den Strom durch den Widerstand in der Schaltung, die oben gezeichnet ist, und "
                              "geben Sie das Ergebnis mit seiner Einheit und auf zwei Stellen genau an, mit einem Satz.")
            p.insert_image(pymupdf.Rect(480, 725, 531, 765), stream=logo())
            write(p, 72, 780, "Seite 2", size=8)
        doc = self.ingest(first, second)
        fig, = doc["figures"]
        self.assertEqual((fig["page"], fig["caption"]), (2, "Abbildung in Aufgabe 1"))
        self.assertGreater(fig["bbox"][1], 90)
        self.assertEqual([e["id"] for e in doc["exercises"]], ["ex1", "ex2"])
        self.assert_valid()

    def test_a_box_around_a_short_text_is_no_figure(self):
        """A box drawn as a filled, rounded path and a smaller fill inside it (tcolorbox) has curves and covers its inside,
        but nothing is drawn in it. A box with a drawing in it, or lines across it, is still a figure."""
        def box(p, y, text, inside=None):
            p.draw_rect(pymupdf.Rect(72, y, 523, y + 30), color=None, fill=(0.25, 0.25, 0.25), radius=0.2)
            p.draw_rect(pymupdf.Rect(73.4, y + 1.4, 521.6, y + 28.6), color=None, fill=(0.95, 0.95, 0.95), radius=0.2)
            if text:
                write(p, 82, y + 19, text)
            if inside:
                inside(p)

        def page(p):
            write(p, 72, 80, "Uebungsblatt 5", size=16, font="tibo")
            write(p, 72, 130, "Aufgabe 1 (6 Punkte)", size=11, font="tibo")
            paragraph(p, 148, "Gegeben ist die Funktion f mit f(x) = x^2 - 4x + 3. Bestimmen Sie die Nullstellen von f und "
                              "begruenden Sie jeden Schritt Ihrer Rechnung mit einem kurzen Satz in Ihren eigenen Worten.")
            write(p, 80, 205, "a) Bestimmen Sie die Nullstellen von f.")
            box(p, 225, "Hinweis: Nutzen Sie die pq-Formel.")
            write(p, 72, 300, "Aufgabe 2 (6 Punkte)", size=11, font="tibo")
            paragraph(p, 318, "Berechnen Sie den Strom durch den Widerstand in der Schaltung, die im Kasten gezeichnet ist, und "
                              "geben Sie das Ergebnis mit seiner Einheit und auf zwei Stellen genau an, mit einem Satz.")
            p.draw_rect(pymupdf.Rect(200, 380, 400, 480), color=None, fill=(0.9, 0.9, 0.9), radius=0.1)
            sketch(p, 240, 395)
            write(p, 72, 520, "Aufgabe 3 (4 Punkte)", size=11, font="tibo")
            paragraph(p, 538, "Fuellen Sie das Feld aus, in dem die beiden Merkmale gekreuzt werden, und geben Sie das "
                              "Verhaeltnis der Genotypen an. Begruenden Sie die Antwort mit einem kurzen Satz dazu.")
            p.draw_rect(pymupdf.Rect(250, 600, 310, 660), color=(0, 0, 0), width=0.6)       # a Punnett square: outline and two lines
            p.draw_line((250, 630), (310, 630), color=(0, 0, 0), width=0.6)
            p.draw_line((280, 600), (280, 660), color=(0, 0, 0), width=0.6)
        doc = self.ingest(page)
        self.assertEqual([(f["caption"], f["kind"]) for f in doc["figures"]],
                         [("Abbildung in Aufgabe 2", "figure"), ("Abbildung in Aufgabe 3", "figure")])
        one = doc["exercises"][0]
        hint = [self.blocks[i] for i in one["blocks"] if self.text(i).startswith("Hinweis")]
        self.assertEqual([b["type"] for b in hint], ["paragraph"])
        self.assertTrue(hint[0]["sentences"])
        self.assertEqual([self.blocks[i]["type"] for i in one["blocks"]].count("figure_text"), 0)
        self.assert_valid()

    def test_booktabs_rules_without_a_caption_make_a_table(self):
        def page(p):
            write(p, 72, 90, "Problem Sheet 2", size=16, font="tibo")
            write(p, 72, 130, "Problem 1 [8 points]", size=11, font="tibo")
            paragraph(p, 148, "Fill in the missing entries of the table for the reaction of dinitrogen tetroxide, which "
                              "dissociates into nitrogen dioxide in a closed vessel at a fixed temperature, until a state "
                              "of equilibrium has been reached; the amount x is the change in the first concentration.")
            for y in (200, 220, 282):
                p.draw_rect(pymupdf.Rect(150, y, 450, y + 0.7), color=None, fill=(0, 0, 0))
            for x, t in ((180, "[N2O4] / M"), (320, "[NO2] / M")):
                write(p, x, 214, t)
            for k, (label, a, b) in enumerate((("Initial", "0.0500", "0"), ("Change", "-x", "+2x"), ("Equilibrium", "", ""))):
                write(p, 160, 238 + 16 * k, label)
                write(p, 200, 238 + 16 * k, a)
                write(p, 340, 238 + 16 * k, b)
            write(p, 80, 320, "(a) Compute the equilibrium concentrations if x = 0.0300 mol per litre.")
        doc = self.ingest(page)
        table, = doc["figures"]
        self.assertEqual((table["id"], table["kind"], table["caption"]), ("tab1", "table", "Table in Problem 1"))
        self.assertLessEqual(table["bbox"][1], 201)
        self.assertGreaterEqual(table["bbox"][3], 282)
        cells = " ".join(self.text(i) for i in doc["exercises"][0]["blocks"] if self.blocks[i]["type"] == "table_text")
        self.assertIn("0.0500", cells)
        self.assert_valid()

    def test_a_loose_drawing_goes_on_from_the_printed_numbers(self):
        """A drawing without a caption takes the next number after the printed ones, whichever comes first on the
        page, and no sentence that cites "Figure 1" is linked to it."""
        def page(p):
            write(p, 72, 90, "Exercise Sheet 6", size=16, font="tibo")
            write(p, 72, 130, "Exercise 1 (6 pts)", size=11, font="tibo")
            paragraph(p, 148, "Sketch the forces on the block in the picture below before you start to compute, and name "
                              "every force with its direction. The block rests on the incline and does not move at all, "
                              "so the forces must balance each other in every direction that you can choose.")
            sketch(p, 230, 215)
            write(p, 72, 320, "Exercise 2 (6 pts)", size=11, font="tibo")
            paragraph(p, 338, "The circuit of Figure 1 has a source, a resistor and a wire that closes the loop, and it is "
                              "the same circuit that you met in the lecture. Find the current in the loop, and then the "
                              "power that the source delivers to the resistor, in watts and to three significant figures.")
            sketch(p, 230, 405)
            write(p, 230, 495, "Figure 1: The circuit of this exercise.")
        doc = self.ingest(page)
        figs = {f["id"]: f for f in doc["figures"]}
        self.assertEqual(sorted(figs), ["fig1", "fig2"])
        self.assertEqual(figs["fig1"]["caption"], "Figure 1: The circuit of this exercise.")
        self.assertEqual(figs["fig2"]["caption"], "Figure in Exercise 1")
        self.assertEqual(len(figs["fig1"]["referenced_by"]), 1)
        self.assertEqual(figs["fig2"]["referenced_by"], [])
        self.assertLess(figs["fig2"]["bbox"][1], figs["fig1"]["bbox"][1])
        self.assert_valid()

    def test_german_sheet_names_its_loose_figure_in_german(self):
        def page(p):
            write(p, 72, 90, "Übungsblatt 4", size=16, font="tibo")
            write(p, 72, 130, "Aufgabe 1 (4 Punkte)", size=11, font="tibo")
            paragraph(p, 148, "Berechnen Sie den Strom durch den Widerstand in der folgenden Schaltung. Die Quelle liefert "
                              "zwölf Volt, die Leitungen sind ideal, und der Widerstand hat vier Ohm. Geben Sie jedes "
                              "Ergebnis mit seiner Einheit und auf zwei Stellen genau an.")
            sketch(p, 230, 215, labels=(("R", 45, 60), ("U", 30, 20)))
        doc = self.ingest(page)
        fig, = doc["figures"]
        self.assertEqual((fig["id"], fig["caption"]), ("fig1", "Abbildung in Aufgabe 1"))

    def test_a_paper_has_no_loose_figures(self):
        """Without task headings the page is a paper's: a drawing without a caption is left alone."""
        def paper(p):
            write(p, 72, 80, "Solving Hard Problems Quickly", size=18, font="tibo")
            write(p, 72, 104, "Jane Doe and John Roe", size=11)
            write(p, 72, 140, "Abstract", size=11, font="tibo")
            write(p, 72, 158, "We study search problems whose state spaces grow quickly with the input size.")
            write(p, 72, 172, "Our method prunes most of the space and finds solutions in practice.")
            write(p, 72, 206, "1 Introduction", size=12, font="tibo")
            paragraph(p, 226, "The picture below sketches the search tree that the method explores in practice, and it "
                              "shows how most branches are cut off early. Earlier work solved the problem only for small "
                              "inputs, and we show in the following sections how to scale the method up to large ones.")
            sketch(p, 230, 290)
            paragraph(p, 390, "Earlier work solved it only for small inputs, and we show how to scale it up to much larger "
                              "inputs, which is the main result of the paper that we present here in the following pages.")
        doc = self.ingest(paper, name="paper")
        self.assertEqual(doc["figures"], [])
        self.assertNotIn("exercises", doc)

    def test_task_headings_are_no_sections(self):
        """A bold "1. Aufgabe: Titel" reads like a numbered section heading; it is a task, listed once."""
        def page(p):
            write(p, 72, 80, "Elektrotechnik Blatt 3", size=16, font="tibo")
            write(p, 72, 130, "1. Aufgabe: Gleichstromkreis", font="tibo")
            write(p, 480, 130, "(8 Punkte)")
            write(p, 72, 146, "Eine Quelle speist zwei Widerstände R1 und R2, die in Reihe geschaltet sind, mit der Spannung.")
            write(p, 80, 170, "a) Berechnen Sie den Gesamtstrom.")
            write(p, 72, 210, "2. Aufgabe: Leistung", font="tibo")
            write(p, 480, 210, "(5 Punkte)")
            write(p, 72, 226, "Betrachten Sie die Schaltung aus der ersten Aufgabe und berechnen Sie die Verlustleistung.")
        doc = self.ingest(page)
        self.assertEqual([(e["id"], e["title"], e["points"]) for e in doc["exercises"]],
                         [("ex1", "Gleichstromkreis", 8), ("ex2", "Leistung", 5)])
        self.assertEqual(doc["sections"], [])
        self.assertEqual({self.blocks[e["block"]]["type"] for e in doc["exercises"]}, {"heading"})
        self.assertTrue(all("section" not in self.blocks[e["block"]] for e in doc["exercises"]))
        self.assert_valid()

    def test_a_part_the_layout_orders_late_is_not_lost(self):
        """A display formula beside "(c)" and "(d)" can sort the block of "(d)" ahead of "(c)"; the parts then come in
        label order again, and none is lost."""
        def page(p):
            write(p, 72, 80, "Homework 8", size=16, font="tibo")
            write(p, 72, 130, "Problem 1 (8 points)", size=11, font="tibo")
            write(p, 72, 148, "Evaluate the following limits, or explain why they do not exist.")
            for k, label in enumerate("abcd"):
                write(p, 80, 180 + 30 * k, f"({label}) Compute the limit number {k + 1} of the list.")
            write(p, 72, 330, "Problem 2 (4 points)", size=11, font="tibo")
            write(p, 80, 350, "(a) Differentiate the function f(x) = x^3 - 2x.")
        real = ingest._sort_rows

        def late(items):
            out = real(items)
            at = {t: i for i, it in enumerate(out) for t in ("(c)", "(d)") if it[1][0].raw_text.startswith(t)}
            if len(at) == 2:
                out[at["(c)"]], out[at["(d)"]] = out[at["(d)"]], out[at["(c)"]]
            return out
        with mock.patch.object(ingest, "_sort_rows", late):
            doc = self.ingest(page)
        one, two = doc["exercises"]
        self.assertEqual([p["id"] for p in one["parts"]], ["ex1.a", "ex1.b", "ex1.c", "ex1.d"])
        self.assertEqual([self.text(p["blocks"][0])[:3] for p in one["parts"]], ["(a)", "(b)", "(c)", "(d)"])
        self.assertTrue(all(len(p["blocks"]) == 1 for p in one["parts"]))
        self.assertEqual([p["id"] for p in two["parts"]], ["ex2.a"])
        order = [b["id"] for b in doc["blocks"]]
        self.assertEqual(order.index(one["parts"][2]["blocks"][0]) + 1, order.index(one["parts"][3]["blocks"][0]))
        self.assert_valid()

    def test_nested_sub_parts_do_not_break_the_part_order(self):
        """"(i)", "(ii)" under "(a)" and again under "(b)", or "b)" followed by "(i)", "(ii)" at one indent, are no one list
        to put in label order: the sheet is ingested, and nothing is reordered or lost."""
        def twice(p):
            write(p, 72, 80, "Homework 9", size=16, font="tibo")
            write(p, 72, 130, "Problem 1 (8 points)", size=11, font="tibo")
            write(p, 72, 148, "Consider the following questions about the function f.")
            for k, label in enumerate(["(a)", "(i)", "(ii)", "(b)", "(i)", "(ii)"]):
                write(p, 80, 180 + 22 * k, f"{label} Answer the question number {k + 1} of this list.")
            write(p, 72, 340, "Problem 2 (4 points)", size=11, font="tibo")
            write(p, 80, 360, "(a) Differentiate the function f(x) = x^3 - 2x.")

        def mixed(p):
            write(p, 72, 80, "Homework 9", size=16, font="tibo")
            write(p, 72, 130, "Problem 1 (8 points)", size=11, font="tibo")
            write(p, 72, 148, "Consider the following questions about the function f.")
            for k, label in enumerate(["a)", "b)", "(i)", "(ii)"]):
                write(p, 80, 180 + 22 * k, f"{label} Answer the question number {k + 1} of this list.")
            write(p, 72, 340, "Problem 2 (4 points)", size=11, font="tibo")
            write(p, 80, 360, "(a) Differentiate the function f(x) = x^3 - 2x.")
        self.assertIsNone(ingest.label_rank(["a", "i", "ii", "b", "i", "ii"]))
        self.assertIsNone(ingest.label_rank(["a", "b", "i", "ii"]))
        self.assertIsNone(ingest.label_rank(["i", "ii", "i", "ii"]))
        self.assertEqual(sorted(["iii", "ii", "iv"], key=ingest.label_rank(["ii", "iii", "iv"])), ["ii", "iii", "iv"])
        self.assertEqual(ingest.label_rank(["a", "b", "c"]), ord)
        with self.subTest("twice"):
            one, two = self.ingest(twice, name="twice")["exercises"]
            self.assertEqual([p["id"] for p in one["parts"]], ["ex1.a", "ex1.b"])
            self.assertEqual([self.text(p["blocks"][0])[:3] for p in one["parts"]], ["(a)", "(b)"])
            self.assertEqual([p["id"] for p in two["parts"]], ["ex2.a"])
            self.assert_valid()
        with self.subTest("mixed"):
            one, two = self.ingest(mixed, name="mixed")["exercises"]
            self.assertEqual([p["id"] for p in one["parts"]], ["ex1.a", "ex1.b"])
            self.assertEqual([q["id"] for q in one["parts"][1]["parts"]], ["ex1.b.i", "ex1.b.ii"])
            self.assertEqual([p["id"] for p in two["parts"]], ["ex2.a"])
            self.assert_valid()

    def test_sheet_text_is_tidied(self):
        """Chemistry arrows set as bars and a head become one arrow, and U+FFFD, the piece of a large bracket, goes."""
        tidy, gone = ingest.tidy_sheet_text, chr(0xFFFD)
        self.assertEqual((tidy("−−→CO2"), tidy("−−→"), tidy("−→(g)"), tidy("x→0")), ("→ CO2", "→", "→ (g)", "x→0"))
        self.assertEqual((tidy("−−⇀"), tidy("↽−−2"), tidy("a" + gone + "b"), tidy(gone)), ("⇌", "2", "ab", ""))
        tokens = [ingest.Token(t, 0, (k, 0, k + 1, 1), 0.0)
                  for k, t in enumerate(["N2O4(g)", "−−⇀", "↽−−2", "NO2(g)", gone, "x"])]
        kept = ingest.tidy_tokens(tokens)
        self.assertEqual([t.text for t in kept], ["N2O4(g)", "⇌", "2", "NO2(g)", "x"])
        self.assertEqual(len(kept[3].frags), 2)           # the dropped glyph's box stays with the token before it
