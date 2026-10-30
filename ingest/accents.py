"""Split accents: composing a spacing diacritic with its letter.

LaTeX and some office tools store "ö" as a spacing diaeresis plus a letter, so the text reads "L¨ose" (the accent
first, as TeX sets it) or "Mu¨ller" (the letter first, as some Mac tools do). The accents ¨ ´ ` ˆ ˜ ¸ ˇ and their
combining forms are composed with the neighbouring letter into the precomposed character, for every language that has
one. Whether a document puts the accent before or after its letter is read from the accents that only fit one
neighbour ("fu¨r": r takes no diaeresis, so the accent belongs to the u).
"""

import unicodedata

# spacing accent -> combining accent
SPACING = {"¨": "̈", "´": "́", "`": "̀", "ˆ": "̂", "˜": "̃", "¸": "̧", "ˇ": "̌"}
COMBINING = frozenset(SPACING.values())
ACCENTS = frozenset(SPACING) | COMBINING
DOTLESS = {"ı": "i", "ȷ": "j"}                 # TeX sets "í" as an acute over a dotless i
# An acute or a grave after a consonant is mostly an apostrophe ("don´t"), so after the letter they only fit a vowel
VOWELS = frozenset("aeiouyAEIOUY")
APOSTROPHE = frozenset("´`")
CONTRACTIONS = frozenset({"s", "t", "d", "m", "ll", "re", "ve"})     # "I´ll", "you´ve": never an accent on the vowel


def _compose(letter, accent):
    """The single character the letter and the accent make, or None when there is none."""
    joined = unicodedata.normalize("NFC", DOTLESS.get(letter, letter) + SPACING.get(accent, accent))
    return joined if len(joined) == 1 else None


def _contraction(texts, i):
    """Whether the letters after the accent at i are a contraction ending: "you´ve", "I´ll"."""
    rest = ""
    for t in texts[i + 1:]:
        if not t.isalpha():
            break
        rest += t
    return rest.lower() in CONTRACTIONS


def _candidates(texts, i, skip):
    """The character the accent at i makes with the letter after it, and with the letter before it; None where that
    neighbour is no letter, takes no such accent or is left alone (skip tells by index)."""
    if skip is not None and skip(i):
        return None, None

    def with_letter(j):
        if not 0 <= j < len(texts) or len(texts[j]) != 1 or not texts[j].isalpha() or (skip is not None and skip(j)):
            return None
        return _compose(texts[j], texts[i])

    before, after = with_letter(i + 1), with_letter(i - 1)
    if after and texts[i] in APOSTROPHE and (texts[i - 1] not in VOWELS or _contraction(texts, i)):
        after = None
    return before, after


def accent_order(sequences):
    """"before" when more of the accents that fit only one neighbour sit before their letter than after it, else
    "after"; "before" without evidence, which is how TeX sets them. A sequence is (texts, skip): a list of one-character
    strings and a function of an index (or None) that names the characters to leave alone."""
    votes = {"before": 0, "after": 0}
    for texts, skip in sequences:
        for i, text in enumerate(texts):
            if text in ACCENTS and text not in COMBINING:
                before, after = _candidates(texts, i, skip)
                if before and not after:
                    votes["before"] += 1
                elif after and not before:
                    votes["after"] += 1
    return "after" if votes["after"] > votes["before"] else "before"


def pairs(texts, order="before", skip=None):
    """The accents of a sequence of one-character strings and the letters they join: [(accent index, letter index,
    composed character)] in reading order. A spacing accent joins the letter on the side the document sets it (so a
    backtick closing a quotation stays one); a combining accent follows its letter, or precedes it when no letter
    comes before. Nothing is joined twice."""
    out, used = [], set()
    for i, text in enumerate(texts):
        if text not in ACCENTS or i in used:
            continue
        before, after = _candidates(texts, i, skip)
        before_free = before is not None and i + 1 not in used
        after_free = after is not None and i - 1 not in used
        if text in COMBINING:
            take_after, joins = after_free, after_free or before_free
        else:
            take_after = order == "after"
            joins = after_free if take_after else before_free
        if not joins:
            continue
        letter = i - 1 if take_after else i + 1
        out.append((i, letter, after if take_after else before))
        used.update((i, letter))
    return out


def has_accent(texts):
    return any(t in ACCENTS for t in texts)


def compose_chars(chars, order="before", skip=None):
    """The chars of a line, (text, bbox, ...) tuples, with each accent joined to its letter: one char with the letter's
    font, size and baseline, the composed text and a box around both. skip(char) leaves a char alone (math)."""
    texts = [c[0] for c in chars]
    if not has_accent(texts):
        return chars
    found = pairs(texts, order, (lambda j: skip(chars[j])) if skip else None)
    if not found:
        return chars
    merged = {}
    for accent, letter, composed in found:
        a, b = chars[accent][1], chars[letter][1]
        merged[letter] = (composed, (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))) + tuple(
            chars[letter][2:])
    gone = {accent for accent, _, _ in found}
    return [merged.get(i, c) for i, c in enumerate(chars) if i not in gone]


def compose_text(text, order="before"):
    """A string with its accents joined to their letters."""
    texts = list(text)
    if not has_accent(texts):
        return text
    found = pairs(texts, order)
    letters = {letter: composed for _, letter, composed in found}
    gone = {accent for accent, _, _ in found}
    return "".join(letters.get(i, t) for i, t in enumerate(texts) if i not in gone)
