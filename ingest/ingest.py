#!/usr/bin/env python3
"""Paper Tour ingestion: turn a PDF paper into doc.json plus figure crops.

    ingest.py <pdf> [--out DIR] [--debug]

Writes DIR/doc.json and DIR/figures/<id>.png (DIR defaults to the PDF's folder).
--debug also renders DIR/_debug/page-NN.png with every detected element drawn on top.

Coordinates are PDF points, origin at the top-left of the page, y down (PyMuPDF);
a bbox is [x0, y0, x1, y1]. The pipeline per page is:

  chars -> words -> rows (one baseline) -> blocks (rows of one paragraph, heading, ...)
  graphics (images, visible vector paths) + captions -> figure and table regions
  classification -> reading order -> sections -> sentences -> doc.json

A table that can be read without guessing also gets a typed grid of what it prints (table_grid.py). Display
equations come with their printed number (eq1, eq5a) or, without one, as equ1, equ2, ... in reading order.

On an exercise sheet, task headings ("Aufgabe 1 (4 Punkte)") are found before classification and the
tasks and their parts ("a)", "(b)") after reading order; doc.json then has an "exercises" list. Other
documents come out exactly as without that step.
"""

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from statistics import median

import jsonschema
import pymupdf

import accents
import table_grid

VERSION = "0.2"
SCHEMA_ID = "paper-tour/doc@0.1"
HERE = os.path.dirname(os.path.abspath(__file__))
DOC_SCHEMA = os.path.normpath(os.path.join(HERE, os.pardir, "schema", "doc.schema.json"))

# No TEXT_PRESERVE_LIGATURES: MuPDF then expands "ﬁ" into "f" + "i", each with its own box.
TEXT_FLAGS = pymupdf.TEXT_MEDIABOX_CLIP
FIGURE_DPI = 200
DEBUG_DPI = 110

CAPTION_RE = re.compile(r"^(Figure|Fig\.?|FIGURE|FIG\.?|Table|TABLE|Tab\.)\s*([A-Z]?\d+[a-z]?|[IVX]+)(?:\s*[:.|]|\s*$|\s+(?=[A-Z]))")
NUM_HEADING_RE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([A-Za-z].*)$")
ROMAN_HEADING_RE = re.compile(r"^([IVXLCDM]{1,8})\.\s+([A-Z].*)$")
LETTER_HEADING_RE = re.compile(r"^([A-Z](?:\.\d{1,2}){0,3})\.?\s+([A-Z].*)$")
SUBSECTION_RE = re.compile(r"^([A-Z])\.\s+([A-Z].*)$")        # IEEE "A. Overview"
ABSTRACT_RE = re.compile(r"^(Abstract|ABSTRACT)\b\s*[-—–:.]?\s*\S")
EQ_TAG_RE = re.compile(r"^\(([A-Z]?\.?\d{1,3}[a-z]?)\)$")
FIG_REF_RE = re.compile(
    r"\b(Fig(?:ure)?s?\.?|Tab(?:le)?s?\.?)\s*~?"
    r"(\d+[a-z]?(?:\s*(?:,|and|&|or|-|–|—|to)\s*\d+[a-z]?)*)", re.I)
PAGE_NUMBER_RE = re.compile(r"^(\d{1,4}|[ivxlc]{1,6}|page \d+( of \d+)?)$", re.I)
VENUE_RE = re.compile(r"conference|proceedings|workshop|preprint|copyright|©|licen[cs]e|arxiv|journal|vol\.", re.I)
FOOTNOTE_MARK_RE = re.compile(r"^[\d∗*†‡§¶‖#a-z]{1,3}")
BULLETS = {"•", "◦", "▪", "▸", "►", "∙", "‣"}

# Exercise sheets (see find_exercises): task headings such as "Aufgabe 2.3 (4 Punkte)", "Exercise 2 [6 points]",
# "Hausaufgabe H1" or "1. Aufgabe", and the parts under a task: "a)", "(b)", "(ii)", "c.".
_GERMAN_TASK = r"(?!Teil)(?:[A-ZÄÖÜ][a-zäöüß]*aufgabe|Aufgabe|AUFGABE|Übung|ÜBUNG|Uebung)"
_TASK_END = r"\*?(?=$|\s|[.:(\[–—])"
TASK_RE = re.compile(
    r"^(?P<kw>" + _GERMAN_TASK + r"|Exercise|EXERCISE|Problem|PROBLEM|Task|TASK|Question|QUESTION)\s*"
    r"(?P<num>[A-Z]?\d{1,3}(?:\.\d{1,3}){0,2}[a-z]?|[IVX]{1,5})" + _TASK_END)
TASK_NUMBER_FIRST_RE = re.compile(r"^(?P<num>\d{1,3})\.\s*(?P<kw>" + _GERMAN_TASK + r")" + _TASK_END)
SHEET_WORDS = ("aufgabe", "übung", "uebung", "exercise")      # never a paper's run-in heading
PAPER_HEADINGS = {"abstract", "references", "bibliography"}
PART_RE = re.compile(r"^(?:\((?P<p>[a-z]|[ivx]{1,4})\)|(?P<q>[a-z]|[ivx]{1,4})[).])(?=\s|$)")
# Other list items ("2.", "(3)", "•"): not parts, but they end the parts indented further than them
LIST_MARK_RE = re.compile(r"^(?:\d{1,2}[.)]|\(\d{1,2}\)|[•◦▪▸►∙‣–—*-])(?=\s)")
_POINTS_UNIT = r"(?:Bonuspunkte|Punkte|Punkt|Pkt|Pts|Pt|points|point|marks|mark|BP|P)\.?"
POINTS_RE = re.compile(
    r"(?<![\w.,])(\d{1,3}(?:[.,]\d{1,2})?(?:\s*\+\s*\d{1,3}(?:[.,]\d{1,2})?)*)\s*" + _POINTS_UNIT
    + r"(?=\s*(?:[)\],;]|$))", re.I)
# "20: 5,10,5 pts.": the total and then the points of each part (the numbers are told from a decimal comma by their sum)
PART_POINTS_RE = re.compile(
    r"(?<![\w.,])(?P<total>\d{1,3}(?:[.,]\d{1,2})?)\s*[:=]\s*"
    r"(?P<parts>\d{1,3}(?:[.,]\d{1,2})?(?:\s*[,;+/]\s*\d{1,3}(?:[.,]\d{1,2})?)+)\s*" + _POINTS_UNIT
    + r"(?=\s*(?:[)\],;]|$))", re.I)
ROMAN_LABELS = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii"]
# First words of a statement run in after a task heading ("Aufgabe 1: Gegeben sei ..."), as opposed to a title
STATEMENT_WORDS = {
    "sei", "seien", "es", "gegeben", "man", "wir", "zeigen", "berechnen", "bestimmen", "beweisen", "lösen",
    "finden", "geben", "untersuchen", "entscheiden", "betrachten", "begründen", "skizzieren", "prüfen",
    "überprüfen", "verwenden", "implementieren", "schreiben", "für", "ist", "sind", "wie", "was", "welche",
    "welcher", "welches", "warum", "bitte", "löse", "löst", "zeige", "berechne", "bestimme", "beweise", "finde",
    "gib", "gibt", "untersuche", "entscheide", "betrachte", "begründe", "skizziere", "prüfe", "überprüfe",
    "verwende", "implementiere", "schreibe", "ermittle", "stelle", "bringe", "vereinfache", "zeichne", "erkläre",
    "nenne", "wähle", "formuliere", "vergleiche", "bilde", "gilt", "kann", "können", "let", "show", "prove",
    "compute", "find", "consider", "suppose", "assume", "determine", "calculate", "given", "solve", "use", "write",
    "explain", "derive", "describe", "give", "verify", "evaluate", "implement", "sketch", "state", "recall", "define",
    "check", "what", "how", "which", "why", "is", "are", "does", "do", "can", "we", "if", "for", "in",
}

UNNUMBERED_HEADINGS = {
    "abstract", "references", "bibliography", "acknowledgements", "acknowledgments",
    "acknowledgement", "acknowledgment", "appendix", "appendices", "supplementary material",
    "limitations", "ethics statement", "ethical considerations", "broader impact",
    "broader impacts", "conclusion", "conclusions", "introduction", "related work",
}
RUN_IN_HEADINGS = {"acknowledgements", "acknowledgments", "acknowledgement", "acknowledgment"}
REFERENCE_HEADINGS = {"references", "bibliography", "literature cited", "works cited"}

# Tokens ending in "." that do not end a sentence (compared lowercased, without brackets).
ABBREVIATIONS = {
    "e.g.", "i.e.", "al.", "fig.", "figs.", "eq.", "eqs.", "sec.", "secs.", "tab.", "vs.",
    "cf.", "approx.", "resp.", "no.", "nos.", "ch.", "ref.", "refs.", "dr.", "mr.", "mrs.",
    "ms.", "prof.", "inc.", "jr.", "sr.", "st.", "pp.", "vol.", "eds.", "ed.", "viz.",
    "ca.", "esp.", "w.r.t.", "a.k.a.", "sect.", "def.", "thm.", "lem.", "prop.", "app.",
}
# Line-end hyphen + lowercase continuation: keep the hyphen after these words when the
# document itself gives no evidence either way ("self-" / "attention").
COMPOUND_PREFIXES = {
    "self", "multi", "non", "co", "cross", "semi", "sub", "pre", "post", "inter", "intra",
    "well", "single", "two", "three", "four", "high", "low", "long", "short", "large",
    "small", "fine", "dot", "feed", "end", "task", "word", "byte", "encoder", "decoder",
    "point", "left", "right", "top", "bottom", "zero", "few", "one", "real", "human",
}

# Word endings that a line-end hyphen splits off ("learn-" "ing"): never a compound.
SUFFIX_RE = re.compile(
    r"(ing|ings|ed|ly|tion|tions|ation|ations|ization|izations|ment|ments|ness|er|ers|able|ible|"
    r"ity|ities|al|ally|ive|ively|ous|ize|ized|izes|ence|ences|ance|ances|ist|ists|ism|ful|less|est)")
BOLD_FONT_RE = re.compile(r"bold|black|heavy|semibold|demi|-medi|cmbx|\.b$|-b$", re.I)
ITALIC_FONT_RE = re.compile(r"italic|oblique|ital$|cmti|-it$", re.I)
MATH_FONT_RE = re.compile(
    r"^(cmmi|cmsy|cmex|cmbsy|cmmib|msam|msbm|eufm|eusm|euex|rsfs|stmary|wasy|lasy|txmi|txsy|"
    r"txex|pxmi|pxsy|ntxmi|ntxsy|newtxmath|zxmi|mtmi|mtsy|lmmath|latinmodernmath|cambriamath|"
    r"stixmath|xitsmath|symbol|esint|bbold|dsrom)", re.I)
MATH_ROMAN_RE = re.compile(r"^(cmr\d|cmbx\d)", re.I)


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------- geometry

def union(a, b):
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def union_all(rects):
    rects = list(rects)
    return (min(r[0] for r in rects), min(r[1] for r in rects),
            max(r[2] for r in rects), max(r[3] for r in rects))


def width(r):
    return r[2] - r[0]


def height(r):
    return r[3] - r[1]


def area(r):
    return max(0.0, width(r)) * max(0.0, height(r))


def x_overlap(a, b):
    return min(a[2], b[2]) - max(a[0], b[0])


def y_overlap(a, b):
    return min(a[3], b[3]) - max(a[1], b[1])


def intersect(a, b):
    r = (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))
    return r if r[0] < r[2] and r[1] < r[3] else None


def inside_frac(a, b):
    """Share of a's area that lies inside b."""
    i = intersect(a, b)
    return area(i) / area(a) if i and area(a) > 0 else 0.0


def expand(r, dx, dy=None):
    dy = dx if dy is None else dy
    return (r[0] - dx, r[1] - dy, r[2] + dx, r[3] + dy)


def near(a, b, tol):
    return a[0] - tol <= b[2] and b[0] - tol <= a[2] and a[1] - tol <= b[3] and b[1] - tol <= a[3]


def center_in(a, b):
    cx, cy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
    return b[0] <= cx <= b[2] and b[1] <= cy <= b[3]


def rounded(r):
    return [round(v, 2) for v in r]


# ---------------------------------------------------------------------------- text model

class Word:
    __slots__ = ("text", "bbox", "size", "sizes", "bold", "italic", "math", "letters_math", "baseline", "nchars")

    def __init__(self, chars, fonts):
        # chars: (c, bbox, baseline, size, font, flags)
        self.text = "".join(c[0] for c in chars)
        boxes = [c[1] for c in chars if c[1][2] > c[1][0] and c[1][3] > c[1][1]]
        self.bbox = union_all(boxes or [c[1] for c in chars])
        self.sizes = Counter(round(c[3], 1) for c in chars)
        self.size = max(self.sizes, key=lambda s: (self.sizes[s], s))
        n = len(chars)
        self.nchars = n
        self.bold = sum(is_bold(c[4], c[5]) for c in chars) / n
        self.italic = sum(is_italic(c[4], c[5]) for c in chars) / n
        self.math = sum(fonts.is_math(c[4]) for c in chars) / n
        letters = [c for c in chars if c[0].isalpha()]
        self.letters_math = sum(fonts.is_math(c[4]) for c in letters) / len(letters) if letters else 0.0
        main = [c[2] for c in chars if abs(c[3] - self.size) < 0.6] or [c[2] for c in chars]
        self.baseline = median(main)


def text_size(sizes):
    """Font size of a line: the largest size carrying at least 30% of the characters, so that
    sub/superscript-heavy math ("W ∈ R^{d_model×d_k}") does not make a line look small."""
    total = sum(sizes.values())
    common = [s for s, n in sizes.items() if n >= 0.3 * total]
    return max(common) if common else max(sizes, key=lambda s: (sizes[s], s))


class Row:
    """Words on one visual line (one baseline, no wide gaps)."""

    def __init__(self, words, horizontal=True, cls="F"):
        self.horizontal = horizontal
        self.words = sorted(words, key=lambda w: (w.bbox[0], w.bbox[1])) if horizontal else list(words)
        self.cls = cls
        self.bbox = union_all(w.bbox for w in self.words)
        n = sum(w.nchars for w in self.words)
        self.nchars = n
        self.bold = sum(w.bold * w.nchars for w in self.words) / n
        self.italic = sum(w.italic * w.nchars for w in self.words) / n
        self.math = sum(w.math * w.nchars for w in self.words) / n
        self.sizes = Counter()
        for w in self.words:
            self.sizes.update(w.sizes)
        self.size = text_size(self.sizes)
        main = [w for w in self.words if abs(w.size - self.size) < 0.6] or self.words
        self.baseline = median(w.baseline for w in main)
        # the line band of the row's main type; tall glyphs (√, Σ) and scripts stick out of it
        self.core = (median(w.bbox[1] for w in main), median(w.bbox[3] for w in main))
        self.task = None          # the task heading this row starts (exercise sheets, see mark_task_heads)

    @property
    def text(self):
        return " ".join(w.text for w in self.words)


