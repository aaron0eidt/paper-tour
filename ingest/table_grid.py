"""Typed grids for tables: what a table prints, as rows and columns a program can use.

    read_grid(page, bbox, rules=()) -> dict or None

page is a PyMuPDF page, bbox the table body (excluding its caption) and rules the rule rectangles drawn inside it.
The grid goes into doc.json as the "grid" of a table figure:

    {"confidence": "high" | "medium", "method": "spans" | "finder", "label_header": "Model",
     "columns": [{"name": "BLEU EN-DE", "kind": "number" | "text", "unit": "%", "better": "up" | "down"}, ...],
     "rows": [{"label": "ByteNet [18]", "group": "(A)", "note": "...",
               "cells": [{"text": "23.75", "value": 23.75}, {"text": ""}, ...]}, ...],
     "notes": ["..."]}

Every row has one cell per column; a blank cell has the empty string. A cell holds a value only when the whole cell
is one number ("2.3 x 10^19" is 2.3e19, "0.16 +- 0.11" is 0.16, "<0.001" and "0.16-0.40" have none). Scripts are
written as "d_model" and "10^19". The label column is the leftmost one when it holds text. A grid is only returned
when the reading is trustworthy: confidence "high" means the header, the columns and every row were found without
guessing, "medium" that some of it was inferred (no rules to separate the header, spanning cells, wrapped cells).
Anything less gets no grid at all.

Columns are found the way a reader sees them: the row with the most cells shows where the columns are, other rows
fall into those columns, and a cell that spans several columns is told from an overflowing label. PyMuPDF's own table
finder is tried first and used for fully ruled grids only; its cell boxes give the structure and the text is read
again so that scripts and signs survive.
"""

import math
import re
from statistics import median
from types import SimpleNamespace

import pymupdf

getattr(pymupdf, "no_recommend_layout", lambda: None)()    # the table finder would print a recommendation to stdout, where process.py answers

MAX_ROWS, MAX_COLUMNS = 80, 16
SCRIPT = 0.85             # a character below this share of the word's size is a sub- or superscript
SYMBOL_MARKS = set("*†‡§¶∗⋆#")


# ---------------------------------------------------------------------------- words

class Word:
    __slots__ = ("text", "bbox", "size", "base")

    def __init__(self, text, bbox, size, base):
        self.text, self.bbox, self.size, self.base = text, list(bbox), size, base


def _text_of(chars):
    """A word's text with its scripts marked: d_model, 10^19, m^2. Footnote symbols stay unmarked."""
    top = max(c[3] for c in chars)
    main = [c for c in chars if c[3] >= SCRIPT * top]
    base = median(c[2] for c in main)
    runs = []
    for c in chars:
        kind = ""
        if c[3] < SCRIPT * top:
            kind = "^" if c[2] < base - 0.15 * top else "_" if c[2] > base + 0.1 * top else ""
        if runs and runs[-1][0] == kind:
            runs[-1][1] += c[0]
        else:
            runs.append([kind, c[0]])
    return "".join(k + t if k and not set(t) <= SYMBOL_MARKS else t for k, t in runs), top, base


def _split_chars(chars):
    """Words of one line of chars (c, bbox, baseline, size): split at spaces and at gaps wider than 0.3em."""
    words, cur, prev, spaced = [], [], None, False
    for ch in chars:
        if ch[0].isspace():
            spaced = True
            continue
        if cur and (spaced or ch[1][0] - prev[1][2] > 0.3 * max(ch[3], prev[3])):
            words.append(cur)
            cur = []
        cur.append(ch)
        prev, spaced = ch, False
    if cur:
        words.append(cur)
    return words


