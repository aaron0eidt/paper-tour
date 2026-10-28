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
        self.assertIn(", 0 equations, 1 exercises;", text)
        self.assertRegex(text, r"(?m)^## Exercises\nex1 +p1 +4 points, p1\.b\d+ … p1\.b\d+ \(\d+ blocks\)$")
        self.assertRegex(text, r"(?m)^ +heading p1\.b\d+: Aufgabe 1 \(4 Punkte\)$")
        self.assertRegex(text, r"(?m)^  ex1\.a +p1 +p1\.b\d+: a\) Berechnen Sie")