class Block:
    def __init__(self, page, rows, type="paragraph"):
        self.page = page
        self.rows = list(rows)
        self.type = type
        self.cls = self.rows[0].cls
        self.caption = None      # ("figure" | "table", number) for caption blocks
        self.region = None       # Region for figure_text / table_text blocks
        self.barrier = False     # body text that a figure or table cannot extend across
        self.strong = False      # stricter barrier, used between table rules
        self.heading = False     # looks like a heading (set with the barriers)
        self.toc_level = None
        self.id = None
        self.section = None
        self.sentences = []
        self.text = ""

    @property
    def bbox(self):
        return union_all(r.bbox for r in self.rows)

    @property
    def raw_text(self):
        return " ".join(r.text for r in self.rows)

    def _weighted(self, attr):
        n = sum(r.nchars for r in self.rows)
        return sum(getattr(r, attr) * r.nchars for r in self.rows) / n

    @property
    def size(self):
        sizes = Counter()
        for r in self.rows:
            sizes.update(r.sizes)
        return text_size(sizes)

    @property
    def bold(self):
        return self._weighted("bold")

    @property
    def italic(self):
        return self._weighted("italic")

    @property
    def math(self):
        return self._weighted("math")

    @property
    def horizontal(self):
        return all(r.horizontal for r in self.rows)


class Region:
    """A figure or table body, anchored on its caption."""

    def __init__(self, kind, number, caption, bbox, parts):
        self.kind = kind
        self.number = number
        self.caption = caption
        self.bbox = bbox
        self.parts = parts        # [(rect, is_graphic)], used to find panels
        self.blocks = []          # figure_text / table_text blocks inside the body
        self.panels = []          # [(bbox, label or None)]
        self.cls = "F"


class Page:
    def __init__(self, pdf_page):
        self.pdf = pdf_page
        self.n = pdf_page.number + 1
        self.width = pdf_page.rect.width
        self.height = pdf_page.rect.height
        self.rows = []
        self.blocks = []
        self.regions = []
        self.images, self.shapes, self.hrules, self.vrules = [], [], [], []
        self.marks = []           # shapes that are plotted curves or lines (see _is_mark)
        self.gutter = None
        self.cols = {}
        self.ordered = []         # blocks in reading order (after ordering)
        self.sentences = []


class Fonts:
    """Document-wide font facts: body size and which fonts carry math."""

    def __init__(self, char_fonts, char_sizes):
        self.body_font = char_fonts.most_common(1)[0][0] if char_fonts else ""
        self.body_size = char_sizes.most_common(1)[0][0] if char_sizes else 10.0
        # cmr/cmbx is math roman unless the body itself is set in Computer Modern.
        self.cm_body = bool(MATH_ROMAN_RE.match(self.body_font))
        self._cache = {}

    def is_math(self, font):
        if font not in self._cache:
            self._cache[font] = bool(MATH_FONT_RE.match(font) or "math" in font.lower()
                                     or (not self.cm_body and MATH_ROMAN_RE.match(font)))
        return self._cache[font]


def is_bold(font, flags):
    return bool(flags & 16) or bool(BOLD_FONT_RE.search(font))


def is_italic(font, flags):
    return bool(flags & 2) or bool(ITALIC_FONT_RE.search(font))


# ---------------------------------------------------------------------------- extraction

def read_lines(pdf_page):
    """MuPDF text lines as (horizontal, chars); a char is (c, bbox, baseline, size, font, flags)."""
    raw = pdf_page.get_text("rawdict", flags=TEXT_FLAGS)
    lines = []
    for blk in raw["blocks"]:
        if blk.get("type", 0) != 0:
            continue
        for ln in blk["lines"]:
            dx, dy = ln["dir"]
            horizontal = abs(dy) < 0.02 and dx > 0
            chars = []
            for sp in ln["spans"]:
                font = sp["font"].split("+")[-1]
                for ch in sp["chars"]:
                    chars.append((ch["c"], tuple(ch["bbox"]), ch["origin"][1], sp["size"], font, sp["flags"]))
            if any(not c[0].isspace() for c in chars):
                lines.append((horizontal, chars))
    return lines


def make_words(chars, horizontal, fonts):
    words, cur = [], []

    def flush():
        if cur:
            words.append(Word(cur, fonts))
            cur.clear()

    spaced = False
    for i, ch in enumerate(chars):
        c, bbox, _, size, _, _ = ch
        if c.isspace():
            spaced = True
            continue
        if cur and horizontal:
            last = cur[-1]
            gap = bbox[0] - last[1][2]
            ellipsis = c == "." and i + 1 < len(chars) and chars[i + 1][0] == "."
            if c in ".,;:!?)]" and not ellipsis and gap < 0.35 * size:
                pass             # "V ." after italic math: MuPDF adds a space, the text has none
            elif spaced or gap > 0.3 * max(size, last[3]):
                flush()          # a space, or a visible gap without a space character
            elif c.isalpha() and all(x[3] <= 0.8 * size for x in cur):
                flush()          # footnote mark glued to the text: "4To" -> "4", "To"
        elif spaced:
            flush()
        spaced = False
        cur.append(ch)
    flush()
    return words


def line_segments(horizontal, words):
    """Split a MuPDF line at very wide gaps (table cells, side-by-side labels). MuPDF already
    starts a new line at most such gaps; justified text can stretch spaces past 1.5em."""
    if not horizontal:
        return [Row(words, horizontal=False)]
    segs, cur = [], [words[0]]
    for w in words[1:]:
        if w.bbox[0] - cur[-1].bbox[2] > 2.5 * max(w.size, cur[-1].size):
            segs.append(Row(cur))
            cur = []
        cur.append(w)
    segs.append(Row(cur))
    return segs


def detect_gutter(segs, page_w, body):
    """x of the column gutter on a two-column page, or None for a single column."""
    cand = [s.bbox for s in segs if s.horizontal and width(s.bbox) >= 0.18 * page_w and s.size >= 0.8 * body]
    n = len(cand)
    if n < 10:
        return None
    best_cross, best = None, []
    for g in range(int(page_w * 0.3), int(page_w * 0.7) + 1):
        cross = sum(1 for b in cand if b[0] < g - 1 and b[2] > g + 1)
        left = sum(1 for b in cand if b[2] <= g + 1)
        right = n - cross - left
        if left < 0.2 * n or right < 0.2 * n:
            continue
        if best_cross is None or cross < best_cross:
            best_cross, best = cross, [g]
        elif cross == best_cross:
            best.append(g)
    if best_cross is None or best_cross > 0.2 * n:
        return None
    # middle of the longest run of equally good positions
    runs, run = [], [best[0]]
    for g in best[1:]:
        if g == run[-1] + 1:
            run.append(g)
        else:
            runs.append(run)
            run = [g]
    runs.append(run)
    run = max(runs, key=len)
    return (run[0] + run[-1]) / 2


def gutter_fits(segs, page_w, body, g):
    """Does the gutter g of the document's other pages fit this page? detect_gutter needs text on
    both sides, so it misses a page whose one column is mostly a figure, a table or empty."""
    cand = [s.bbox for s in segs if s.horizontal and width(s.bbox) >= 0.18 * page_w and s.size >= 0.8 * body]
    if len(cand) < 10 or not page_w * 0.3 <= g <= page_w * 0.7:
        return False
    cross = sum(1 for b in cand if b[0] < g - 1 and b[2] > g + 1)
    return cross <= 0.1 * len(cand)


def row_class(bbox, gutter):
    if gutter is None:
        return "F"
    if bbox[2] <= gutter + 2:
        return "L"
    if bbox[0] >= gutter - 2:
        return "R"
    return "F"


def col_width(page, cls):
    x0, x1 = page.cols[cls]
    return x1 - x0


def column_bounds(rows, gutter, page_w, body):
    """Left/right text edges per column class, from the most common row starts and ends."""
    def edges(rs, default):
        rs = [r for r in rs if r.horizontal and r.size >= 0.8 * body and width(r.bbox) > 40]
        if not rs:
            return default
        x0 = Counter(round(r.bbox[0]) for r in rs).most_common(1)[0][0]
        x1 = Counter(round(r.bbox[2]) for r in rs).most_common(1)[0][0]
        return (min(x0, min(r.bbox[0] for r in rs) + 40), max(x1, x0 + 40))

    if gutter is None:
        f = edges(rows, (0.12 * page_w, 0.88 * page_w))
        return {"F": f, "L": f, "R": f}
    left = edges([r for r in rows if r.cls == "L"], (0.08 * page_w, gutter))
    right = edges([r for r in rows if r.cls == "R"], (gutter, 0.92 * page_w))
    return {"L": left, "R": right, "F": (left[0], right[1])}


def merge_rows(segs):
    """Join segments that share a baseline (inline math, sub/superscripts, number + heading)."""
    rows = []
    for s in sorted(segs, key=lambda s: (s.baseline, s.bbox[0])):
        if not s.horizontal:
            rows.append(s)
            continue
        target = None
        for i in range(len(rows) - 1, -1, -1):
            r = rows[i]
            sz = max(r.size, s.size)
            if r.baseline < s.baseline - 2 * sz:
                break
            if not r.horizontal or r.cls != s.cls:
                continue
            same = abs(r.baseline - s.baseline) <= 0.45 * sz
            if not same and s.size <= 0.8 * r.size:
                same = s.bbox[1] >= r.bbox[1] - 2 and s.bbox[3] <= r.bbox[3] + 2
            if not same and r.size <= 0.8 * s.size:
                same = r.bbox[1] >= s.bbox[1] - 2 and r.bbox[3] <= s.bbox[3] + 2
            # 1.35em: stretched justified spaces (~1.3em) join, side-by-side author columns
            # (~1.45em apart) do not; a section number sits 1em before its title
            if same and max(s.bbox[0] - r.bbox[2], r.bbox[0] - s.bbox[2]) <= 1.35 * sz:
                target = i
                break
        if target is None:
            rows.append(s)
        else:
            rows[target] = Row(rows[target].words + s.words, cls=s.cls)
    return sorted(rows, key=lambda r: (r.baseline, r.bbox[0]))


# ---------------------------------------------------------------------------- blocks

def starts_with_mark(row, body):
    w = row.words[0]
    return (row.size <= 0.95 * body and len(row.words) > 1 and w.size <= 0.8 * row.size
            and bool(FOOTNOTE_MARK_RE.match(w.text)))


def starts_new_block(row, body):
    t = row.text
    return bool(CAPTION_RE.match(t)) or row.words[0].text in BULLETS or starts_with_mark(row, body)


def is_display_math(row, page, body):
    if row.math < 0.45:
        return False
    left = page.cols[row.cls][0]
    return row.bbox[0] - left >= 1.5 * row.size


def all_bold(row):
    """Every full-size word is bold (marks and scripts aside): a heading line, not a run-in head."""
    return all(w.bold >= 0.9 for w in row.words if w.size >= 0.8 * row.size)


def ends_sentence(row):
    return bool(re.search(r"[.!?:][\"”’')\]]*$", row.text))


def bare_caption_label(row):
    """A table caption line holding only its label ("TABLE IV"): IEEE sets the caption text below it."""
    m = CAPTION_RE.match(row.text)
    return bool(m) and m.group(1).lower().startswith("tab") and not row.text[m.end():].strip()


def is_subsection_line(row):
    """An IEEE subsection heading: "A. Overview" in italics on a line of its own."""
    t = row.text
    return row.italic >= 0.8 and len(row.words) <= 8 and bool(SUBSECTION_RE.match(t)) and not t.endswith(".")


def can_join(block, prev, row, page, stats):
    if not prev.horizontal:
        return False
    if row.cls != prev.cls:
        # the short last line of a full-width caption or paragraph fits inside one column
        bb = block.bbox
        aligned = (abs(row.bbox[0] - bb[0]) <= 2
                   or abs((row.bbox[0] + row.bbox[2]) - (bb[0] + bb[2])) <= 6)
        if not (prev.cls == "F" and aligned):
            return False
    size = max(row.size, prev.size)
    d = row.baseline - prev.baseline
    body = stats.fonts.body_size
    both_math = is_display_math(prev, page, body) and is_display_math(row, page, body)
    if d <= 0.3 * size or d > size * (stats.leading + (1.0 if both_math else 0.3)):
        return False
    if len(block.rows) == 1 and bare_caption_label(prev) and not starts_new_block(row, body):
        return x_overlap(row.bbox, prev.bbox) > 0    # its text, in small capitals of mixed size
    if size / min(row.size, prev.size) > 1.15:
        return False
    bb = block.bbox
    ov = x_overlap(row.bbox, bb)
    if ov <= 0 or ov < 0.25 * min(width(row.bbox), width(bb)):
        return False
    if starts_new_block(row, body):
        return False
    front = page.n == 1 and row.bbox[1] < stats.front_y
    if not front and all_bold(prev) != all_bold(row):
        return False         # a bold heading line followed by text (or the other way round)
    if is_subsection_line(prev) != is_subsection_line(row):
        return False         # the same for an italic IEEE subsection heading
    if is_display_math(prev, page, body) != is_display_math(row, page, body):
        return False
    indent = row.bbox[0] - prev.bbox[0]
    if (0.8 * row.size < indent < 5 * row.size and ends_sentence(prev)
            and prev.words[0].text not in BULLETS and len(block.rows) > 1):
        return False         # indented first line of a new paragraph
    return True


def group_blocks(page, stats):
    blocks = []
    for row in page.rows:   # sorted by baseline
        if not row.horizontal:
            blocks.append(Block(page.n, [row]))
            continue
        best, best_ov = None, 0
        for b in blocks:
            prev = b.rows[-1]
            if can_join(b, prev, row, page, stats):
                ov = x_overlap(row.bbox, b.bbox)
                if ov > best_ov:
                    best, best_ov = b, ov
        if best is None:
            blocks.append(Block(page.n, [row]))
        else:
            best.rows.append(row)
    attach_equation_tags(blocks, page)
    return blocks


def attach_equation_tags(blocks, page):
    """A display equation's "(3)" sits far to the right of the formula: give it to the formula."""
    for tag in list(blocks):
        if len(tag.rows) != 1 or len(tag.rows[0].words) != 1 or not EQ_TAG_RE.match(tag.rows[0].text):
            continue
        tb = tag.bbox
        best = None
        for b in blocks:
            if b is tag or b.bbox[2] > tb[0] or y_overlap(b.bbox, tb) <= 0 or b.math < 0.4:
                continue
            if best is None or b.bbox[2] > best.bbox[2]:
                best = b
        if best is not None:
            best.rows.append(tag.rows[0])
            blocks.remove(tag)


# ---------------------------------------------------------------------------- graphics