def read_words(page, bbox):
    """The words inside bbox, horizontal text only, each with its size and baseline. A script printed as a line of
    its own (a subscript MuPDF split off) is joined to the word it belongs to."""
    box = pymupdf.Rect(bbox)
    wide = pymupdf.Rect(box.x0 - 2, box.y0 - 2, box.x1 + 2, box.y1 + 2)
    raw = page.get_text("rawdict", clip=wide, flags=pymupdf.TEXT_MEDIABOX_CLIP)
    words = []
    for blk in raw["blocks"]:
        if blk.get("type", 0) != 0:
            continue
        for ln in blk["lines"]:
            if abs(ln["dir"][1]) > 0.02 or ln["dir"][0] <= 0:
                continue
            chars = [(ch["c"], ch["bbox"], ch["origin"][1], sp["size"]) for sp in ln["spans"] for ch in sp["chars"]
                     if wide.contains(pymupdf.Point((ch["bbox"][0] + ch["bbox"][2]) / 2, (ch["bbox"][1] + ch["bbox"][3]) / 2))]
            for group in _split_chars(chars):
                text, size, base = _text_of(group)
                words.append(Word(text, (min(c[1][0] for c in group), min(c[1][1] for c in group),
                                         max(c[1][2] for c in group), max(c[1][3] for c in group)), size, base))
    return _join_scripts(words)


def _join_scripts(words):
    """A word much smaller than the one it touches, and off its baseline, is its script: "d" + "model"."""
    out = []
    for w in sorted(words, key=lambda w: (w.bbox[0], w.base)):
        host = next((h for h in reversed(out) if h.size >= 1.2 * w.size
                     and -0.2 * h.size <= w.bbox[0] - h.bbox[2] <= 0.35 * h.size
                     and min(h.bbox[3], w.bbox[3]) - max(h.bbox[1], w.bbox[1]) > 0.2 * w.size
                     and abs(w.base - h.base) > 0.1 * h.size), None)
        if host is None:
            out.append(w)
            continue
        host.text += ("^" if w.base < host.base else "_") + w.text
        host.bbox = [min(host.bbox[0], w.bbox[0]), min(host.bbox[1], w.bbox[1]),
                     max(host.bbox[2], w.bbox[2]), max(host.bbox[3], w.bbox[3])]
    return out


# ---------------------------------------------------------------------------- lines and runs

class Run:
    """Words of one line that belong together: one cell, or part of one."""
    __slots__ = ("text", "x0", "x1", "size")

    def __init__(self, words):
        self.text = " ".join(w.text for w in words)
        self.x0, self.x1 = min(w.bbox[0] for w in words), max(w.bbox[2] for w in words)
        self.size = max(w.size for w in words)


class Line:
    __slots__ = ("words", "base", "size", "runs")

    def __init__(self, words):
        self.words = sorted(words, key=lambda w: w.bbox[0])
        self.base = median(w.base for w in words)
        self.size = max(w.size for w in words)
        runs, cur = [], [self.words[0]]
        for w in self.words[1:]:
            if w.bbox[0] - cur[-1].bbox[2] > 0.55 * max(w.size, cur[-1].size):
                runs.append(Run(cur))
                cur = []
            cur.append(w)
        runs.append(Run(cur))
        self.runs = runs

    @property
    def top(self):
        return min(w.bbox[1] for w in self.words)

    @property
    def bottom(self):
        return max(w.bbox[3] for w in self.words)


def group_lines(words):
    """Words on one baseline form a line; a line half a row off the others (a label centred beside several rows)
    is a line of its own."""
    lines, cur = [], []
    for w in sorted(words, key=lambda w: (w.base, w.bbox[0])):
        if cur and abs(median(c.base for c in cur) - w.base) > 0.45 * max(w.size, max(c.size for c in cur)):
            lines.append(Line(cur))
            cur = []
        cur.append(w)
    if cur:
        lines.append(Line(cur))
    return lines


# ---------------------------------------------------------------------------- numbers and header hints

