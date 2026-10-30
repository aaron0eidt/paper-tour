"""Split accents: a spacing diacritic and its letter become the precomposed character."""

import unittest
from unittest import mock

import pymupdf

import accents
import ingest


def seq(text, skip=None):
    return list(text), skip


class ComposeText(unittest.TestCase):
    def test_accent_before_its_letter(self):
        """TeX sets the accent first: "L¨ose" is "Löse"; the capital after a diaeresis too."""
        self.assertEqual(accents.compose_text("L¨ose das Gleichungssystem f¨ur K¨orper"),
                         "Löse das Gleichungssystem für Körper")
        self.assertEqual(accents.compose_text("¨Ubungsaufgaben"), "Übungsaufgaben")

    def test_accent_after_its_letter(self):
        """Some tools set the letter first: "Mu¨ller", "fu¨r"."""
        self.assertEqual(accents.compose_text("Mu¨ller fu¨r e´te´", "after"), "Müller für été")

    def test_every_accent(self):
        before = (("¨o", "ö"), ("´e", "é"), ("`a", "à"), ("ˆo", "ô"), ("˜n", "ñ"), ("¸c", "ç"), ("ˇs", "š"))
        for text, expected in before:
            self.assertEqual(accents.compose_text("x " + text + "x"), "x " + expected + "x", text)
        after = (("o¨", "ö"), ("e´", "é"), ("a`", "à"), ("oˆ", "ô"), ("n˜", "ñ"), ("c¸", "ç"), ("sˇ", "š"))
        for text, expected in after:
            self.assertEqual(accents.compose_text("x" + text + " x", "after"), "x" + expected + " x", text)

    def test_combining_forms_follow_their_letter(self):
        """A combining diaeresis after the letter is composed whatever the document's order; one before it moves."""
        self.assertEqual(accents.compose_text("Löse", "before"), "Löse")
        self.assertEqual(accents.compose_text("L̈ose", "before"), "Löse")
        self.assertEqual(accents.compose_text("été", "before"), "été")

    def test_dotless_i(self):
        self.assertEqual(accents.compose_text("na´ıve ˆıle"), "naíve île")

    def test_a_letter_without_a_precomposed_form_is_left_alone(self):
        """No character for L with a diaeresis: nothing to join, and no letter is lost."""
        self.assertEqual(accents.compose_text("x ¨ y"), "x ¨ y")
        self.assertEqual(accents.compose_text("¨ x"), "¨ x")
        self.assertEqual(accents.compose_text("Q¨ q"), "Q¨ q")

    def test_apostrophes_are_not_accents(self):
        """An acute after a consonant, or before a contraction ending, is an apostrophe."""
        for text in ("dont´ know", "it´s", "I´ll go", "you´ve", "rock´n roll"):
            self.assertEqual(accents.compose_text(text, "after"), text, text)
        self.assertEqual(accents.compose_text("Rene´ Descartes", "after"), "René Descartes")

    def test_an_accent_that_fits_both_neighbours_follows_the_document(self):
        self.assertEqual(accents.compose_text("Ba¨ume", "after"), "Bäume")
        self.assertEqual(accents.compose_text("B¨aume", "before"), "Bäume")
        # Read the other way round the same characters make another word: the order decides.
        self.assertEqual(accents.compose_text("Ba¨ume", "before"), "Baüme")

    def test_nothing_is_joined_twice(self):
        self.assertEqual(accents.compose_text("o¨¨o", "after"), "ö¨o")

    def test_text_without_accents_is_untouched(self):
        text = "Attention is all you need (2017); f(x) = x^2, a ~ b, `code`"
        self.assertEqual(accents.compose_text(text), text)

    def test_other_scripts(self):
        self.assertEqual(accents.compose_text("¨Ι"), "Ϊ")
        self.assertEqual(accents.compose_text("a¨", "after"), "ä")


class Order(unittest.TestCase):
    def test_the_accents_that_fit_one_side_decide(self):
        before = [seq("f¨ur K¨orper L¨osung")]
        after = [seq("fu¨r Ko¨rper Lo¨sung")]
        self.assertEqual(accents.accent_order(before), "before")
        self.assertEqual(accents.accent_order(after), "after")
        self.assertEqual(accents.accent_order(before + after + after), "after")

    def test_without_evidence_it_is_before(self):
        self.assertEqual(accents.accent_order([]), "before")
        self.assertEqual(accents.accent_order([seq("Ba¨ume")]), "before")

    def test_skipped_characters_do_not_vote(self):
        everything = lambda j: True
        self.assertEqual(accents.accent_order([("fu¨r", everything)] * 3), "before")