def _is_white(color):
    if color is None:
        return True
    if len(color) == 4:                    # CMYK
        return max(color) <= 0.04
    return min(color) >= 0.96


def _opacity(v):
    return 1.0 if v is None else v


def _is_mark(drawing):
    """A plotted curve or line: Bezier pieces or diagonal segments, which table rules, frames
    and cell fills never have."""
    for item in drawing.get("items", ()):
        if item[0] == "c":
            return True
        if item[0] == "l" and abs(item[1].x - item[2].x) > 0.5 and abs(item[1].y - item[2].y) > 0.5:
            return True
    return False


def read_graphics(page):
    """Visible images and vector paths, honouring clip paths; thin paths become rules."""
    W, H = page.width, page.height
    page_rect = (0.0, 0.0, W, H)
    for info in page.pdf.get_image_info():
        r = intersect(tuple(info["bbox"]), page_rect)
        if r and area(r) > 16 and area(r) < 0.7 * W * H:
            page.images.append(r)
    stack = []   # (level, clip rect or None when fully clipped, group opacity)
    for e in page.pdf.get_drawings(extended=True):
        lv = e.get("level", 0)
        while stack and stack[-1][0] >= lv:
            stack.pop()
        clip, alpha = (stack[-1][1], stack[-1][2]) if stack else (page_rect, 1.0)
        kind = e["type"]
        if kind == "clip":
            sc = e.get("scissor")
            stack.append((lv, intersect(clip, tuple(sc)) if clip and sc else clip, alpha))
            continue
        if kind == "group":
            stack.append((lv, clip, alpha * _opacity(e.get("opacity"))))
            continue
        if clip is None or alpha <= 0.05:
            continue
        fill_ok = ("f" in kind and not _is_white(e.get("fill"))
                   and alpha * _opacity(e.get("fill_opacity")) > 0.05)
        stroke_ok = ("s" in kind and not _is_white(e.get("color"))
                     and alpha * _opacity(e.get("stroke_opacity")) > 0.05)
        if not (fill_ok or stroke_ok):
            continue
        r = tuple(e["rect"])
        if stroke_ok:
            r = expand(r, max(e.get("width") or 0, 0.5) / 2)
        r = intersect(r, clip)
        if r is None or area(r) > 0.6 * W * H:
            continue
        w, h = width(r), height(r)
        if h <= 2.5 and w >= 15:
            page.hrules.append(r)
        elif w <= 2.5 and h >= 8:
            page.vrules.append(r)
        else:
            page.shapes.append(r)
            if _is_mark(e):
                page.marks.append(r)


def drop_text_decorations(page):
    """Fraction bars, overlines and underlines live inside text rows; they are not graphics."""
    rows = [r.bbox for r in page.rows if r.horizontal]

    def in_text(rule):
        return any(center_in(rule, expand(rb, 0, 1)) and width(rule) < width(rb) + 4 for rb in rows)

    page.hrules = [r for r in page.hrules if not in_text(r)]


def cluster_rects(rects, tol):
    """Greedy proximity clustering; returns [(bbox, members)] in a deterministic order."""
    clusters = []
    for r in sorted(rects, key=lambda r: (r[1], r[0], r[2], r[3])):
        hits = [c for c in clusters if near(c[0], r, tol)]
        if not hits:
            clusters.append([r, [r]])
            continue
        keep = hits[0]
        keep[0] = union(keep[0], r)
        keep[1].append(r)
        for c in hits[1:]:
            keep[0] = union(keep[0], c[0])
            keep[1].extend(c[1])
            clusters.remove(c)
    merged = True
    while merged:                        # bboxes grew: merge clusters that now touch
        merged = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                if near(clusters[i][0], clusters[j][0], tol):
                    clusters[i][0] = union(clusters[i][0], clusters[j][0])
                    clusters[i][1].extend(clusters[j][1])
                    del clusters[j]
                    merged = True
                    break
            if merged:
                break
    return [(tuple(c[0]), c[1]) for c in clusters]


_INK = bytes(1 if v < 245 else 0 for v in range(256))


def ink_bbox(page, rect, dpi=144):
    """Shrink rect to the pixels that are actually drawn (drops white margins of images)."""
    clip = pymupdf.Rect(rect) & page.pdf.rect
    if clip.is_empty or clip.width < 1 or clip.height < 1:
        return rect
    pix = page.pdf.get_pixmap(dpi=dpi, clip=clip, colorspace=pymupdf.csGRAY, alpha=False)
    w, stride, data = pix.width, pix.stride, pix.samples
    x0 = y0 = x1 = y1 = None
    for y in range(pix.height):
        line = data[y * stride: y * stride + w].translate(_INK)
        i = line.find(1)
        if i < 0:
            continue
        j = line.rfind(1)
        x0 = i if x0 is None else min(x0, i)
        x1 = j if x1 is None else max(x1, j)
        y0 = y if y0 is None else y0
        y1 = y
    if x0 is None:
        return rect
    z = dpi / 72.0
    ink = ((pix.x + x0) / z, (pix.y + y0) / z, (pix.x + x1 + 1) / z, (pix.y + y1 + 1) / z)
    return intersect(expand(ink, 0.5), rect) or rect


# ---------------------------------------------------------------------------- regions

def is_heading_like(b, body):
    t = b.raw_text.strip()
    if len(b.rows) > 2 or len(t.split()) > 16:
        return False
    styled = b.bold >= 0.6 or b.size >= 1.1 * body
    roman = ROMAN_HEADING_RE.match(t)
    # IEEE main headings use body-size, regular-weight small capitals. The
    # numbered all-capital title is sufficient evidence even without bold type.
    if roman and (styled or roman.group(2).isupper()) and not t.endswith("."):
        return True
    if NUM_HEADING_RE.match(t) and styled and not t.endswith("."):
        return True
    # IEEE sets REFERENCES and its subsections at body size in regular weight: in capitals, and
    # "A. Overview" in italics on a line of its own
    one_row = len(b.rows) == 1
    if t.lower().rstrip(".:") in UNNUMBERED_HEADINGS and (styled or (one_row and t.isupper())):
        return True
    if (SUBSECTION_RE.match(t) and one_row and len(t.split()) <= 8 and not t.endswith(".")
            and (styled or b.italic >= 0.8)):
        return True
    return one_row and b.bold >= 0.9 and b.size >= 1.1 * body