_MARKS = r"(?:\^?[*†‡§¶∗⋆]+|\^[a-z])?"
_CORE = r"(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|\.\d+)"
_POWER = r"(?:\s*[×x·⋅*]\s*10\s*\^?\s*[-−+]?\d+)"
NUMBER_RE = re.compile(
    r"^(?P<approx>[≈~∼≃]\s*)?(?P<cur>[$€£¥])?(?P<sign>[-−–+])?\s?(?P<num>" + _CORE + r")"
    r"(?P<exp>(?:[eE][-−+]?\d+)|" + _POWER + r")?(?P<suffix>%|°C?|\s?[kKMBG](?![A-Za-z]))?" + _MARKS + r"$")
PLUS_MINUS_RE = re.compile(r"^(?P<mean>[-−–+]?\d[\d.,]*)\s*[±]\s*\d[\d.,]*(?:\s*\([^)]*\))?" + _MARKS + r"$")
SUFFIX = {"k": 1e3, "K": 1e3, "M": 1e6, "B": 1e9, "G": 1e9}


def _decimal(num):
    """"1,024" is 1024, "0,5" and "12,5" are decimals, "3.14" is itself."""
    if re.fullmatch(r"[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?", num):
        return float(num.replace(",", ""))
    return float(num.replace(",", "."))


def parse_number(text):
    """The number a cell holds, or None when it is anything else (a range, an inequality, a word, a fraction)."""
    t = " ".join(text.replace(" ", " ").split())
    m = PLUS_MINUS_RE.match(t)
    if m:
        t = m.group("mean")
    m = NUMBER_RE.match(t)
    if not m:
        return None
    try:
        value = _decimal(m.group("num"))
    except ValueError:
        return None
    exp = (m.group("exp") or "").strip()
    if exp:
        power = re.search(r"[-−+]?\d+$", exp).group(0).replace("−", "-")
        value = float(f"{value}e{power}")
    suffix = (m.group("suffix") or "").strip()
    if suffix in SUFFIX:
        value *= SUFFIX[suffix]
    if m.group("sign") in ("-", "−", "–"):
        value = -value
    return value if math.isfinite(value) else None


ARROWS_UP, ARROWS_DOWN = "↑⬆▲⇧", "↓⬇▼⇩"
UP_RE = re.compile(r"\b(?:higher|larger|bigger|greater|more)\b[^.;,]{0,16}\bbetter\b|\bthe (?:higher|larger) the better\b", re.I)
DOWN_RE = re.compile(r"\b(?:lower|smaller|fewer|less)\b[^.;,]{0,16}\bbetter\b|\bthe (?:lower|smaller) the better\b", re.I)
UNITS = {"ms", "s", "us", "µs", "ns", "min", "h", "d", "hz", "khz", "mhz", "ghz", "kg", "g", "mg", "m", "cm", "mm",
         "km", "n", "j", "w", "v", "a", "k", "mol", "rad", "deg", "px", "kb", "mb", "gb", "tb", "fps", "bpm", "%"}
UNIT_RE = re.compile(r"[\[(]\s*([^\])]{1,14}?)\s*[\])]")
SCALE_RE = re.compile(r"[×x]\s*10\s*\^?\s*\{?[-−+]?\d+\}?")


def header_hints(name):
    """(clean name, unit, better) for a column header: arrows and "higher is better" give the direction, a bracket
    holding a unit or a scale ("(ms)", "[N/m]", "x10^6") gives the unit. The name loses what moved elsewhere."""
    better = None
    if any(a in name for a in ARROWS_UP) or UP_RE.search(name):
        better = "up"
    elif any(a in name for a in ARROWS_DOWN) or DOWN_RE.search(name):
        better = "down"
    clean = re.sub(r"[%s%s]" % (ARROWS_UP, ARROWS_DOWN), "", name)
    clean = re.sub(r"[\[(]\s*(?:the )?(?:higher|lower|larger|smaller)\b[^\])]*[\])]", "", clean, flags=re.I)
    clean = UP_RE.sub("", DOWN_RE.sub("", clean))
    unit = None
    for m in UNIT_RE.finditer(clean):
        inner = m.group(1)
        if m.group(0)[0] == "[" or inner.lower() in UNITS or re.search(r"[/·^%°]", inner):
            unit = inner
    if unit is None:
        scale = SCALE_RE.search(clean)
        unit = re.sub(r"\s+", "", scale.group(0)).replace("x", "×") if scale else ("%" if clean.endswith("%") else None)
    return " ".join(clean.split()), unit, better