class ComposeChars(unittest.TestCase):
    def chars(self, text):
        # (text, bbox, baseline, size, font, flags)
        return [(c, (i * 5.0, 0.0, i * 5.0 + 5, 10.0), 9.0, 10.0, "cmr10" if c != "o" else "cmr10", 0)
                for i, c in enumerate(text)]

    def test_the_accent_and_its_letter_become_one_char_with_a_box_around_both(self):
        chars = self.chars("L¨ose")
        out = accents.compose_chars(chars, "before")
        self.assertEqual("".join(c[0] for c in out), "Löse")
        self.assertEqual(out[1][1], (5.0, 0.0, 15.0, 10.0))
        self.assertEqual(out[1][2:], chars[2][2:])

    def test_a_skipped_letter_keeps_its_accent(self):
        chars = self.chars("x¨o")
        out = accents.compose_chars(chars, "before", skip=lambda c: c[0] == "o")
        self.assertEqual("".join(c[0] for c in out), "x¨o")

    def test_four_field_tuples_work_too(self):
        chars = [("K", (0, 0, 5, 9), 8, 10), ("¨", (5, 0, 9, 9), 8, 10), ("o", (9, 0, 14, 9), 8, 10)]
        self.assertEqual([c[0] for c in accents.compose_chars(chars)], ["K", "ö"])


class IngestedText(unittest.TestCase):
    def analyse(self, lines, size=11):
        doc = pymupdf.open()
        page = doc.new_page(width=612, height=792)
        for i, line in enumerate(lines):
            page.insert_text((72, 100 + 16 * i), line, fontsize=size, fontname="tiro")
        pdf = pymupdf.open("pdf", doc.tobytes())
        with mock.patch.object(ingest, "warn", lambda msg: None):
            pages, _, _, _, stats = ingest.analyse(pdf)
        return [s["text"] for page in pages for s in page.sentences], stats

    def test_a_latex_style_document_reads_with_its_umlauts(self):
        texts, stats = self.analyse(["L¨ose das lineare Gleichungssystem f¨ur die K¨orper der Zahlen.",
                                     "¨Uber die L¨osung der Aufgabe sprechen wir sp¨ater."])
        self.assertEqual(stats.accent_order, "before")
        joined = " ".join(texts)
        self.assertIn("Löse das lineare Gleichungssystem für die Körper der Zahlen.", joined)
        self.assertIn("Über die Lösung der Aufgabe sprechen wir später.", joined)
        self.assertNotIn("¨", joined)

    def test_a_document_that_sets_the_letter_first_reads_with_its_umlauts(self):
        texts, stats = self.analyse(["Die Lo¨sung fu¨r den Mu¨ller steht in der Ba¨ume Liste.",
                                     "Das ist nu¨tzlich fu¨r Ko¨rper und ihre Ha¨user."])
        self.assertEqual(stats.accent_order, "after")
        joined = " ".join(texts)
        self.assertIn("Die Lösung für den Müller steht in der Bäume Liste.", joined)
        self.assertIn("Häuser", joined)

    def test_text_without_accents_is_unchanged(self):
        texts, stats = self.analyse(["The model reads every line of the page and groups the lines into blocks."])
        self.assertEqual(texts, ["The model reads every line of the page and groups the lines into blocks."])
        self.assertEqual(stats.accent_order, "before")

    def test_a_table_grid_composes_too(self):
        grid = {"columns": [{"name": "Gr¨oße", "kind": "text"}],
                "rows": [{"label": "K¨orper", "cells": [{"text": "f¨ur"}]}], "notes": ["Aufl¨osung"]}
        out = ingest.compose_in(grid, "before")
        self.assertEqual(out, {"columns": [{"name": "Größe", "kind": "text"}],
                               "rows": [{"label": "Körper", "cells": [{"text": "für"}]}], "notes": ["Auflösung"]})


if __name__ == "__main__":
    unittest.main()