def is_textlike(b, page, body, wide_frac=0.6):
    """Looks like running body text: rows of body-size type spanning most of the column."""
    rows = b.rows
    if not b.horizontal or b.size < 0.85 * body:
        return False
    colw = col_width(page, b.cls)
    wide = sum(1 for r in rows if width(r.bbox) >= wide_frac * colw)
    if len(rows) >= 2:
        return wide >= max(1, (len(rows) - 1) // 2)
    return wide == 1 and width(rows[0].bbox) >= max(0.7, wide_frac) * colw and len(rows[0].words) >= 8


def mark_barriers(page, stats):
    """Blocks a figure or table body must not extend across: captions and real body text.

    `strong` is the stricter version used inside tables, whose header rows can look like text."""
    body = stats.fonts.body_size
    graphics = page.images + page.shapes
    for b in page.blocks:
        t = b.raw_text
        m = CAPTION_RE.match(t) if b.horizontal else None
        if m:
            kind = "table" if m.group(1).lower().startswith("tab") else "figure"
            b.caption = (kind, m.group(2))
            b.barrier = b.strong = True
            continue
        bb = b.bbox
        covered = any(area(g) > 2 * area(bb) and inside_frac(bb, g) >= 0.9 for g in graphics)
        heading = b.heading = is_heading_like(b, body)
        b.barrier = not covered and (heading or is_textlike(b, page, body)
                                     or (b.horizontal and starts_with_mark(b.rows[0], body)))
        b.strong = b.barrier and (heading or is_textlike(b, page, body, wide_frac=0.85))


def barrier_between(page, top, bottom, xs, strong=False, cells_ok=False):
    """Is there a barrier block between y=top and y=bottom that overlaps the x-range xs?

    cells_ok: a text block that shares a line with another block inside xs is a table cell
    (a row label next to a long description), not body text."""
    for b in page.blocks:
        if not (b.strong if strong else b.barrier):
            continue
        bb = b.bbox
        cy = (bb[1] + bb[3]) / 2
        if top < cy < bottom and x_overlap(bb, (xs[0], 0, xs[1], 1)) > 0:
            if cells_ok and not b.caption and not b.heading and _is_cell(page, b, xs):
                continue
            return True
    return False


def _is_cell(page, block, xs):
    first = block.rows[0]
    for o in page.blocks:
        if o is block or not o.horizontal:
            continue
        for r in o.rows:
            if (abs(r.baseline - first.baseline) <= 0.5 * first.size and x_overlap(r.bbox, first.bbox) < 0
                    and r.bbox[0] >= xs[0] - 2 and r.bbox[2] <= xs[1] + 2):
                return True
    return False


def _similar(a, b):
    """Horizontal rules of comparable width that overlap: candidates for one table."""
    wa, wb = width(a), width(b)
    return x_overlap(a, b) >= 0.5 * min(wa, wb) and min(wa, wb) >= 0.6 * max(wa, wb)


def band_has_rows(page, top, bot, xs):
    """Some text row is centred between y=top and y=bot and overlaps xs."""
    return any(r.horizontal and top < (r.bbox[1] + r.bbox[3]) / 2 < bot and r.bbox[2] > xs[0] and r.bbox[0] < xs[1]
               for r in page.rows)


def band_has_plot(page, top, bot, xs):
    """Plotted curves cross a good part of the band between y=top and y=bot within xs."""
    parts = [p for p in (intersect(m, (xs[0], top, xs[1], bot)) for m in page.marks) if p and height(p) >= 1]
    return bool(parts) and width(union_all(parts)) >= 0.3 * (xs[1] - xs[0])


def rules_linked(page, a, b, body):
    """Two neighbouring horizontal rules of one table: similar width, overlapping, and only table
    rows between them.

    Rules of the same x-extent (booktabs \\toprule, \\midrule, \\bottomrule) link across any
    number of rows; other pairs only when they are close. Unless they form a double rule, the
    band between them must hold text and no plotted curves: the frame of a plot right under a
    table, or a plot's grid lines, are not table rules."""
    if not _similar(a, b):
        return False
    top, bot = sorted((a[1], b[1]))
    if any(top < c[1] < bot and _similar(c, a) and _similar(c, b) for c in page.hrules):
        return False                  # the rule between them links them
    xs = (max(a[0], b[0]), min(a[2], b[2]))
    if bot - top > 0.8 * body and (not band_has_rows(page, top, bot, xs) or band_has_plot(page, top, bot, xs)):
        return False
    if bot - top <= 90:
        return not barrier_between(page, top, bot, xs, True)
    same_extent = abs(a[0] - b[0]) <= 2 and abs(a[2] - b[2]) <= 2
    return same_extent and not barrier_between(page, top, bot, xs, True, cells_ok=True)


def trim_skeleton(page, rules, down):
    """Cut a table skeleton at the first band, going away from the caption, that holds plotted
    curves: the rules from there on, and rules touching the vertical rules there, frame a plot."""
    hs = sorted((r for r in rules if height(r) <= 2.5), key=lambda r: r[1], reverse=not down)
    keep = hs[:1]
    for prev, nxt in zip(hs, hs[1:]):
        top, bot = sorted((prev[1], nxt[1]))
        xs = (max(prev[0], nxt[0]), min(prev[2], nxt[2]))
        if xs[1] > xs[0] and band_has_plot(page, top, bot, xs):
            break
        keep.append(nxt)
    if len(keep) == len(hs):
        return rules
    y0, y1 = min(r[1] for r in keep), max(r[3] for r in keep)
    vs = [r for r in rules if height(r) > 2.5]
    cut = [v for v in vs if v[1] < y0 - 1.5 or v[3] > y1 + 1.5]
    keep = [h for h in keep if not any(near(h, v, 1.5) for v in cut)]
    if not keep:
        return rules
    return keep + [v for v in vs if v not in cut]


def find_tables(page, stats):
    caps = sorted((b for b in page.blocks if b.caption and b.caption[0] == "table"), key=lambda b: b.bbox[1])
    if not caps:
        return
    body = stats.fonts.body_size
    rules = [(r, "h") for r in page.hrules] + [(r, "v") for r in page.vrules]
    parent = list(range(len(rules)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(rules)):
        for j in range(i + 1, len(rules)):
            (a, ka), (b, kb) = rules[i], rules[j]
            linked = near(a, b, 1.5)
            if not linked and ka == kb == "h":
                linked = rules_linked(page, a, b, body)
            if linked:
                parent[find(i)] = find(j)
    groups = {}
    for i in range(len(rules)):
        groups.setdefault(find(i), []).append(rules[i])
    skeletons = []
    for members in groups.values():
        nh = sum(1 for _, k in members if k == "h")
        nv = len(members) - nh
        if nh >= 2 or (nh >= 1 and nv >= 2):
            skeletons.append([union_all(r for r, _ in members), [r for r, _ in members], False])
    skeletons.sort(key=lambda s: (s[0][1], s[0][0]))

    for cap in caps:
        cb = cap.bbox
        best, best_gap = None, None
        for sk in skeletons:
            sb = sk[0]
            if sk[2] or x_overlap(sb, cb) <= 0:
                continue
            if sb[1] >= cb[3] - 2:
                gap, top, bot = sb[1] - cb[3], cb[3], sb[1]
            elif sb[3] <= cb[1] + 2:
                gap, top, bot = cb[1] - sb[3], sb[3], cb[1]
            else:
                continue
            if gap > 3.5 * body or barrier_between(page, top, bot, (sb[0], sb[2]), True):
                continue
            if best_gap is None or gap < best_gap:
                best, best_gap = sk, gap
        if best is not None:
            best[2] = True
            members = trim_skeleton(page, best[1], best[0][1] >= cb[3] - 2)
            if members is not best[1]:
                best[0], best[1] = union_all(members), members
            box = best[0]
            # a table inside one column never takes text from the other column, nor from a
            # table beside it (on a page whose gutter was not detected)
            col = row_class(box, page.gutter)
            others = [sk[0] for sk in skeletons if sk is not best and y_overlap(sk[0], box) > 0]
            lo = max([(o[2] + box[0]) / 2 for o in others if o[2] <= box[0]], default=None)
            hi = min([(box[2] + o[0]) / 2 for o in others if o[0] >= box[2]], default=None)
            # table text, including row labels that stick out past the rules
            for b in page.blocks:
                if b.caption:
                    continue
                for r in b.rows:
                    inside = center_in(r.bbox, expand(best[0], 2))
                    beside = (not b.strong and best[0][1] <= (r.bbox[1] + r.bbox[3]) / 2 <= best[0][3]
                              and x_overlap(r.bbox, expand(best[0], 40, 0)) > 0
                              and (col == "F" or r.cls == col)
                              and (lo is None or r.bbox[0] >= lo) and (hi is None or r.bbox[2] <= hi)
                              and not any(center_in(r.bbox, expand(o, 2)) for o in others))
                    if inside or beside:
                        box = union(box, r.bbox)
            region = Region("table", cap.caption[1], cap, ink_bbox(page, expand(box, 1)), [])
            region.rules = best[1]
        else:
            region = text_only_table(page, cap, stats)
            if region is None:
                warn(f"page {page.n}: no body found for {cap.raw_text[:40]!r}")
                continue
        page.regions.append(region)
    # rules that belong to a table are not figure graphics
    used = [r for reg in page.regions if reg.kind == "table" for r in getattr(reg, "rules", [])]
    page.hrules = [r for r in page.hrules if r not in used]
    page.vrules = [r for r in page.vrules if r not in used]


def text_only_table(page, cap, stats):
    """Fallback for tables without rules: the run of non-body rows right below (or above) the caption."""
    body = stats.fonts.body_size
    step = 2.2 * stats.leading * body
    cb = cap.bbox
    span = page.cols[cap.cls]
    rows = [r for b in page.blocks if not b.barrier and not b.caption for r in b.rows
            if x_overlap(r.bbox, (span[0], 0, span[1], 1)) > 0]
    for direction in (1, -1):
        picked, edge = [], cb[3] if direction > 0 else cb[1]
        ordered = sorted(rows, key=lambda r: r.bbox[1] * direction)
        for r in ordered:
            dist = (r.bbox[1] - edge) if direction > 0 else (edge - r.bbox[3])
            if dist < -2:
                continue
            if dist > step:
                break
            picked.append(r)
            edge = max(edge, r.bbox[3]) if direction > 0 else min(edge, r.bbox[1])
        if len(picked) >= 2:
            box = union_all(r.bbox for r in picked)
            return Region("table", cap.caption[1], cap, ink_bbox(page, expand(box, 1)), [])
    return None


def find_figures(page, stats):
    caps = sorted((b for b in page.blocks if b.caption and b.caption[0] == "figure"), key=lambda b: b.bbox[1])
    if not caps:
        return
    body = stats.fonts.body_size
    taken = [reg.bbox for reg in page.regions]
    barrier_boxes = [b.bbox for b in page.blocks if b.barrier and not b.caption]
    elems = []
    for r in page.images + page.shapes + page.hrules + page.vrules:
        if any(inside_frac(r, t) > 0.5 for t in taken):
            continue
        if any(inside_frac(r, bb) > 0.9 for bb in barrier_boxes):
            continue         # boxes or highlights drawn inside body text
        elems.append(r)
    # running-head rules and logos in the page margins never belong to a figure. The type area
    # is a document-wide estimate that a short or float-heavy PDF gets wrong, so a figure can
    # sit outside it: only drop what stays small (under 2.5 lines) even when grouped.
    top, bottom = stats.text_area
    clusters = cluster_rects(elems, 3)
    outside = [bbox for bbox, _ in clusters if bbox[3] < top - 2 or bbox[1] > bottom + 2]
    clutter = set()
    for bbox, members in cluster_rects(outside, body):
        if height(bbox) <= 2.5 * body:
            clutter.update(members)
    clusters = [[bbox, False] for bbox, _ in clusters if bbox not in clutter]
    free_rows = [r for b in page.blocks if not b.barrier and not b.caption for r in b.rows]

    for cap in caps:
        cb = cap.bbox
        span = page.cols[cap.cls]
        # side-by-side figures: each caption only claims graphics above its own extent
        beside = [o.bbox for o in caps if o is not cap and y_overlap(o.bbox, cb) > 0]
        if beside:
            left = max([o[2] for o in beside if o[2] <= cb[0]] or [span[0]])
            right = min([o[0] for o in beside if o[0] >= cb[2]] or [span[1]])
            span = ((left + cb[0]) / 2 if left > span[0] else span[0],
                    (right + cb[2]) / 2 if right < span[1] else span[1])
        spanbox = (span[0], 0, span[1], 1)
        chosen = None
        for direction in ("above", "below"):
            lo, hi = figure_band(page, cap, spanbox, direction)
            cands = [c for c in clusters if not c[1] and c[0][1] >= lo - 2 and c[0][3] <= hi + 2
                     and x_overlap(c[0], spanbox) > 0]
            if not cands:
                continue
            if direction == "above":
                cands.sort(key=lambda c: cb[1] - c[0][3])
                first_gap = cb[1] - cands[0][0][3]
            else:
                cands.sort(key=lambda c: c[0][1] - cb[3])
                first_gap = cands[0][0][1] - cb[3]
            if first_gap <= 8 * body:
                chosen = (direction, lo, hi, cands)
                break
        if chosen is None:
            warn(f"page {page.n}: no graphics found for {cap.raw_text[:40]!r}")
            continue
        direction, lo, hi, cands = chosen
        # the band is bounded by body text, captions and other regions, so every graphic in
        # it belongs to this figure; then short label rows touching the body join it
        group, absorbed = cands, []
        box = union_all(c[0] for c in group)
        labels = [r for r in free_rows if r.bbox[1] >= lo - 2 and r.bbox[3] <= hi + 2]
        grown = True
        while grown:
            grown = False
            for r in labels:
                if r not in absorbed and near(r.bbox, box, 0.8 * body):
                    absorbed.append(r)
                    box = union(box, r.bbox)
                    grown = True
        parts = [(c[0], True) for c in group] + [(r.bbox, False) for r in absorbed]
        if direction == "above":
            box = (box[0], box[1], box[2], min(box[3], cb[1] - 0.5))
        else:
            box = (box[0], max(box[1], cb[3] + 0.5), box[2], box[3])
        for c in group:
            c[1] = True
        region = Region("figure", cap.caption[1], cap, ink_bbox(page, expand(box, 1)), parts)
        region.panels = find_panels(page, region)
        page.regions.append(region)
        taken.append(region.bbox)


def figure_band(page, cap, spanbox, direction):
    """Vertical range a figure body may occupy: up to the nearest barrier or region."""
    cb = cap.bbox
    others = [b.bbox for b in page.blocks if b.barrier and b is not cap] + [r.bbox for r in page.regions]
    if direction == "above":
        lo = 0.0
        for bb in others:
            if bb[3] <= cb[1] + 1 and x_overlap(bb, spanbox) > 0:
                lo = max(lo, bb[3])
        return lo, cb[1]
    hi = page.height
    for bb in others:
        if bb[1] >= cb[3] - 1 and x_overlap(bb, spanbox) > 0:
            hi = min(hi, bb[1])
    return cb[3], hi


def _split_axis(parts, axis, min_gap, span):
    """Split parts along an axis (0: into columns, 1: into rows) at bands at least min_gap long
    that are empty or crossed only by thin elements (under 10% of span, the other dimension)."""
    lo, hi = (0, 2) if axis == 0 else (1, 3)
    olo, ohi = (1, 3) if axis == 0 else (0, 2)
    start = min(p[0][lo] for p in parts)
    n = int(max(p[0][hi] for p in parts) - start) + 1
    cover = [0.0] * (n + 1)
    for r, _ in parts:
        for t in range(max(int(r[lo] - start), 0), min(int(r[hi] - start), n) + 1):
            cover[t] += r[ohi] - r[olo]
    cuts, t = [], 0
    while t <= n:
        if cover[t] > 0.1 * span:
            t += 1
            continue
        s = t
        while t <= n and cover[t] <= 0.1 * span:
            t += 1
        if t - s >= min_gap and s > 0 and t <= n:
            cuts.append(start + (s + t) / 2)
    groups = [[] for _ in range(len(cuts) + 1)]
    for p in parts:
        c = (p[0][lo] + p[0][hi]) / 2
        groups[sum(1 for x in cuts if c > x)].append(p)
    return [g for g in groups if g]


def find_panels(page, region):
    """Sub-figures: graphic clusters separated by whitespace bands, rows first, then columns."""
    parts = region.parts
    if len(parts) < 2:
        return []
    fb = region.bbox
    groups = []
    for row in _split_axis(parts, 1, max(10.0, 0.03 * height(fb)), width(fb)):
        groups.extend(_split_axis(row, 0, max(10.0, 0.04 * width(fb)), height(union_all(p[0] for p in row))))
    # a group without graphics (a stray label) joins the nearest group with graphics
    real = [g for g in groups if any(is_g for _, is_g in g)]
    for g in groups:
        if g in real or not real:
            continue
        gb = union_all(p[0] for p in g)
        target = min(real, key=lambda h: _rect_distance(gb, union_all(p[0] for p in h)))
        target.extend(g)
    if len(real) < 2:
        return []
    panels = []
    for g in real:
        gb = intersect(ink_bbox(page, expand(union_all(p[0] for p in g), 1)), fb)
        if gb is None or area(gb) < 0.05 * area(fb):
            return []
        panels.append((gb, panel_label(page, gb)))
    return panels


def _rect_distance(a, b):
    dx = max(b[0] - a[2], a[0] - b[2], 0.0)
    dy = max(b[1] - a[3], a[1] - b[3], 0.0)
    return (dx * dx + dy * dy) ** 0.5


def panel_label(page, bbox):
    """A printed sub-figure label such as "(a)" inside the panel."""
    for r in sorted(page.rows, key=lambda r: (r.bbox[1], r.bbox[0])):
        if not r.horizontal or not center_in(r.bbox, bbox):
            continue
        ws = [w.text for w in r.words]
        if re.fullmatch(r"\([a-z]\)", ws[0]):
            return ws[0]
        if re.fullmatch(r"[a-z]", ws[0]) and len(ws) > 1 and ws[1] in {"·", "|", "-", "–", ":"}:
            return ws[0]
    return None


def claim_region_text(page, region):
    """Move the rows inside a figure/table body out of body blocks into figure_text/table_text."""
    box = expand(region.bbox, 1)
    claimed = []
    for b in page.blocks:
        if b.caption:
            continue
        keep = []
        for r in b.rows:
            if center_in(r.bbox, box) and inside_frac(r.bbox, box) >= 0.5:
                claimed.append(r)
            else:
                keep.append(r)
        b.rows = keep
    page.blocks = [b for b in page.blocks if b.rows]
    if not claimed:
        return
    kind = "table_text" if region.kind == "table" else "figure_text"
    groups = _table_rows(claimed) if region.kind == "table" else _label_groups(claimed)
    for g in groups:
        blk = Block(page.n, g, kind)
        blk.region = region
        region.blocks.append(blk)


def _table_rows(rows):
    """One group per printed table row (cells and their super/subscripts share a baseline)."""
    groups = []
    for r in sorted(rows, key=lambda r: (r.baseline, r.bbox[0])):
        for g in groups:
            if not r.horizontal or not g[0].horizontal:
                continue
            ref = g[0]
            if (abs(ref.baseline - r.baseline) <= 0.5 * max(ref.size, r.size)
                    or (r.bbox[1] >= ref.bbox[1] - 1 and r.bbox[3] <= ref.bbox[3] + 1)):
                g.append(r)
                break
        else:
            groups.append([r])
    return [sorted(g, key=lambda r: r.bbox[0]) for g in groups]


def _label_groups(rows):
    """Figure labels that touch each other form one block (a word row, a multi-line label)."""
    groups = []
    for r in sorted(rows, key=lambda r: (r.bbox[1], r.bbox[0])):
        tol = 0.4 * r.size
        hits = [g for g in groups if g[0].horizontal == r.horizontal and any(near(x.bbox, r.bbox, tol) for x in g)]
        if not hits:
            groups.append([r])
            continue
        hits[0].append(r)
        for g in hits[1:]:
            hits[0].extend(g)
            groups.remove(g)
    for g in groups:
        g.sort(key=lambda r: (r.bbox[1], r.bbox[0]) if r.horizontal else (r.bbox[0], r.bbox[1]))
    return sorted(groups, key=lambda g: (union_all(r.bbox for r in g)[1], union_all(r.bbox for r in g)[0]))


# ---------------------------------------------------------------------------- classification

def find_title(page, body):
    best = None
    for b in page.blocks:
        if b.horizontal and b.bbox[3] < 0.5 * page.height and b.size >= 1.25 * body and b.rows[0].task is None:
            if best is None or b.size > best.size:
                best = b
    return best


def repeated_margin_texts(pages, least=3):
    """Normalized texts that recur in the top or bottom margin of `least` pages or more (running heads)."""
    seen = Counter()
    for page in pages:
        keys = set()
        for b in page.blocks:
            bb = b.bbox
            if len(b.rows) == 1 and b.rows[0].task is None and (bb[3] < 0.1 * page.height or bb[1] > 0.9 * page.height):
                keys.add(re.sub(r"\d+", "#", b.raw_text.lower()).strip())
        seen.update(keys)
    return {k for k, n in seen.items() if n >= least and len(pages) >= least}


def footnote_rule_y(page):
    """y of a short rule at the left edge of a column in the lower half: the footnote separator."""
    best = None
    for r in page.hrules:
        for cls in ("L", "R", "F"):
            x0, x1 = page.cols[cls]
            if (abs(r[0] - x0) < 6 and 0.12 * (x1 - x0) < width(r) < 0.55 * (x1 - x0)
                    and r[1] > 0.45 * page.height):
                best = r[1] if best is None else min(best, r[1])
    return best


def classify_block(b, page, stats, title, running):
    body = stats.fonts.body_size
    t = b.raw_text.strip()
    bb = b.bbox
    W, H = page.width, page.height
    if b.caption:
        return "caption"
    if not b.horizontal:
        return "header_footer" if bb[2] < 0.1 * W or bb[0] > 0.9 * W else "other"
    one_row = len(b.rows) == 1
    if one_row and PAGE_NUMBER_RE.match(t) and (bb[1] > 0.88 * H or bb[3] < 0.12 * H):
        return "header_footer"
    # a sheet's title often repeats its running head; only the copy in the margin is the running head
    if re.sub(r"\d+", "#", t.lower()) in running and (not stats.sheet or bb[3] < 0.1 * H or bb[1] > 0.9 * H):
        return "header_footer"
    if title is not None and page.n == 1 and bb[3] <= title.bbox[1]:
        return "header_footer"        # notices above the title
    if b is title:
        return "title"
    marked = starts_with_mark(b.rows[0], body)
    rule_y = footnote_rule_y(page)
    if marked and bb[1] > 0.4 * H:
        return "footnote"
    if len(b.rows) <= 2 and bb[1] > 0.9 * H and (b.size < 0.95 * body or VENUE_RE.search(t)):
        return "header_footer"        # venue / copyright line in the bottom margin
    if rule_y is not None and bb[1] >= rule_y and b.size <= 0.95 * body:
        return "footnote"
    if is_equation(b, page, body):
        return "equation"
    if is_heading_like(b, body):
        return "heading"
    if sum(ch.isalpha() for ch in t) < 2:
        return "other"
    return "paragraph"


def is_equation(b, page, body):
    rows = [r for r in b.rows if not (len(r.words) == 1 and EQ_TAG_RE.match(r.text))]
    if not rows:
        return False
    tagged = len(rows) < len(b.rows) or bool(equation_tags(b, page))
    n = sum(r.nchars for r in rows)
    math = sum(r.math * r.nchars for r in rows) / n
    left = page.cols[b.cls][0]
    display = min(r.bbox[0] for r in rows) - left >= 1.5 * body
    return (math >= 0.45 and display) or (tagged and math >= 0.3)


def equation_tags(b, page):
    """Equation numbers "(N)" at the right edge of a display: [(word, row)]."""
    right = page.cols[b.cls][1]
    colw = col_width(page, b.cls)
    tags = []
    for r in b.rows:
        w = r.words[-1]
        if not EQ_TAG_RE.match(w.text) or w.bbox[2] < right - 0.12 * colw:
            continue
        if len(r.words) > 1 and w.bbox[0] - r.words[-2].bbox[2] < 2 * r.size:
            continue
        tags.append((w, r))
    return tags


def classify(pages, stats):
    body = stats.fonts.body_size
    # an exercise sheet repeats its course line on both pages of a two-page sheet
    running = repeated_margin_texts(pages, 2 if stats.sheet else 3)
    title = find_title(pages[0], body) if pages else None
    stats.title = title
    for page in pages:
        for b in page.blocks:
            b.type = classify_block(b, page, stats, title, running)
    if title is not None:
        # authors: everything between the title and the first real heading (Abstract, 1 ...)
        page = pages[0]
        heads = [b.bbox[1] for b in page.blocks if b.type == "heading" and b.bbox[1] > title.bbox[3]
                 and (NUM_HEADING_RE.match(b.raw_text) or ROMAN_HEADING_RE.match(b.raw_text)
                      or b.raw_text.lower().strip(" .:") in UNNUMBERED_HEADINGS)]
        # IEEE runs the abstract in ("Abstract—We study ..."), with no heading of its own
        heads += [b.bbox[1] for b in page.blocks if b.type == "paragraph" and b.bbox[1] > title.bbox[3]
                  and ABSTRACT_RE.match(b.raw_text)]
        paras = [b.bbox[1] for b in page.blocks if b.type == "paragraph" and b.bbox[1] > title.bbox[3]
                 and is_textlike(b, page, body) and len(b.rows) >= 3]
        tasks = [r.bbox[1] for b in page.blocks for r in b.rows if r.task is not None and r.bbox[1] > title.bbox[3]]
        if tasks:     # an exercise sheet: the course and due-date lines end at the first task or paragraph
            paras = [b.bbox[1] for b in page.blocks if b.type == "paragraph" and b.bbox[1] > title.bbox[3]
                     and is_textlike(b, page, body)]
            limit = min(heads + tasks + paras)
        else:
            limit = min(heads) if heads else (min(paras) if paras else title.bbox[3])
        for b in page.blocks:
            if (b.type in ("paragraph", "other", "heading") and b.bbox[1] >= title.bbox[3] - 1
                    and b.bbox[3] <= limit + 1):
                b.type = "authors"
    for page in pages:
        split_run_in_headings(page)


def split_run_in_headings(page):
    """"Acknowledgements We are grateful ..." -> heading block + paragraph block."""
    for b in list(page.blocks):
        if b.type != "paragraph":
            continue
        first = b.rows[0]
        lead = []
        for w in first.words:
            if w.bold < 0.9:
                break
            lead.append(w)
        if not lead or len(lead) == len(first.words):
            continue
        name = " ".join(w.text for w in lead).lower().rstrip(".:")
        if name not in RUN_IN_HEADINGS:
            continue
        head = Block(page.n, [Row(lead, cls=first.cls)], "heading")
        b.rows[0] = Row(first.words[len(lead):], cls=first.cls)
        page.blocks.insert(page.blocks.index(b), head)


# ---------------------------------------------------------------------------- reading order

def _sort_rows(items):
    """Top to bottom; items that sit side by side (same line band) go left to right."""
    items = sorted(items, key=lambda it: (it[0][1], it[0][0]))
    out, i = [], 0
    while i < len(items):
        band = [items[i]]
        ref = items[i][0]
        j = i + 1
        while j < len(items) and y_overlap(items[j][0], ref) >= 0.5 * min(height(items[j][0]), height(ref)):
            band.append(items[j])
            j += 1
        out.extend(sorted(band, key=lambda it: it[0][0]))
        i = j
    return out


def order_page(page):
    items = [(b.bbox, [b], b.cls) for b in page.blocks]
    for reg in page.regions:
        reg.cls = row_class(reg.bbox, page.gutter)
        items.append((reg.bbox, reg.blocks, reg.cls))
    margin = [it for it in items if len(it[1]) == 1 and it[1][0].type == "header_footer"]
    body = [it for it in items if it not in margin]
    header = [it for it in margin if it[1][0].horizontal and (it[0][1] + it[0][3]) / 2 < page.height / 2]
    footer = [it for it in margin if it not in header]
    if page.gutter is None:
        ordered = _sort_rows(body)
    else:
        full = sorted((it for it in body if it[2] == "F"), key=lambda it: (it[0][1], it[0][0]))
        keyed = {}
        for it in body:
            band = sum(1 for f in full if f[0][1] < it[0][1] - 1)
            col = {"L": 0, "R": 1, "F": 2}[it[2]]
            keyed.setdefault((band, col), []).append(it)
        ordered = []
        for key in sorted(keyed):
            ordered.extend(_sort_rows(keyed[key]))
    page.ordered = [b for it in _sort_rows(header) + ordered + _sort_rows(footer) for b in it[1]]


# ---------------------------------------------------------------------------- sections

def _norm(text):
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def split_heading(text, allow_letter):
    m = NUM_HEADING_RE.match(text) or ROMAN_HEADING_RE.match(text)
    if m:
        return m.group(1), m.group(2).strip()
    if allow_letter:
        m = LETTER_HEADING_RE.match(text)
        if m:
            return m.group(1), m.group(2).strip()
    return None, text.strip()


def _slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"


def build_sections(pages, toc):
    """Headings in reading order; the PDF outline confirms titles and rescues missed headings."""
    by_page = {p.n: p for p in pages}
    for level, title, pno in toc:
        page = by_page.get(pno)
        if page is None:
            continue
        key = _norm(title)
        if not key:
            continue
        cands = [b for b in page.ordered if b.horizontal and b.region is None and b.type != "caption"
                 and len(b.rows) <= 2]

        def matches(b):
            text = b.raw_text.strip()
            return key in (_norm(text), _norm(split_heading(text, True)[1]))

        hit = next((b for b in cands if b.type == "heading" and matches(b)), None)
        if hit is None:
            hit = next((b for b in cands if b.type in ("paragraph", "other") and matches(b)), None)
            if hit is not None:
                hit.type = "heading"
        if hit is None:
            warn(f"outline entry {title!r} (page {pno}) has no matching heading")
            continue
        hit.toc_level = level

    sections, ids, after_refs, roman = [], set(), False, None
    toc_titles = {_norm(t) for _, t, _ in toc}
    for page in pages:
        for b in page.ordered:
            if b.type != "heading":
                continue
            text = " ".join(b.raw_text.split())
            main = ROMAN_HEADING_RE.match(text)
            sub = SUBSECTION_RE.match(text) if roman and not after_refs else None
            if sub and not (main and main.group(2).isupper()):
                # IEEE subsection "A. Overview" (or "C. Training") under "II. RELATED WORK"
                number, title = sub.group(1), sub.group(2).strip()
                level, sid = 2, f"sec-{roman.lower()}.{number.lower()}"
            else:
                letter_ok = after_refs or _norm(split_heading(text, True)[1]) in toc_titles
                number, title = split_heading(text, letter_ok)
                if number:
                    level = number.count(".") + 1
                    sid = "sec-" + number.lower()
                else:
                    level = b.toc_level or 1
                    sid = "sec-" + _slug(title)
                if main and number == main.group(1):
                    roman = number          # lettered headings below it are its subsections
                elif not number:
                    roman = None            # an unnumbered heading (ACKNOWLEDGMENT) ends that run
            base, k = sid, 2
            while sid in ids:
                sid = f"{base}-{k}"
                k += 1
            ids.add(sid)
            b.section = sid
            sections.append({"id": sid, "number": number, "title": title, "level": level, "block": b})
            if title.lower() in REFERENCE_HEADINGS:
                after_refs = True
    # every block belongs to the latest heading before it in reading order
    current = None
    for page in pages:
        for b in page.ordered:
            if b.type == "heading" and b.section:
                current = b.section
            b.section = current
    return sections


def split_references(pages, sections):
    """Body text under References becomes one reference block per entry."""
    ref_ids = {s["id"] for s in sections if s["title"].lower() in REFERENCE_HEADINGS}
    if not ref_ids:
        return
    for page in pages:
        out, run = [], []

        def flush():
            if run:
                out.extend(_split_entries(page, run))
                run.clear()

        for b in page.ordered:
            if b.section in ref_ids and b.type in ("paragraph", "other") and b.horizontal:
                if run and run[-1].cls != b.cls:
                    flush()
                run.append(b)
            else:
                flush()
                out.append(b)
        flush()
        page.ordered = out


def _split_entries(page, blocks):
    rows = [r for b in blocks for r in b.rows]
    section, cls = blocks[0].section, blocks[0].cls
    bracket = any(re.match(r"^\[\d+\]", r.text) for r in rows)
    x_min = min(r.bbox[0] for r in rows)
    hanging = any(r.bbox[0] > x_min + 5 for r in rows)
    if bracket:
        starts = [bool(re.match(r"^\[\d+\]", r.text)) for r in rows]
    elif hanging:
        starts = [r.bbox[0] <= x_min + 2 for r in rows]
    else:
        for b in blocks:
            b.type = "reference"
        return blocks
    entries, cur = [], []
    for r, s in zip(rows, starts):
        if s and cur:
            entries.append(cur)
            cur = []
        cur.append(r)
    if cur:
        entries.append(cur)
    out = []
    for e in entries:
        nb = Block(page.n, e, "reference")
        nb.section, nb.cls = section, cls
        out.append(nb)
    return out


# ---------------------------------------------------------------------------- text and sentences

class Token:
    __slots__ = ("text", "frags", "math")

    def __init__(self, text, row_index, bbox, math):
        self.text = text
        self.frags = [(row_index, bbox)]
        self.math = math


def build_vocab(pages):
    """Word counts of the document, leaving out both halves of line-end hyphenations."""
    vocab = Counter()
    for page in pages:
        for b in page.ordered:
            split = False
            for r in b.rows:
                words = r.words[1:] if split else r.words
                split = r.words[-1].text.endswith("-")
                for w in words[:-1] if split else words:
                    vocab[w.text.strip(".,;:!?()[]{}\"'“”‘’").lower()] += 1
    return vocab


def join_hyphenated(left, right, vocab):
    """left ends with a hyphen at a line end, right starts the next line."""
    stem = left[:-1]
    if left.endswith("­"):
        return stem + right
    tail = re.search(r"[A-Za-z]+$", stem)
    head = re.match(r"[A-Za-z]+", right)
    if not tail or not head or not right[0].islower():
        return left + right                     # "Multi-" "Head", "GPT-" "3"
    if "-" in stem or right[head.end():].startswith("-"):
        return left + right                     # "state-of-the-" "art", "English-" "to-German"
    tail, head = tail.group(0).lower(), head.group(0).lower()
    joined, hyphened = vocab.get(tail + head, 0), vocab.get(tail + "-" + head, 0)
    if hyphened > joined:
        return left + right
    if joined > 0 or SUFFIX_RE.fullmatch(head):
        return stem + right                     # "train-" "ing", "parallel-" "ization"
    if tail in COMPOUND_PREFIXES and vocab.get(head, 0) > 0:
        return left + right                     # "self-" "attention"
    if len(tail) >= 4 and len(head) >= 4 and vocab.get(tail, 0) >= 3:
        return left + right                     # two real words: "sequence-" "aligned"
    return stem + right


def block_tokens(block, vocab):
    tokens = []
    for ri, row in enumerate(block.rows):
        for wi, w in enumerate(row.words):
            if (wi == 0 and ri > 0 and tokens and len(tokens[-1].text) > 1
                    and tokens[-1].text[-1] in "-‐­" and tokens[-1].text[-2].isalpha()
                    and tokens[-1].frags[-1][0] == ri - 1):
                t = tokens[-1]
                t.text = join_hyphenated(t.text, w.text, vocab)
                t.frags.append((ri, w.bbox))
                continue
            tokens.append(Token(w.text, ri, w.bbox, w.letters_math))
    return tokens


def is_boundary(tok, nxt):
    core = tok.text.rstrip("\"'”’)]}»")
    if not core or core[-1] not in ".!?":
        return False
    if core[-1] == ".":
        word = core.lstrip("(\"[{“‘").lower()
        if word in ABBREVIATIONS or word.endswith("et al."):
            return False
        if re.fullmatch(r"[a-z]\.", word) and tok.math < 0.5:
            return False                      # initial: "Aidan N. Gomez" (but "matrix Q." ends)
        if re.fullmatch(r"(?:[a-z]\.){2,}", word):
            return False                      # "U.S.", "e.g."
    start = nxt.text.lstrip("\"'([{“‘")
    if not start:
        return False
    # lowercase continues the sentence, except a math variable ("... layer types. n is the")
    return not start[0].islower() or nxt.math >= 0.99


def split_sentences(tokens, kind):
    if kind in ("title", "authors", "heading", "reference"):
        return [tokens]
    sents, cur = [], []
    for i, t in enumerate(tokens):
        cur.append(t)
        if i + 1 < len(tokens) and is_boundary(t, tokens[i + 1]):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    # "Fig. 3." alone is not a sentence: keep it with what follows
    if kind == "caption" and len(sents) > 1 and CAPTION_RE.fullmatch(" ".join(t.text for t in sents[0])):
        sents[0:2] = [sents[0] + sents[1]]
    return sents


def sentence_rects(tokens, rows):
    """One rect per line: the words' horizontal extent, the line's core band vertically."""
    by_row = {}
    for t in tokens:
        for ri, bbox in t.frags:
            by_row[ri] = union(by_row[ri], bbox) if ri in by_row else bbox
    rects = []
    for ri in sorted(by_row):
        x0, y0, x1, y1 = by_row[ri]
        c0, c1 = rows[ri].core
        rects.append(rounded((x0, c0, x1, c1) if c0 < c1 else (x0, y0, x1, y1)))
    return rects


SENTENCE_TYPES = {"title", "authors", "heading", "paragraph", "caption", "footnote", "reference"}


def assign_ids_and_sentences(pages, vocab):
    for page in pages:
        k_block, k_sent = 0, 0
        for b in page.ordered:
            k_block += 1
            b.id = f"p{page.n}.b{k_block}"
            tokens = block_tokens(b, vocab)
            b.text = " ".join(t.text for t in tokens)
            b.sentences = []
            if b.type not in SENTENCE_TYPES or not b.horizontal or not tokens:
                continue
            for sent in split_sentences(tokens, b.type):
                k_sent += 1
                sid = f"p{page.n}.s{k_sent}"
                b.sentences.append(sid)
                page.sentences.append({"id": sid, "page": page.n, "block": b.id,
                                       "text": " ".join(t.text for t in sent),
                                       "rects": sentence_rects(sent, b.rows)})


# ---------------------------------------------------------------------------- figures, equations

def figure_records(pages):
    records, seen = [], set()
    for page in pages:
        regions = sorted(page.regions, key=lambda r: page.ordered.index(r.caption) if r.caption in page.ordered else 0)
        for reg in regions:
            prefix = "tab" if reg.kind == "table" else "fig"
            fid = prefix + re.sub(r"[^0-9A-Za-z]", "", reg.number)
            if fid in seen:
                warn(f"page {page.n}: duplicate {fid} ignored")
                continue
            seen.add(fid)
            letters = "abcdefghijklmnopqrstuvwxyz"
            panels = []
            for i, (pb, label) in enumerate(reg.panels[:26]):
                p = {"id": f"{fid}.{letters[i]}", "bbox": rounded(pb)}
                if label:
                    p["label"] = label
                panels.append(p)
            records.append({
                "id": fid, "kind": reg.kind, "number": reg.number, "page": page.n,
                "bbox": rounded(reg.bbox), "caption": reg.caption.text, "caption_block": reg.caption.id,
                "image": f"figures/{fid}.png", "panels": panels, "referenced_by": [],
                "_page": page, "_caption": reg.caption, "_rules": table_rules(page, reg),
            })
    return records


def table_rules(page, reg):
    """The rules of a table: its skeleton, and the short rules beside it that the skeleton did not take (a rule
    under a header cell that spans several columns)."""
    if reg.kind != "table":
        return []
    box = expand(reg.bbox, 2)
    return list(getattr(reg, "rules", [])) + [r for r in page.hrules if center_in(r, box) and width(r) < 0.6 * width(box)]


def compose_in(value, order):
    """Every string inside value (a grid's dicts and lists) with its split accents joined."""
    if isinstance(value, str):
        return accents.compose_text(value, order)
    if isinstance(value, list):
        return [compose_in(v, order) for v in value]
    if isinstance(value, dict):
        return {k: compose_in(v, order) for k, v in value.items()}
    return value


def add_table_grids(figures, order="before"):
    """Give each table the typed grid of what it prints, where it can be read without guessing (table_grid.py)."""
    for f in figures:
        if f["kind"] != "table":
            continue
        try:
            grid = table_grid.read_grid(f["_page"].pdf, f["bbox"], f["_rules"])
        except Exception as e:              # a table that cannot be read stays a picture and its text
            warn(f"table {f['number']}: no grid ({type(e).__name__}: {e})")
            grid = None
        if grid:
            f["grid"] = compose_in(grid, order)


def link_references(pages, figures):
    index = {(f["kind"], f["number"]): f for f in figures}
    for page in pages:
        for s in page.sentences:
            for m in FIG_REF_RE.finditer(s["text"]):
                kind = "table" if m.group(1).lower().startswith("tab") else "figure"
                for num in _expand_numbers(m.group(2)):
                    f = index.get((kind, num)) or index.get((kind, re.sub(r"[a-z]$", "", num)))
                    if f is None:
                        continue
                    own_label = s["block"] == f["caption_block"] and m.start() == 0
                    if not own_label and s["id"] not in f["referenced_by"]:
                        f["referenced_by"].append(s["id"])


def _expand_numbers(spec):
    nums = []
    for part in re.split(r"\s*(?:,|and|&|or)\s*", spec):
        m = re.fullmatch(r"(\d+)\s*(?:-|–|—|to)\s*(\d+)", part)
        if m and int(m.group(1)) < int(m.group(2)) <= int(m.group(1)) + 20:
            nums.extend(str(i) for i in range(int(m.group(1)), int(m.group(2)) + 1))
        elif part:
            nums.append(part.strip())
    return nums


def equation_records(pages):
    out, seen = [], set()
    for page in pages:
        for b in page.ordered:
            if b.type != "equation":
                continue
            tags = equation_tags(b, page)
            if not tags:
                continue
            content = [r for r in b.rows if not (len(r.words) == 1 and EQ_TAG_RE.match(r.text))]
            for w, _ in tags:
                number = EQ_TAG_RE.match(w.text).group(1)
                eid = "eq" + re.sub(r"[^0-9A-Za-z]", "", number)
                if eid in seen:
                    continue
                seen.add(eid)
                # with several numbers in one display, each takes the rows closest to it
                mine = [r for r in content
                        if min(tags, key=lambda t: abs(t[0].baseline - r.baseline))[0] is w] if len(tags) > 1 else content
                words = [x for r in (mine or content) for x in r.words if x is not w]
                bbox = union_all(x.bbox for x in words) if words else w.bbox
                text = " ".join(x.text for x in words)
                out.append({"id": eid, "number": number, "page": page.n, "bbox": rounded(bbox),
                            "block": b.id, "text": text})
    return out


# Displays without a printed number (see unnumbered_equation_records).
RELATION_RE = re.compile(r"[=≈≃≅≡∝∼∈≤≥≪≫<>→←↦⇒⇔⟹⟺≜]")
UNMAPPED_RE = re.compile(r"[\ufffd\ue000-\uf8ff]")      # glyphs MuPDF cannot map: large brackets, braces, radicals
DANGLING_RE = re.compile(r"[=≈≃≡∝∼∈≤≥<>+\-−·×/√∑∏∫(\[{⟨]$")
LEADING_RE = re.compile(r"^[=≈≃≡∝∼≤≥<>+\-−·×/)\]}⟩⇒⇔⟹⟺]")
ITEM_RE = re.compile(r"^\(?(?:[ivx]{1,4}|[a-h]|\d{1,2})\)\s+[^\s=+\-−·×/<>≤≥]")     # "(i) X = ...": a list item, not a display
LIMIT_RE = re.compile(r"\S{1,2}=[-−]?[\dn∞]+[,;]?")    # the limits of a sum or product: "j=1", "n=0", "l=−∞"
DISPLAY_GAP = 2.5         # blocks closer than this many body sizes sideways belong to one display
STACK_GAP = 0.6           # ... and closer than this many vertically


def display_pool(page, body, boxes):
    """Blocks that can be a piece of a display: equation blocks, and short paragraph blocks set off like one
    (a formula typeset mostly in the text font), except those inside a figure or table."""
    pool = []
    for b in page.ordered:
        if b.type == "equation":
            pass
        elif (b.type in ("paragraph", "other") and b.horizontal and len(b.rows) <= 3 and b.math >= 0.2
                and min(r.bbox[0] for r in b.rows) - page.cols[b.cls][0] >= 1.5 * body):
            pass
        else:
            continue
        if not any(inside_frac(b.bbox, box) >= 0.5 for box in boxes):
            pool.append(b)
    return pool


def display_clusters(pool, body):
    """Group the blocks that make up one display: side by side on a line, or stacked like a fraction."""
    parent = list(range(len(pool)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, a in enumerate(pool):
        for j in range(i + 1, len(pool)):
            ba, bb = a.bbox, pool[j].bbox
            side = y_overlap(ba, bb) > 0 and -x_overlap(ba, bb) <= DISPLAY_GAP * body
            stacked = x_overlap(ba, bb) > 0 and -y_overlap(ba, bb) <= STACK_GAP * body
            if side or stacked:
                parent[find(i)] = find(j)
    groups = {}
    for i, b in enumerate(pool):
        groups.setdefault(find(i), []).append(b)
    return list(groups.values())


def looks_like_equation(text, nrows):
    """Does the text of an unnumbered display read as a whole formula: a relation, brackets that close, no loose
    end, and glyphs that came through? A piece of a bigger display fails one of these."""
    t = " ".join(text.split())
    n = len(t.replace(" ", ""))
    if not 5 <= n <= 240 or nrows > 5 or not RELATION_RE.search(" ".join(w for w in t.split() if not LIMIT_RE.fullmatch(w))):
        return False
    if len(UNMAPPED_RE.findall(t)) > 0.1 * n or sum(ch.isalnum() for ch in t) < 3:
        return False
    if DANGLING_RE.search(t.rstrip(",.;")) or LEADING_RE.match(t) or ITEM_RE.match(t):
        return False
    if any(t.count(a) != t.count(b) for a, b in ("()", "[]", "{}")):
        return False
    prose = [w for w in t.split() if re.fullmatch(r"[a-z]{4,}", w)]
    return len(prose) <= 0.4 * len(t.split())


def unnumbered_equation_records(pages, numbered, figures, body):
    """Display equations without a printed number, as doc entries without an ID yet (number None).

    The pieces of a numbered display (a matrix, a fraction, the left half of a line that ends with its number) are
    not entries, and neither is anything that does not read as a formula on its own. A display set in the text
    font (no math fonts) must show mostly math glyphs, so a short indented sentence is never taken for one."""
    taken = {e["block"] for e in numbered if "block" in e}
    out = []
    for page in pages:
        boxes = [f["bbox"] for f in figures if f["page"] == page.n]
        for group in display_clusters(display_pool(page, body, boxes), body):
            if any(b.id in taken for b in group):
                continue
            rows = [r for b in group for r in b.rows]
            math = sum(r.math * r.nchars for r in rows) / sum(r.nchars for r in rows)
            if math < 0.3 and all(b.type != "equation" for b in group):
                continue
            group.sort(key=page.ordered.index)
            text = " ".join(b.raw_text for b in group)
            if looks_like_equation(text, len(rows)):
                out.append({"id": None, "number": None, "page": page.n,
                            "bbox": rounded(union_all(b.bbox for b in group)), "block": group[0].id, "text": text})
    return out


def with_unnumbered_equations(pages, numbered, figures, body):
    """The numbered equations and the unnumbered displays together in reading order; the unnumbered ones are
    numbered equ1, equ2, ... in that order, so a numbered equation keeps its ID whatever else is found."""
    at = {b.id: (page.n, i) for page in pages for i, b in enumerate(page.ordered)}
    merged = sorted(numbered + unnumbered_equation_records(pages, numbered, figures, body), key=lambda e: at[e["block"]])
    k = 0
    for e in merged:
        if e["number"] is None:
            k += 1
            e["id"] = f"equ{k}"
    return merged


# ---------------------------------------------------------------------------- exercises

def points_match(text):
    """The first points statement in text as (match, total, points of the parts or None); None if there is none or
    the points are per part ("je 2 Punkte")."""
    m = PART_POINTS_RE.search(text)
    if m:
        total = float(m.group("total").replace(",", "."))
        parts = [float(v.replace(",", ".")) for v in re.split(r"\s*[,;+/]\s*", m.group("parts"))]
        if abs(sum(parts) - total) < 0.01:
            whole = lambda v: int(v) if v == int(v) else v
            return m, whole(round(total, 2)), [whole(round(v, 2)) for v in parts]
    m = POINTS_RE.search(text)
    if m is None or re.search(r"\b(je|jeweils|each)\s*$", text[:m.start()], re.I):
        return None
    total = round(sum(float(v.replace(",", ".")) for v in re.split(r"\s*\+\s*", m.group(1))), 2)
    return m, int(total) if total == int(total) else total, None


def parse_points(text):
    """Points stated in text: "4 Punkte", "2+3 P.", "1,5 points" (summed), "20: 10,10 pts." (the total); None if
    there are none or they are per part ("je 2 Punkte")."""
    found = points_match(text)
    return found[1] if found else None


def points_only(text):
    """Points when text is nothing but a points statement, such as "(4 Punkte)" or "[5 points]"."""
    found = points_match(text)
    if found is None or re.sub(r"[\s()\[\]]", "", text[:found[0].start()] + text[found[0].end():]):
        return None
    return found[1]


def task_name(groups):
    """The name a heading's bracket groups give the task, without any points statement: "(Dice)" -> "Dice";
    "(20: 10,10 pts.)" has none."""
    for g in groups:
        found = points_match(g)
        name = (g[:found[0].start()] + " " + g[found[0].end():] if found else g).strip(" ,;")
        if re.search(r"[^\W\d_]{2,}", name):
            return name
    return ""


def bracket_end(text, i):
    """Index just after the bracket group that opens at text[i]; None if it never closes."""
    depth = 0
    for j in range(i, len(text)):
        if text[j] in "([":
            depth += 1
        elif text[j] in ")]":
            depth -= 1
            if depth == 0:
                return j + 1
    return None


def split_groups(text):
    """Plain text and bracket groups of a heading: "Eigenvalues [6 points]" -> ("Eigenvalues", ["6 points"])."""
    plain, groups, i = [], [], 0
    while i < len(text):
        j = bracket_end(text, i) if text[i] in "([" else None
        if j is None:
            plain.append(text[i])
            i += 1
        else:
            groups.append(text[i + 1:j - 1])
            plain.append(" ")
            i = j
    return " ".join("".join(plain).split()), groups


def points_beside(page, row):
    """Points set apart on the same line, right of the row: "Aufgabe 1 <hfill> (4 Punkte)". The line is the
    first word's, as a fraction later in the row ("(a) a_n = 3n/(n - 1)") moves the row's baseline."""
    base = row.words[0].baseline
    for r in page.rows:
        if (r is not row and r.horizontal and r.bbox[0] > row.bbox[2]
                and abs(r.baseline - base) <= 0.3 * row.size):
            pts = points_only(r.text)
            if pts is not None:
                return pts
    return None


def task_heading(row, page, stats, paper_like):
    """The task heading that starts row, with the evidence for it; None if the row does not start with one.

    "Aufgabe 1 (4 Punkte)" on its own line and "**Problem 2.** (Eigenvalues, 6 points) Let A ..." run into
    the statement are both headings; "Problem 3 is hard" at the start of a paragraph is not. The evidence
    is bold or larger type, stated points, a line of its own, punctuation after the number and the word
    itself ("Aufgabe" and "Exercise" are rarely anything else)."""
    text = row.text
    m = TASK_RE.match(text) or TASK_NUMBER_FIRST_RE.match(text)
    if m is None:
        return None
    after = text[m.end():].lstrip()
    if re.match(r"\d{1,3}\b", after) and not POINTS_RE.match(after):
        return None                   # a grading table's header: "Aufgabe 1 2 3 Summe", not "Aufgabe 1 4 Punkte"
    body = stats.fonts.body_size
    bold_end, pos = 0, 0              # end of the leading run of bold words
    for w in row.words:
        if w.bold < 0.9:
            break
        pos += len(w.text) + 1
        bold_end = pos - 1
    kw_bold = bold_end >= m.end()
    # the heading runs on over punctuation and bracket groups: "Problem 2. (Eigenvalues, 6 points)"
    end = max(m.end(), bold_end) if kw_bold else m.end()
    while end < len(text):
        if text[end].isspace() or text[end] in ".:–—-":
            end += 1
        elif text[end] in "([" and bracket_end(text, end):
            end = bracket_end(text, end)
        else:
            break
    head, rest = text[m.end():end], text[end:].strip()
    delimited = m.re is TASK_NUMBER_FIRST_RE or head.lstrip()[:1] in (".", ":", "(", "[")
    large = row.size >= 1.05 * body
    # the rest of the line is a title ("Exercise 2: Eigenvalues") or the statement run in after the heading
    core, tail = split_groups(rest)
    starts, pos = [], 0
    for w in row.words:
        starts.append(pos)
        pos += len(w.text) + 1
    rest_words = [w for w, s in zip(row.words, starts) if s >= end]
    n = sum(w.nchars for w in rest_words)
    math = sum(w.math * w.nchars for w in rest_words) / n if n else 0.0
    short = row.bbox[2] < page.cols[row.cls][1] - 3 * row.size
    # a title in the heading's own brackets ("Problem 2. (Simplifying, 4 points) Simplify ...") makes the rest
    # of the line the statement
    named = any(POINTS_RE.sub("", g).strip(" ,;") for g in split_groups(head)[1])
    title_like = (not named and 0 < len(core.split()) <= 8 and core[:1].isupper() and core[-1:] not in ".:;,!?"
                  and not re.search(r"[:=]", core) and core.split()[0].lower().rstrip(",;") not in STATEMENT_WORDS
                  and math < 0.2)
    own_line = not rest or all_bold(row) or large or (short and (title_like or points_only(core) is not None))
    plain, groups = split_groups(head + " " + rest if own_line else head)
    found = next((f for f in map(points_match, groups) if f), None)
    points, part_points = (found[1], found[2]) if found else (None, None)
    bare = POINTS_RE.search(plain) if points is None else None
    if bare:                          # "Aufgabe 1 – 4 Punkte"
        points, plain = parse_points(plain), plain[:bare.start()] + plain[bare.end():]
    if points is None and not own_line and tail:
        points = points_only("(" + tail[-1] + ")") if rest.endswith((")", "]")) else None
    if points is None:
        points = points_beside(page, row)
    title = plain.strip(" .:–—-") or task_name(groups)
    kw = m.group("kw").lower()
    vocab = kw.endswith(SHEET_WORDS)
    score = (2 * kw_bold + 2 * large + 2 * (points is not None) + own_line + delimited
             + (vocab or not paper_like))
    if paper_like and not vocab and points is None:
        score = 0                     # "Task 1:" and "Problem 2." run-in heads of a paper
    return {"keyword": m.group("kw"), "number": m.group("num"), "title": title, "points": points,
            "part_points": part_points, "own_line": own_line, "score": score,
            "strong": kw_bold or large or points is not None}


def label_words(found):
    """Keywords that label things rather than tasks here: "Task 1" and "Task 2" on the source and target sides of
    each diagram of a lecture. A task keyword never repeats a number on one page, nor prints one number three
    times; the sheet words ("Aufgabe", "Exercise") and headings with points are always tasks."""
    seen, out = Counter(), set()
    for b, _, head in found:
        kw = head["keyword"].lower()
        if head["points"] is None and not kw.endswith(SHEET_WORDS):
            seen[kw, b.page, head["number"]] += 1
    numbers = Counter((kw, num) for kw, _, num in seen.elements())
    for (kw, _, num), n in seen.items():
        if n > 1 or numbers[kw, num] >= 3:
            out.add(kw)
    return out


def mark_task_heads(pages, stats):
    """Set row.task on every task heading; True when the document is an exercise sheet.

    Runs before classification, which keeps task headings out of the title and the author lines. A
    heading inside a paragraph needs bold or larger type or points; in a document with an abstract or
    references, "Problem", "Task" and "Question" also need points, and anywhere they need them when they
    label several things (label_words)."""
    paper_like = any(r.horizontal and (ABSTRACT_RE.match(r.text)
                                       or r.text.strip().lower().rstrip(".:") in PAPER_HEADINGS)
                     for page in pages for r in page.rows)
    found = []
    for page in pages:
        for b in page.blocks:
            if b.caption or not b.horizontal:
                continue
            for k, r in enumerate(b.rows):
                head = task_heading(r, page, stats, paper_like)
                if head and head["score"] >= 2 and (k == 0 or head["strong"]):
                    found.append((b, r, head))
    # "Übung 5" set as the sheet's title above "Aufgabe 1", "Aufgabe 2" is not a task
    title = find_title(pages[0], stats.fonts.body_size) if pages else None
    first = next((f for f in found if title is not None and f[1] is title.rows[0]), None)
    if first is not None and first[2]["points"] is None:
        others = [f for f in found if f is not first]
        kw = first[2]["keyword"].lower()
        if (not others or all(f[2]["keyword"].lower() != kw for f in others)
                or first[1].size > max(f[1].size for f in others) + 0.5):
            found.remove(first)
    found = [f for f in found if f[2]["points"] is not None or f[2]["keyword"].lower() not in label_words(found)]
    for _, r, head in found:
        r.task = head
    return bool(found)


def next_label(kind, label):
    if kind == "alpha":
        return chr(ord(label) + 1) if len(label) == 1 and label < "z" else None
    k = ROMAN_LABELS.index(label) if label in ROMAN_LABELS else len(ROMAN_LABELS)
    return ROMAN_LABELS[k + 1] if k + 1 < len(ROMAN_LABELS) else None


def place_label(label, levels, new_list):
    """Depth of a part label in its task, or None when it does not continue the task's lists.

    levels holds the open lists as [kind, last label]: "b" follows "a", "ii" follows "i", and "i" after
    "c" opens sub-parts ("(c)(i)"), while "i" after "h" is the ninth part. A new list starts only where
    new_list allows it (a row that starts a block or follows a full stop), at most two levels deep."""
    for depth in range(len(levels) - 1, -1, -1):
        kind, last = levels[depth]
        if label == next_label(kind, last):
            del levels[depth + 1:]
            levels[depth][1] = label
            return depth
    kind = {"a": "alpha", "i": "roman"}.get(label)
    if not new_list or kind is None or len(levels) >= 2 or (levels and levels[-1][0] == kind):
        return None
    levels.append([kind, label])
    return len(levels) - 1


SPLITTABLE = {"paragraph", "other", "equation"}


def find_exercises(pages):
    """Tasks and their parts, in reading order, from the headings that mark_task_heads found.

    A task runs from its heading to the next task heading or the next other heading; its parts start
    at rows with a label ("a)", "(b)", "(ii)") in sequence. Blocks are split so that every task and every
    part starts a block of its own, and the pages are put in reading order again, so that "(2 Punkte)"
    set beside part a stays with it. Returns [{"head", "block", "blocks", "parts"}] with Block objects;
    a part is {"label", "points", "blocks", "parts"}. exercise_records turns them into IDs."""
    tasks, starts = cut_exercises(pages)
    task, open_parts = None, []
    for page in pages:
        order_page(page)
        for b in page.ordered:
            if b.type in ("header_footer", "footnote"):
                continue
            kind, x, depth = starts.get(b, (None, None, None))
            if kind == "task":
                task, open_parts = x, []
            elif kind == "part":
                open_parts = open_parts[:depth] + [x]
            elif kind == "end":
                open_parts = open_parts[:depth]
            elif b.type == "heading":
                task, open_parts = None, []                  # "Hinweise" after the last task
            if task is not None:
                task["block"] = task["block"] or b
                for owner in [task] + open_parts:
                    owner["blocks"].append(b)
    for t in tasks:
        settle_points(t, pages)
    return tasks


def cut_exercises(pages):
    """Find tasks and parts in reading order and split blocks so that each of them starts a block.

    Returns the tasks, with their parts nested but no blocks yet, and {block: (kind, task or part, depth)}
    for the blocks that start a task, a part, or the end of parts ("end", None, number of parts kept)."""
    tasks, task, levels, open_parts, starts = [], None, [], [], {}
    for page in pages:
        for b in page.ordered:
            if b.type in ("header_footer", "footnote"):
                continue
            if b.type == "heading" and points_only(b.raw_text) is not None:
                b.type = "paragraph"         # "(6 Punkte)" set apart from "Aufgabe 1" is no section
            if b.type == "heading" and b.rows[0].task is None:
                task, levels, open_parts = None, [], []
            splittable = b.type in SPLITTABLE and b.horizontal
            cuts = [[0, None]]                               # [first row, what starts there]
            for k, r in enumerate(b.rows):
                if k > 0 and not splittable:
                    break
                start = None
                if r.task is not None:
                    task, levels, open_parts = {"head": r.task, "block": None, "blocks": [], "parts": []}, [], []
                    tasks.append(task)
                    start = ("task", task, 0)
                elif task is not None and splittable:
                    m = PART_RE.match(r.text)
                    after = r.text[m.end():].lstrip() if m else ""
                    prev = b.rows[k - 1] if k else None
                    # a list starts on a new line of its own, not in "... wie in Teil" / "(a) beschrieben"
                    new_list = (prev is None or prev.task is not None or not after[:1].islower()
                                or re.search(r"[.:;!?]$", prev.text) or abs(r.bbox[0] - prev.bbox[0]) >= 0.5 * r.size)
                    label = (m.group("p") or m.group("q")) if m else None
                    trial = [level[:] for level in levels]
                    depth = place_label(label, trial, new_list) if m else None
                    parent = None
                    if depth is not None:
                        parent = open_parts[depth - 1] if depth else task
                    if parent is not None and all(p["label"] != label for p in parent["parts"]):
                        end = bracket_end(after, 0) if after.startswith(("(", "[")) else None
                        part = {"label": label, "row": r, "blocks": [], "parts": [],
                                "points": points_only(after[:end]) if end else None}
                        parent["parts"].append(part)
                        levels, open_parts = trial, open_parts[:depth] + [part]
                        start = ("part", part, depth)
                    elif open_parts and r.bbox[0] < open_parts[-1]["row"].bbox[0] - 0.5 * r.size and (
                            LIST_MARK_RE.match(r.text) or (k == 0 and b.type == "paragraph" and r.math < 0.3)):
                        # "2. Justify ..." after "1. ... a. ... b. ...", or a note after the list: the
                        # parts indented further than this line end here
                        keep = next((i for i, p in enumerate(open_parts)
                                     if p["row"].bbox[0] > r.bbox[0] + 0.5 * r.size), len(open_parts))
                        levels, open_parts = levels[:keep], open_parts[:keep]
                        start = ("end", None, keep)
                if start is None:
                    continue
                at = k
                # the top rows of a matrix set beside a part's label sit above the label's line
                while (start[0] == "part" and at - 1 > cuts[-1][0] and b.rows[at - 1].bbox[0] > r.words[0].bbox[2]
                       and r.baseline - b.rows[at - 1].baseline < b.rows[at - 1].baseline - b.rows[at - 2].baseline):
                    at -= 1
                if cuts[-1][0] == at:
                    cuts[-1] = [at, start]
                else:
                    cuts.append([at, start])
                if start[0] == "task" and r.task["own_line"] and splittable and k + 1 < len(b.rows):
                    cuts.append([k + 1, None])               # the statement under the heading line
            pieces = [b]
            if len(cuts) > 1:
                ends = [c[0] for c in cuts[1:]] + [len(b.rows)]
                pieces = [Block(b.page, b.rows[first:last], b.type) for (first, _), last in zip(cuts, ends)]
                at = page.blocks.index(b)
                page.blocks[at:at + 1] = pieces
            for piece, (_, start) in zip(pieces, cuts):
                if start is not None:
                    starts[piece] = start
                    if start[0] == "part":
                        piece.type = "paragraph"             # a list item, even one full of math
    return tasks, starts


def settle_points(task, pages):
    """Points stated at the end of a part's label line or of its text ("... gilt. (2 Punkte)"), or set apart
    to the right of either; the same for a task without parts whose heading states none."""
    by_page = {p.n: p for p in pages}

    def stated(lines):
        for row, page, before in lines:
            # "(2" may end the line before: "... einsetzen. (2" / "Punkte)"
            text = row.text if before is None else before.text + " " + row.text
            if text.endswith((")", "]")):
                pts = points_only(text[text.rfind("(" if text.endswith(")") else "["):])
                if pts is not None:
                    return pts
            pts = points_beside(by_page[page], row)
            if pts is not None:
                return pts
        return None

    def last_line(block):
        return block.rows[-1], block.page, block.rows[-2] if len(block.rows) > 1 else None

    def visit(part):
        for sub in part["parts"]:
            visit(sub)
        if part["points"] is None:
            lines = [(part["row"], part["blocks"][0].page, None)]
            if not part["parts"]:
                lines.append(last_line(part["blocks"][-1]))
            part["points"] = stated(lines)

    for part in task["parts"]:
        visit(part)
    # "(20: 5,10,5 pts.)" gives each part its own points, when there is one number per part and none is stated
    given = task["head"].get("part_points")
    if given and len(given) == len(task["parts"]) and all(p["points"] is None for p in task["parts"]):
        for part, value in zip(task["parts"], given):
            part["points"] = value
    if task["head"]["points"] is None and not task["parts"]:
        task["head"]["points"] = stated([last_line(task["blocks"][-1])])


def exercise_records(tasks):
    """doc.json entries for the tasks of find_exercises, once blocks have IDs: ex1, ex2.3, exH1, and parts
    ex1.a, ex1.c.ii. A number printed twice (sheets 1 and 2 in one PDF) gets ex1-2."""
    def part_records(parent, parts):
        out = []
        for p in parts:
            rec = {"id": f"{parent}.{p['label']}", "label": p["label"]}
            if p["points"] is not None:
                rec["points"] = p["points"]
            rec.update(page=p["blocks"][0].page, blocks=[b.id for b in p["blocks"]])
            if p["parts"]:
                rec["parts"] = part_records(rec["id"], p["parts"])
            out.append(rec)
        return out

    records, seen = [], set()
    for t in tasks:
        head = t["head"]
        base = "ex" + head["number"]
        eid, k = base, 2
        while eid in seen:
            eid = f"{base}-{k}"
            k += 1
        seen.add(eid)
        rec = {"id": eid, "number": head["number"]}
        if head["title"]:
            rec["title"] = head["title"]
        if head["points"] is not None:
            rec["points"] = head["points"]
        rec.update(page=t["block"].page, block=t["block"].id, blocks=[b.id for b in t["blocks"]],
                   parts=part_records(eid, t["parts"]))
        records.append(rec)
    return records


# ---------------------------------------------------------------------------- pipeline

class Stats:
    pass


def compose_split_accents(raw_pages, fonts):
    """The lines of all pages with each spacing accent joined to its letter (see accents.py), and whether the document
    sets the accent before or after its letter. Math fonts are left alone: their accents are \\hat and \\ddot."""
    def skip(ch):
        return fonts.is_math(ch[4])

    lines = [chars for page in raw_pages for _, chars in page if accents.has_accent([c[0] for c in chars])]
    order = accents.accent_order(
        ([c[0] for c in chars], lambda j, chars=chars: skip(chars[j])) for chars in lines)
    if not lines:
        return raw_pages, order
    return [[(horizontal, accents.compose_chars(chars, order, skip)) for horizontal, chars in page]
            for page in raw_pages], order


def analyse(pdf):
    """Run the whole pipeline; returns (pages, sections, figures, equations, stats).

    stats.exercises holds the doc.json entries of an exercise sheet's tasks (empty for other documents)."""
    raw_pages = [read_lines(p) for p in pdf]
    char_fonts, char_sizes = Counter(), Counter()
    for lines in raw_pages:
        for horizontal, chars in lines:
            if horizontal:
                for c in chars:
                    if not c[0].isspace():
                        char_fonts[c[4]] += 1
                        char_sizes[round(c[3] * 2) / 2] += 1
    stats = Stats()
    stats.fonts = Fonts(char_fonts, char_sizes)
    body = stats.fonts.body_size
    raw_pages, stats.accent_order = compose_split_accents(raw_pages, stats.fonts)

    pages, page_segs = [], []
    for pdf_page, lines in zip(pdf, raw_pages):
        page = Page(pdf_page)
        segs = []
        for horizontal, chars in lines:
            words = make_words(chars, horizontal, stats.fonts)
            if words:
                segs.extend(line_segments(horizontal, words))
        page.gutter = detect_gutter(segs, page.width, body)
        pages.append(page)
        page_segs.append(segs)
    known = [p.gutter for p in pages if p.gutter is not None]
    if len(known) >= 2:
        doc_gutter = median(known)
        for page, segs in zip(pages, page_segs):
            if page.gutter is None and gutter_fits(segs, page.width, body, doc_gutter):
                page.gutter = doc_gutter
    for page, segs in zip(pages, page_segs):
        for s in segs:
            s.cls = row_class(s.bbox, page.gutter)
        page.rows = merge_rows(segs)
        page.cols = column_bounds(page.rows, page.gutter, page.width, body)

    stats.leading = estimate_leading(pages, body)
    stats.text_area = estimate_text_area(pages, body)
    stats.front_y = 0.0
    if pages:
        for r in sorted(pages[0].rows, key=lambda r: r.bbox[1]):
            if re.fullmatch(r"(abstract|(?:1\.?|i\.)\s+introduction)[.:]?", r.text.strip().lower()):
                stats.front_y = r.bbox[1]
                break

    for page in pages:
        read_graphics(page)
        drop_text_decorations(page)
        page.blocks = group_blocks(page, stats)
        mark_barriers(page, stats)
        find_tables(page, stats)
        find_figures(page, stats)
        for reg in page.regions:
            claim_region_text(page, reg)

    stats.sheet = mark_task_heads(pages, stats)
    classify(pages, stats)
    for page in pages:
        order_page(page)
    tasks = find_exercises(pages) if stats.sheet else []
    sections = build_sections(pages, pdf.get_toc())
    split_references(pages, sections)
    assign_ids_and_sentences(pages, build_vocab(pages))
    stats.exercises = exercise_records(tasks)
    figures = figure_records(pages)
    add_table_grids(figures, stats.accent_order)
    link_references(pages, figures)
    equations = with_unnumbered_equations(pages, equation_records(pages), figures, body)
    return pages, sections, figures, equations, stats


def estimate_leading(pages, body):
    """Typical baseline distance in body paragraphs, as a multiple of the font size."""
    ratios = Counter()
    for page in pages:
        rows = sorted((r for r in page.rows if r.horizontal and abs(r.size - body) < 0.6), key=lambda r: r.baseline)
        for a, b in zip(rows, rows[1:]):
            if a.cls == b.cls and x_overlap(a.bbox, b.bbox) > 0.5 * min(width(a.bbox), width(b.bbox)):
                ratio = (b.baseline - a.baseline) / body
                if 1.0 <= ratio <= 1.8:
                    ratios[round(ratio, 2)] += 1
    return ratios.most_common(1)[0][0] if ratios else 1.2


def estimate_text_area(pages, body):
    """Top and bottom of the type area: median over pages of the first and last body line."""
    tops, bottoms = [], []
    for page in pages:
        rows = [r for r in page.rows if r.horizontal and abs(r.size - body) < 0.15 * body
                and width(r.bbox) >= 0.5 * col_width(page, r.cls)]
        if rows:
            tops.append(min(r.bbox[1] for r in rows))
            bottoms.append(max(r.bbox[3] for r in rows))
    if not tops:
        return 0.0, max(p.height for p in pages)
    return median(tops), median(bottoms)


def build_doc(pdf_path, pdf, pages, sections, figures, equations, stats):
    with open(pdf_path, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    source = {"file": os.path.basename(pdf_path), "sha256": sha, "num_pages": pdf.page_count}
    if stats.title is not None:
        source["title"] = " ".join(stats.title.text.split())
    source["generator"] = f"paper-tour ingest {VERSION} (PyMuPDF {pymupdf.VersionBind})"
    blocks = []
    for page in pages:
        for b in page.ordered:
            rec = {"id": b.id, "page": page.n, "type": b.type, "bbox": rounded(b.bbox), "text": b.text}
            if b.section:
                rec["section"] = b.section
            rec["sentences"] = b.sentences
            blocks.append(rec)
    secs = []
    for s in sections:
        rec = {"id": s["id"]}
        if s["number"]:
            rec["number"] = s["number"]
        rec.update(title=s["title"], level=s["level"], page=s["block"].page, block=s["block"].id)
        secs.append(rec)
    doc = {
        "schema": SCHEMA_ID,
        "source": source,
        "pages": [{"n": p.n, "width": round(p.width, 2), "height": round(p.height, 2)} for p in pages],
        "sections": secs,
        "blocks": blocks,
        "sentences": [s for p in pages for s in p.sentences],
        "figures": [{k: v for k, v in f.items() if not k.startswith("_")} for f in figures],
        "equations": equations,
    }
    if getattr(stats, "exercises", None):
        doc["exercises"] = stats.exercises     # only exercise sheets have the key
    return doc


def schema_errors(doc):
    with open(DOC_SCHEMA, encoding="utf-8") as fh:
        schema = json.load(fh)
    validator = jsonschema.Draft202012Validator(schema)
    errors = []
    order = lambda e: [(0, p, "") if isinstance(p, int) else (1, 0, p) for p in e.absolute_path]
    for e in sorted(validator.iter_errors(doc), key=order):
        path = "$" + "".join(f"[{p}]" if isinstance(p, int) else f".{p}" for p in e.absolute_path)
        errors.append(f"{path}: {e.message}")
    return errors


def dump_doc(doc):
    """JSON with one line per array item, so doc.json stays readable and greppable."""
    out = ["{"]
    keys = list(doc)
    for i, k in enumerate(keys):
        v, comma = doc[k], "," if i < len(keys) - 1 else ""
        if isinstance(v, list) and v:
            out.append(f' "{k}": [')
            out.extend("  " + json.dumps(item, ensure_ascii=False) + ("," if j < len(v) - 1 else "")
                       for j, item in enumerate(v))
            out.append(" ]" + comma)
        else:
            out.append(f' "{k}": ' + json.dumps(v, ensure_ascii=False) + comma)
    out.append("}")
    return "\n".join(out) + "\n"


def write_figures(figures, out_dir):
    fig_dir = os.path.join(out_dir, "figures")
    os.makedirs(fig_dir, exist_ok=True)
    wanted = set()
    for f in figures:
        name = f["id"] + ".png"
        wanted.add(name)
        pix = f["_page"].pdf.get_pixmap(dpi=FIGURE_DPI, clip=pymupdf.Rect(f["bbox"]), alpha=False)
        pix.save(os.path.join(fig_dir, name))
    for name in os.listdir(fig_dir):         # crops left over from an earlier run
        if re.fullmatch(r"(fig|tab)[0-9A-Za-z]+\.png", name) and name not in wanted:
            os.remove(os.path.join(fig_dir, name))


# ---------------------------------------------------------------------------- debug rendering

TYPE_COLORS = {
    "title": (0.5, 0.0, 0.6), "authors": (0.6, 0.3, 0.8), "heading": (0.85, 0.0, 0.0),
    "paragraph": (0.1, 0.3, 0.9), "caption": (1.0, 0.5, 0.0), "equation": (0.0, 0.6, 0.6),
    "footnote": (0.55, 0.3, 0.1), "reference": (0.4, 0.5, 0.0), "figure_text": (0.9, 0.0, 0.7),
    "table_text": (0.0, 0.45, 0.45), "header_footer": (0.5, 0.5, 0.5), "other": (0.0, 0.0, 0.0),
}
SENTENCE_FILLS = [(1.0, 0.9, 0.2), (0.3, 0.85, 1.0)]


def render_debug(pdf_path, pages, figures, equations, out_dir, exercises=()):
    dbg_dir = os.path.join(out_dir, "_debug")
    os.makedirs(dbg_dir, exist_ok=True)
    dbg = pymupdf.open(pdf_path)
    figs_by_page, eqs_by_page, starts = {}, {}, {}
    for f in figures:
        figs_by_page.setdefault(f["page"], []).append(f)
    for e in equations:
        eqs_by_page.setdefault(e["page"], []).append(e)
    todo = list(exercises)
    while todo:                       # the block each task and part starts at
        x = todo.pop()
        starts.setdefault(x["blocks"][0], []).append(x["id"])
        todo.extend(x.get("parts", []))
    wanted = set()
    for page in pages:
        p = dbg[page.n - 1]
        sh = p.new_shape()
        for i, s in enumerate(page.sentences):
            for r in s["rects"]:
                sh.draw_rect(pymupdf.Rect(r))
                sh.finish(color=None, fill=SENTENCE_FILLS[i % 2], fill_opacity=0.28, width=0)
        sh.commit()
        sh = p.new_shape()    # outlines in their own shape, or they can wipe out the fills
        for b in page.ordered:
            sh.draw_rect(pymupdf.Rect(b.bbox))
            sh.finish(color=TYPE_COLORS[b.type], width=0.6)
        for f in figs_by_page.get(page.n, []):
            sh.draw_rect(pymupdf.Rect(f["bbox"]))
            sh.finish(color=(0.0, 0.7, 0.0) if f["kind"] == "figure" else (0.0, 0.4, 0.15), width=1.8)
            for pn in f["panels"]:
                sh.draw_rect(pymupdf.Rect(pn["bbox"]))
                sh.finish(color=(0.4, 0.9, 0.0), width=1.0, dashes="[3 2] 0")
        for e in eqs_by_page.get(page.n, []):
            sh.draw_rect(pymupdf.Rect(e["bbox"]))
            sh.finish(color=(0.0, 0.6, 0.6), width=1.5)
        sh.commit()
        for b in page.ordered:
            x0, y0 = b.bbox[0], b.bbox[1]
            p.insert_text((x0 + 0.5, max(y0 - 0.6, 5)), f"{b.id} {b.type}", fontsize=4.2, color=TYPE_COLORS[b.type])
            if b.id in starts:
                p.insert_text((max(x0 - 34, 2), y0 + 6), " ".join(sorted(starts[b.id])), fontsize=6,
                              color=(0.8, 0.0, 0.4))
        for f in figs_by_page.get(page.n, []):
            p.insert_text((f["bbox"][0] + 1, f["bbox"][1] + 7), f["id"], fontsize=7, color=(0.0, 0.6, 0.0))
            for pn in f["panels"]:
                p.insert_text((pn["bbox"][0] + 1, pn["bbox"][3] - 2), pn["id"], fontsize=6, color=(0.3, 0.7, 0.0))
        for e in eqs_by_page.get(page.n, []):
            p.insert_text((e["bbox"][0], e["bbox"][3] + 5), e["id"], fontsize=6, color=(0.0, 0.5, 0.5))
        name = f"page-{page.n:02d}.png"
        wanted.add(name)
        p.get_pixmap(dpi=DEBUG_DPI, alpha=False).save(os.path.join(dbg_dir, name))
    for name in os.listdir(dbg_dir):
        if re.fullmatch(r"page-\d+\.png", name) and name not in wanted:
            os.remove(os.path.join(dbg_dir, name))


# ---------------------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description="PDF paper -> doc.json + figure crops for Paper Tour.")
    ap.add_argument("pdf", help="path to the PDF")
    ap.add_argument("--out", help="output folder (default: the PDF's folder)")
    ap.add_argument("--debug", action="store_true", help="also render _debug/page-NN.png overlays")
    args = ap.parse_args(argv)

    pdf_path = os.path.abspath(args.pdf)
    if not os.path.isfile(pdf_path):
        sys.exit(f"error: no such file: {args.pdf}")
    out_dir = os.path.abspath(args.out) if args.out else os.path.dirname(pdf_path)
    try:
        pdf = pymupdf.open(pdf_path)
    except (pymupdf.FileDataError, RuntimeError) as e:
        sys.exit(f"error: cannot open {args.pdf} as a PDF: {e}")
    if pdf.page_count == 0:
        sys.exit("error: the PDF has no pages")

    pages, sections, figures, equations, stats = analyse(pdf)
    doc = build_doc(pdf_path, pdf, pages, sections, figures, equations, stats)
    if os.path.dirname(pdf_path) != out_dir:
        doc["source"]["file"] = os.path.relpath(pdf_path, out_dir)
    errors = schema_errors(doc)
    if errors:
        print(f"error: the generated doc.json does not match {DOC_SCHEMA}; nothing written:", file=sys.stderr)
        for e in errors[:50]:
            print("  " + e, file=sys.stderr)
        if len(errors) > 50:
            print(f"  ... and {len(errors) - 50} more", file=sys.stderr)
        return 1

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "doc.json"), "w", encoding="utf-8") as fh:
        fh.write(dump_doc(doc))
    write_figures(figures, out_dir)
    if args.debug:
        render_debug(pdf_path, pages, figures, equations, out_dir, doc.get("exercises", ()))

    n_tab = sum(1 for f in figures if f["kind"] == "table")
    print(f"wrote {os.path.join(out_dir, 'doc.json')}: {len(pages)} pages, {len(doc['blocks'])} blocks, "
          f"{len(doc['sentences'])} sentences, {len(sections)} sections, {len(figures) - n_tab} figures, "
          f"{n_tab} tables, {sum(len(f['panels']) for f in figures)} panels, {len(equations)} equations"
          + (f", {len(doc['exercises'])} exercises" if "exercises" in doc else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