# ---------------------------------------------------------------------------- the grid

class Item:
    """One body line, as the grid sees it."""
    __slots__ = ("kind", "line", "text", "band", "title", "cells", "spans", "label", "group", "note")

    def __init__(self, kind, line):
        self.kind, self.line = kind, line
        self.text = line.runs[0].text if kind in ("banner", "lone") else ""
        self.band = 0             # the rule band the line sits in
        self.title = ""           # the banner above it
        self.cells = []           # per column: the runs that fall in it
        self.spans = []           # (run, columns) for runs that overlap several columns
        self.label, self.group, self.note = "", "", ""


def _overlap(run, band):
    return min(run.x1, band[1]) - max(run.x0, band[0])


def _is_number(text):
    return parse_number(text) is not None


def _rule_ys(rules, box):
    """y of the rules inside the table that run across at least 40% of its width (not its top and bottom edge)."""
    ys = sorted((r[1] + r[3]) / 2 for r in rules if r[3] - r[1] <= 2.5 and r[2] - r[0] >= 0.4 * (box[2] - box[0]))
    edge = 0.06 * (box[3] - box[1]) + 3
    return [y for y in ys if box[1] + edge < y < box[3] - edge]


def _short_rules(rules, box):
    """(x0, x1, y) of the short rules: the ones printed under a header cell to show which columns it spans."""
    return [(r[0], r[2], (r[1] + r[3]) / 2) for r in rules if r[3] - r[1] <= 2.5 and 15 <= r[2] - r[0] < 0.4 * (box[2] - box[0])]


def _header_count(lines, inner):
    """How many lines at the top are the header, and whether a rule says so. A rule under the first lines ends the
    header; without one, the header ends before the first line with a number in it."""
    if inner:
        n = sum(1 for ln in lines if (ln.top + ln.bottom) / 2 < inner[0])
        if 1 <= n <= 4:
            return n, True
    for k in range(1, min(len(lines), 5)):
        if sum(_is_number(r.text) for r in lines[k].runs[1:]) >= 1:
            return k, False
    return 1, False


def _classify(lines, box, header_texts):
    """Body lines as items: a banner (one wide run of text: a title or a note), a repeated header, a lone label (one
    narrow run of text) or a data line."""
    items = []
    for ln in lines:
        texts = [r.text for r in ln.runs]
        if len(texts) == 1 and not _is_number(texts[0]):
            kind = "banner" if ln.runs[0].x1 - ln.runs[0].x0 >= 0.4 * (box[2] - box[0]) else "lone"
        elif len(texts) >= 2 and sum(t in header_texts for t in texts) >= max(2, 0.6 * len(texts)):
            kind = "header"
        else:
            kind = "data"
        items.append(Item(kind, ln))
    return items


def _bands(lines):
    """Column bands from the rows with the most cells. A run that overlaps two bands is a cell spanning both, so it
    never widens one."""
    bands = []
    for ln in sorted(lines, key=lambda ln: -len(ln.runs)):
        for run in ln.runs:
            if not any(_overlap(run, b) > 0 for b in bands):
                bands.append([run.x0, run.x1])
    return sorted(bands)


def _assign(runs, bands, off=None):
    """The bands each run overlaps (indexes). A run outside every band, centred in the gap between two, is a cell
    over both; anywhere else it joins the nearest, and its text goes to `off` (a list), since that is a guess."""
    out = []
    for run in runs:
        hits = [i for i, b in enumerate(bands) if _overlap(run, b) > 0]
        if not hits:
            left = max((i for i, b in enumerate(bands) if b[1] <= run.x0), default=None)
            right = min((i for i, b in enumerate(bands) if b[0] >= run.x1), default=None)
            if left is not None and right is not None:
                before, after = run.x0 - bands[left][1], bands[right][0] - run.x1
                if min(before, after) >= 0.3 * (before + after):
                    hits = [left, right]
            if not hits:
                hits = [min(range(len(bands)), key=lambda i: min(abs(run.x0 - bands[i][1]), abs(run.x1 - bands[i][0])))]
                if off is not None:
                    off.append(run.text)
        out.append(hits)
    return out


def _fill(items, bands, flags):
    """Put each data line's runs into the columns they overlap; runs over several columns wait."""
    for it in items:
        it.cells = [[] for _ in bands]
        off = []
        for run, hits in zip(it.line.runs, _assign(it.line.runs, bands, off)):
            if len(hits) == 1:
                it.cells[hits[0]].append(run)
            else:
                it.spans.append((run, hits))
        if off:
            flags.add("cell between columns")


def _cell_text(runs):
    text = " ".join(r.text for r in sorted(runs, key=lambda r: r.x0))
    return re.sub(r"\s*[·⋅]\s*(?=10\^)", " × ", " ".join(text.split()))


def _number_columns(items, n):
    """The columns that hold numbers: at least two cells, and most of the filled ones parse."""
    out = []
    for j in range(n):
        texts = [_cell_text(it.cells[j]) for it in items if it.cells[j]]
        out.append(sum(_is_number(t) for t in texts) >= max(2, 0.6 * len(texts)))
    return out


def _resolve_spans(items, numeric, flags):
    """A number across several columns is one merged cell, shown in each; text across several columns is the
    overflow of a label (it belongs to the first column) or a remark on the row."""
    for it in items:
        for run, hits in it.spans:
            if _is_number(run.text):
                flags.add("merged cells")
                for j in hits:
                    it.cells[j].append(run)
            elif not numeric[hits[0]]:
                it.cells[hits[0]].append(run)
            else:
                it.note = (it.note + " " + run.text).strip()


def _header_names(header, bands, short):
    """The name of each column: the header runs above it, top line first. A header over several columns is part of
    each name; a short rule printed under it shows how far it reaches."""
    parts = [[] for _ in bands]
    for ln in header:
        for run in ln.runs:
            x0, x1 = run.x0, run.x1
            for left, right, y in short:
                if ln.bottom <= y <= ln.bottom + ln.size and min(x1, right) - max(x0, left) >= 0.5 * (x1 - x0):
                    x0, x1 = min(x0, left), max(x1, right)
            for j in _assign([SimpleNamespace(x0=x0, x1=x1)], bands)[0]:
                parts[j].append(run.text)
    return [" ".join(p) for p in parts]


def _groups(items, ruled):
    """Row labels and groups. Between two rules, one label for several rows (set beside the middle row, or on a line
    of its own) names the whole group. Elsewhere a label on its own line heads the rows after it, or continues the
    label above when it starts in lower case."""
    bands = {}
    for it in items:
        if it.kind in ("data", "lone"):
            bands.setdefault(it.band, []).append(it)
    for band in bands.values():
        data = [it for it in band if it.kind == "data"]
        named = [it for it in band if it.kind == "lone" or it.label]
        if ruled and len(data) >= 2 and len(named) == 1:
            name = named[0].text if named[0].kind == "lone" else named[0].label
            for it in data:
                it.group, it.label = name, ""
            continue
        lone = [it for it in band if it.kind == "lone"]
        if len(data) == 1 and not data[0].label and len(lone) == 1:
            data[0].label = lone[0].text
            continue
        group, last = "", None
        for it in band:
            if it.kind == "lone":
                if last is not None and it.text[:1].islower() and last.label:
                    last.label = last.label[:-1] + it.text if last.label.endswith("-") else f"{last.label} {it.text}"
                else:
                    group = it.text
            else:
                it.group, last = group, it


def _columns(names, texts, first):
    """The typed columns, from their header texts and the cell texts of every row."""
    columns = []
    for j in range(first, len(names)):
        values = [parse_number(row[j]) for row in texts]
        filled = [row[j] for row in texts if row[j]]
        number = sum(v is not None for v in values) >= max(2, 0.6 * len(filled))
        name, unit, better = header_hints(names[j])
        if number and unit is None and all(t.endswith("%") for t, v in zip(filled, values) if v is not None):
            unit = "%"
        col = {"name": name or f"Column {j + 1}", "kind": "number" if number else "text"}
        if unit:
            col["unit"] = unit
        if better:
            col["better"] = better
        columns.append(col)
    seen = {}                                  # equal names get a number, so a column can be told by its name
    for col in columns:
        seen[col["name"]] = seen.get(col["name"], 0) + 1
        if seen[col["name"]] > 1:
            col["name"] += f" ({seen[col['name']]})"
    return columns


def _grid(method, flags, label_header, columns, rows, notes):
    """The grid as doc.json holds it; rows are (label, group, note, cell texts without the label column)."""
    grid = {"confidence": "medium" if flags else "high", "method": method}
    if label_header:
        grid["label_header"] = header_hints(label_header)[0]
    out = []
    for label, group, note, texts in rows:
        row = {"label": label}
        if group:
            row["group"] = group
        if note:
            row["note"] = note
        row["cells"] = [{"text": t, **({"value": v} if (v := parse_number(t)) is not None else {})} for t in texts]
        out.append(row)
    grid.update(columns=columns, rows=out)
    if notes:
        grid["notes"] = notes
    return grid


def _only_one_line_rows(columns, filled):
    """Without a number to hold on to, a wrapped cell would read as a row of its own: only a table whose every row
    fills at least two cells, none of them starting in lower case, is read."""
    return any(c["kind"] == "number" for c in columns) or all(
        len(cells) >= 2 and not cells[0][:1].islower() for cells in filled)


def _no(why, reason):
    """No grid; the reason goes to the caller's list when it keeps one."""
    if why is not None:
        why.append(reason)


def _numeric_header(header):
    """A header whose cells are numbers (other than years) is a row of data: the real header is not in the box."""
    texts = [r.text for ln in header for r in ln.runs[1:]]
    return sum(_is_number(t) and not re.fullmatch(r"(?:19|20)\d\d", t) for t in texts) >= max(2, 0.5 * len(texts))


def span_grid(page, bbox, rules, why=None):
    """The grid read from the words inside bbox, or None when the reading would be a guess (the reason is added to
    why, if given)."""
    box = tuple(bbox)
    lines = group_lines(read_words(page, box))
    if len(lines) < 3:
        return _no(why, "fewer than three lines")
    inner = _rule_ys(rules, box)
    n, ruled = _header_count(lines, inner)
    header = lines[:n]
    if _numeric_header(header):
        return _no(why, "the header is made of numbers")
    items = _classify(lines[n:], box, {r.text for ln in header for r in ln.runs})
    flags = set() if ruled else {"header inferred"}
    segments, cur = [], []                     # a repeated header starts a table of its own
    for it in items:
        it.band = sum(1 for y in inner if y < (it.line.top + it.line.bottom) / 2)
        if it.kind == "header":
            segments.append(cur)
            cur = []
        else:
            cur.append(it)
    segments.append(cur)
    data, bands = [], None
    for seg in segments:
        rows = [it for it in seg if it.kind == "data"]
        found = _bands([it.line for it in rows if len(it.line.runs) >= 2])
        if not 2 <= len(found) <= MAX_COLUMNS + 1 or (bands is not None and len(found) != len(bands)):
            return _no(why, f"{len(found)} columns found")
        _fill(rows, found, flags)
        data.extend(rows)
        bands = bands or found
        names = _header_names(header, bands, _short_rules(rules, box)) if bands is found else names
    if not all(names[1:]) or not 2 <= len(data) <= MAX_ROWS:
        return _no(why, "a column has no header" if not all(names[1:]) else f"{len(data)} rows")
    numeric = _number_columns(data, len(bands))
    _resolve_spans(data, numeric, flags)
    last = max(it.line.base for it in data)
    title, notes = "", []
    for it in items:                           # a banner heads the rows after it, or is a note below the last row
        if it.kind == "banner" and it.line.base > last:
            notes.append(it.text)
        elif it.kind == "banner":
            title = it.text
        elif it.kind in ("data", "lone"):
            it.title = title
    label_col = not numeric[0]
    for it in data:
        it.label = _cell_text(it.cells[0]) if label_col else ""
    _groups(items, len({it.band for it in data}) >= 2)
    first = 1 if label_col else 0
    texts = [[_cell_text(c) for c in it.cells] for it in data]
    columns = _columns(names, texts, first)
    if not _only_one_line_rows(columns, [[t for t in row if t] for row in texts]):
        return _no(why, "a text table with cells that may wrap")
    rows = [(it.label, " / ".join(g for g in (it.title, it.group) if g), it.note, row[first:])
            for it, row in zip(data, texts)]
    return _grid("spans", flags, names[0] if label_col else "", columns, rows, notes)


def _cell_words(page, rect):
    """The text of one table cell, scripts marked, read again from the page."""
    return " ".join(" ".join(w.text for w in ln.words) for ln in group_lines(read_words(page, rect)))


def finder_grid(page, bbox):
    """A fully ruled table through PyMuPDF's table finder: it gives the cells, and their text is read again so that
    scripts and minus signs survive. A cell that stretches over several rows names them as a group, and one over
    several header columns names each. None unless the finder found one table that fills the box."""
    box = pymupdf.Rect(bbox)
    found = page.find_tables(clip=box, strategy="lines").tables
    if len(found) != 1:
        return None
    table = found[0]
    if (pymupdf.Rect(table.bbox) & box).get_area() < 0.85 * box.get_area() or table.row_count < 3 or table.col_count < 2:
        return None
    rows = [([None if c is None else _cell_words(page, c) for c in r.cells], r.cells, r.bbox) for r in table.rows]
    texts = [t for t, _, _ in rows]
    n = next((k for k in range(1, min(len(rows), 5)) if any(_is_number(t or "") for t in texts[k][1:])), 1)
    names = [""] * table.col_count
    for row in texts[:n]:
        last = ""
        for j, t in enumerate(row):
            last = t if t is not None else last      # a header over several columns belongs to each
            names[j] = f"{names[j]} {last}".strip()
    body = [r for r in rows[n:] if any(r[0])]
    if len(body) < 2 or not all(names[1:]):
        return None
    cells = [[t or "" for t in r[0]] for r in body]
    label_col = sum(_is_number(r[0]) for r in cells) < 0.3 * len(cells)
    first = 1 if label_col else 0
    columns = _columns(names, cells, first)
    if not _only_one_line_rows(columns, [[t for t in r if t] for r in cells]):
        return None
    out, group = [], ""
    for (_, rects, bb), row in zip(body, cells):
        label = row[0] if label_col else ""
        if label and rects[0] is not None:
            tall = rects[0][3] > bb[3] + 2
            group, label = (label, "") if tall else ("", label)
        elif label_col:
            label = ""
        out.append((label, group if label_col else "", "", row[first:]))
    merged = any(c is None for _, rects, _ in rows[n:] for c in rects)
    return _grid("finder", {"merged cells"} if merged else set(), names[0] if label_col else "", columns, out, [])


def read_grid(page, bbox, rules=(), why=None):
    """The typed grid of the table inside bbox on a PyMuPDF page, or None; why (a list) collects the reasons."""
    return finder_grid(page, bbox) or span_grid(page, bbox, rules, why)
