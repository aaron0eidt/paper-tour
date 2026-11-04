#!/usr/bin/env python3
"""Checks the lines of a worked solution, as the tutor writes them on the side board.

    echo '{"lines": ["3x - 7 = 2x + 5", "x - 7 = 5", "x = 12"]}' | python verify_math.py
    -> {"lines": [{"status": "ok"}, {"status": "ok"}, {"status": "ok"}]}

Each line is LaTeX: one or more relations (=, <, \\le, \\approx ...) joined by commas, \\quad, "and", "or" or
\\Rightarrow. A line is "ok" when every relation in it checks out, "failed" when one is wrong (with the reason),
and "unknown" when something cannot be checked; the tutor then marks the step as unverified rather than guessing.

The checks are numeric, so they need no computer algebra system:
  - a relation without unknowns is evaluated ("1 \\cdot 4 - 2 \\cdot 3 = -2"); a side printed as a rounded decimal
    may differ by the rounding;
  - a relation that holds at several random points is an identity ("(x-1)(x+1) = x^2 - 1");
  - assignments anywhere in the solution ("x = 12", "x_1 = 2, x_2 = 3", "x = 1 \\pm 2") give candidate values,
    and every other equation must hold for all of them (or, in a line joined by "or", one relation must); one
    that holds for some of them only is unknown, since the values may belong to different cases;
  - "A = \\begin{pmatrix}...\\end{pmatrix}" and "f(x) = ..." define a matrix and a function for later lines;
    f'(x) and f''(x) are checked by finite differences;
  - P(...), E[...], Var(...) and the like are names of values ("P(\\text{blue}) = 0.99 \\cdot 0.01 = 0.0099"): the
    arithmetic of the chain is checked, and a name with just a value is a claim that nothing else in the solution
    uses, which stays "unknown";
  - "\\approx" accepts a value rounded to the places it prints ("\\sqrt{10} \\approx 3", "\\frac13 \\approx 33\\%"), or
    within a percent where it prints none; a word set in \\text before a relation names a value ("\\text{Fläche} =
    3 \\cdot 4 = 12"), and after a value it is a note ("0.5 \\text{ probability}");
  - values of atomic scale (6.626 \\times 10^{-34}, 1.2e-12) are told apart by their ratio, as a fixed margin would
    call any two of them equal;
  - a name whose value was printed rounded ("n = 4.0/2.02 = 1.98 mol") is used by the lines after it as computed or as
    printed; a relation that uses such a name and misses by less than half a percent is "unknown", not "failed";
  - a unit after a value ("4.0\\,\\mathrm{g}", "\\mathrm{g\\,mol^{-1}}", "\\text{ mol}", "\\Omega",
    "^\\circ\\mathrm{C}") makes it a quantity in SI: base units m, kg, s, A, K, mol, cd, prefixes (p n µ m c d k M
    G; "m" and "M" are told apart by what follows: "mM" is millimolar, "MPa" mega, "M\\Omega" mega-ohm, a lone "M" is
    mol/L) and g, L, N, J, W, Pa, bar, atm, Torr, mmHg, Hz, C, V, \\Omega, F, eV, cal, min, h. Two sides that both
    carry units must agree in dimension ("units do not match: g vs mol") and, converted, in value
    ("0.5\\,\\mathrm{L} = 500\\,\\mathrm{mL}"); a unit may sit inside an expression
    ("\\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}"), and a name given a value with a
    unit keeps it. A side without a unit against one with a unit compares the numbers only ("n = 4.0/2.016 = 1.98
    mol"); a step that changes the unit on the way ("\\frac{0.5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = \\frac{0.5}{0.25} =
    2\\,\\mathrm{mol/L}") is compared once the unit sides are in the unit of the result. A rounding is read in the
    unit it is printed in; a whole number with a unit and three digits (4326 J) is rounded to its last digit. 25 °C
    is a point on a scale: it equals 298.15 K (or 298 K), but in a product (4.18 J/(g °C) \\cdot 20 °C) °C is a size,
    as K, and only a unit per °C cancels it: an absolute °C in any other product (n R T with T in °C) is not
    concluded from. A unit this checker does not know, one that leaves it unclear what a "/" divides ("J/mol K",
    "ms^{-2}"), a factor left without its unit where the units do not fit ("2.00 \\cdot 56\\,g/mol = 112\\,g"), and a
    note set against a unit are "unknown", never "failed". Currency and count words (EUR, €, Stück) are notes;
  - scientific notation as it is typed ("1.2 \\times 10^{-3}", "1.2\\cdot10^{-3}", "1.2e-3", "6.022 \\times
    10^{23}"): the places of the mantissa are the rounding;
  - a reaction in \\ce{...} (mhchem), "\\ce{2H2 + O2 -> 2H2O}" or "\\ce{2H2} \\rightarrow \\ce{2H2O}", is "ok" when
    atoms and charge balance on both sides of the arrow and "failed" with the difference otherwise ("O: 2 on the
    left, 1 on the right"). Arrows ->, <=>, <->, =, \\rightarrow, \\rightleftharpoons; coefficients like 2, 0.5,
    1/2; brackets, hydrates (CuSO4.5H2O), charges (Fe^{3+}, SO4^2-, OH-), electrons (e^-), states (aq) (s) (l) (g)
    also after a charge (Ag+(aq)), and "heat" or "hν" beside or on the arrow. Two reactions on one line
    (\\qquad between them) are checked one by one. An equation that is not balanced yet, followed by another one
    over the same species (balancing step by step), is "unknown"; only the last of them can be "failed". A species it
    cannot read (an unknown element, an isotope, "R") makes the line "unknown". The molar mass M(\\ce{H2O}) (also
    \\text{M}, M_{\\ce{H2O}}) is compared with the IUPAC standard atomic weights of elements 1-92 within 0.5 % or the
    rounding it prints ("M(H2) = 2.0 g/mol"), and a wrong value is "failed" with the computed one. Anywhere else
    \\ce{X} is a name, as P(A) is;
  - the check of a result ("5 \\cdot 3 + 2 = 17 \\;\\checkmark", "\\text{Probe: } ...", a \\Rightarrow chain) is
    evaluated: the \\checkmark, a heading that only announces ("\\text{Probe: }", "Gegeben:", "Schritt 2:") and a
    verdict ("\\text{wahr}") are not part of the maths. Another heading ("\\text{Falsch: } ...") may mean a wrong line
    on purpose and leaves it "unknown".
Anything else (sums, integrals, limits, other words) is "unknown". Exit status 0 with JSON on stdout, also for bad
input.
"""

import cmath
import functools
import itertools
import json
import math
import re
import sys
from fractions import Fraction

# ---------------------------------------------------------------------------- values

class Matrix:
    def __init__(self, rows):
        self.rows = [list(r) for r in rows]
        self.shape = (len(self.rows), len(self.rows[0]) if self.rows else 0)

    def map(self, fn):
        return Matrix([[fn(v) for v in r] for r in self.rows])

    def zip(self, other, fn):
        if self.shape != other.shape:
            raise Unsupported("matrix sizes differ")
        return Matrix([[fn(a, b) for a, b in zip(r, s)] for r, s in zip(self.rows, other.rows)])

    def matmul(self, other):
        if self.shape[1] != other.shape[0]:
            raise Unsupported("matrix sizes do not fit")
        cols = list(zip(*other.rows))
        return Matrix([[sum(a * b for a, b in zip(r, c)) for c in cols] for r in self.rows])

    def transpose(self):
        return Matrix(list(zip(*self.rows)))

    def det(self):
        n, m = self.shape
        if n != m or n == 0:
            raise Unsupported("determinant of a matrix that is not square")
        a = [r[:] for r in self.rows]
        total = 1
        for i in range(n):
            pivot = max(range(i, n), key=lambda k: abs(a[k][i]))
            if abs(a[pivot][i]) < 1e-12:
                return 0
            if pivot != i:
                a[i], a[pivot] = a[pivot], a[i]
                total = -total
            total *= a[i][i]
            for k in range(i + 1, n):
                f = a[k][i] / a[i][i]
                a[k] = [x - f * y for x, y in zip(a[k], a[i])]
        return total

    def inverse(self):
        n, m = self.shape
        if n != m:
            raise Unsupported("inverse of a matrix that is not square")
        a = [r[:] + [1 if i == j else 0 for j in range(n)] for i, r in enumerate(self.rows)]
        for i in range(n):
            pivot = max(range(i, n), key=lambda k: abs(a[k][i]))
            if abs(a[pivot][i]) < 1e-12:
                raise ZeroDivisionError("singular matrix")
            a[i], a[pivot] = a[pivot], a[i]
            a[i] = [x / a[i][i] for x in a[i]]
            for k in range(n):
                if k != i:
                    a[k] = [x - a[k][i] * y for x, y in zip(a[k], a[i])]
        return Matrix([r[n:] for r in a])


class Unsupported(Exception):
    """Something the checker cannot evaluate; the relation is then unknown."""


class UnitMismatch(Unsupported):
    """Quantities of different kinds added; where it is caught on purpose, the line is wrong, elsewhere unknown."""


BASE_UNITS = ("m", "kg", "s", "A", "K", "mol", "cd")
NO_DIM = (0,) * len(BASE_UNITS)


class Qty:
    """A number with a unit, in SI: the value in base units and the exponents of m, kg, s, A, K, mol and cd. label is
    the unit as written while the value is a literal. celsius marks an absolute temperature on the Celsius scale; its
    value stays the number written, since 25 °C is not 25 K. c_exp is the power of °C the quantity carries (-1 for
    J/(g °C)) and pt says that an absolute °C was multiplied in and not cancelled by such a unit: it may have been a
    difference, or the gas-law mistake of using °C where kelvin is due, so nothing is concluded from it."""

    def __init__(self, value, dim, label=None, celsius=False, c_exp=0, pt=False):
        self.value, self.dim, self.label, self.celsius = complex(value), tuple(dim), label, celsius
        self.c_exp, self.pt = c_exp, pt and c_exp != 0


def dim_text(dim):
    """A dimension in base units: "kg·m/s^2", "1/s", "1" for none."""
    def part(names):
        return "·".join(n if e == 1 else f"{n}^{e}" for n, e in names)
    up = [(n, e) for n, e in zip(BASE_UNITS, dim) if e > 0]
    down = [(n, -e) for n, e in zip(BASE_UNITS, dim) if e < 0]
    top = part(up) or "1"
    if not down:
        return top
    return f"{top}/({part(down)})" if len(down) > 1 else f"{top}/{part(down)}"


def kind_of(q):
    return q.label or dim_text(q.dim)


def with_dim(value, dim, c_exp=0, pt=False):
    """A quantity, or a plain number once the units have cancelled."""
    if tuple(dim) == NO_DIM:
        if c_exp:
            raise Unsupported("a temperature in °C that does not cancel")
        return complex(value)
    return Qty(value, dim, None, False, c_exp, pt)


def qty_parts(v):
    if isinstance(v, Matrix):
        raise Unsupported("a matrix with a unit")
    return (v.value, v.dim) if isinstance(v, Qty) else (v, NO_DIM)


def qty_add(a, b, sign):
    if not (isinstance(a, Qty) and isinstance(b, Qty)):
        raise Unsupported("a quantity added to a plain number")
    if a.dim != b.dim:
        raise UnitMismatch(f"units do not match: {kind_of(a)} vs {kind_of(b)}")
    if a.c_exp != b.c_exp and (a.pt or b.pt):
        raise Unsupported("a temperature in °C used as a size")
    if a.celsius and b.celsius:
        if sign > 0:
            raise Unsupported("two temperatures added")
        return Qty(a.value - b.value, a.dim)                 # a difference of temperatures is in kelvin
    if b.celsius and sign < 0:
        raise Unsupported("a temperature taken from kelvin")
    return Qty(a.value + sign * b.value, a.dim, None, a.celsius or b.celsius, a.c_exp, a.pt or b.pt)


def qty_mul(a, b, sign=1):
    """a times b (or over b). An absolute temperature in °C used as a factor is a size there, as K, and only a unit
    per °C cancels it (4.18 J/(g °C) \\cdot 20 °C); left over, the result is marked (see Qty.pt)."""
    (x, dx), (y, dy) = qty_parts(a), qty_parts(b)
    c_exp, pt = 0, False
    for q, s in ((a, 1), (b, sign)):
        if isinstance(q, Qty):
            c_exp += s * (q.c_exp + (1 if q.celsius else 0))
            pt = pt or q.pt or q.celsius
    return with_dim(x * y if sign > 0 else x / y, [p + sign * q for p, q in zip(dx, dy)], c_exp, pt)


def add(a, b):
    if isinstance(a, Qty) or isinstance(b, Qty):
        return qty_add(a, b, 1)
    if isinstance(a, Matrix) and isinstance(b, Matrix):
        return a.zip(b, lambda x, y: x + y)
    if isinstance(a, Matrix) or isinstance(b, Matrix):
        raise Unsupported("a number plus a matrix")
    return a + b


def sub(a, b):
    if isinstance(a, Qty) or isinstance(b, Qty):
        return qty_add(a, b, -1)
    return add(a, neg(b))


def neg(a):
    if isinstance(a, Qty):
        return Qty(-a.value, a.dim, None, a.celsius, a.c_exp, a.pt)
    return a.map(lambda x: -x) if isinstance(a, Matrix) else -a


def mul(a, b):
    if isinstance(a, Qty) or isinstance(b, Qty):
        return qty_mul(a, b)
    if isinstance(a, Matrix) and isinstance(b, Matrix):
        return a.matmul(b)
    if isinstance(a, Matrix):
        return a.map(lambda x: x * b)
    if isinstance(b, Matrix):
        return b.map(lambda x: a * x)
    return a * b


def div(a, b):
    if isinstance(a, Qty) or isinstance(b, Qty):
        return qty_mul(a, b, -1)
    if isinstance(b, Matrix):
        raise Unsupported("division by a matrix")
    return a.map(lambda x: x / b) if isinstance(a, Matrix) else a / b


def power(a, b):
    if isinstance(b, Matrix):
        raise Unsupported("a matrix exponent")
    if isinstance(a, Qty) or isinstance(b, Qty):
        if isinstance(a, Matrix) or isinstance(b, Qty) or abs(b.imag) > 1e-12:
            raise Unsupported("a power with a unit in the exponent")
        dim = [d * b.real for d in a.dim]
        if any(abs(d - round(d)) > 1e-9 for d in dim) or abs(a.c_exp * b.real - round(a.c_exp * b.real)) > 1e-9:
            raise Unsupported("a fractional power of a unit")
        if a.celsius:
            raise Unsupported("a power of a temperature in °C")
        return with_dim(power(a.value, b), [int(round(d)) for d in dim], int(round(a.c_exp * b.real)), a.pt)
    if isinstance(a, Matrix):
        if b == -1:
            return a.inverse()
        k = int(round(b.real))
        if abs(b - k) > 1e-12 or k < 0:
            raise Unsupported("a matrix power")
        out = Matrix([[1 if i == j else 0 for j in range(a.shape[0])] for i in range(a.shape[0])])
        for _ in range(k):
            out = out.matmul(a)
        return out
    if a == 0 and b.real <= 0:
        raise ZeroDivisionError("0 to a power of 0 or less")
    if abs(b.imag) < 1e-15 and abs(b.real - round(b.real)) < 1e-12:
        return a ** int(round(b.real))         # exact for integer powers, also of negative numbers
    return a ** b


ATOMIC = 1e-6        # below this two values are told apart by their ratio: 1.2e-12 and 7.5e-12 are far apart


def tiny(a, b):
    """Whether both numbers are non-zero and of atomic scale, where a fixed margin would call anything equal."""
    return bool(a) and bool(b) and abs(a) < ATOMIC and abs(b) < ATOMIC


def close(a, b, rel=1e-7, absolute=1e-9):
    if isinstance(a, Qty) or isinstance(b, Qty):
        if not (isinstance(a, Qty) and isinstance(b, Qty)) or a.dim != b.dim or a.celsius != b.celsius \
                or (a.pt or b.pt) and a.c_exp != b.c_exp:
            return False
        return close(a.value, b.value, rel, 1e-30)           # sizes of units differ by many powers of ten
    if isinstance(a, Matrix) or isinstance(b, Matrix):
        if not (isinstance(a, Matrix) and isinstance(b, Matrix)) or a.shape != b.shape:
            return False
        return all(close(x, y, rel, absolute) for r, s in zip(a.rows, b.rows) for x, y in zip(r, s))
    if tiny(a, b):
        absolute = 0
    return abs(a - b) <= absolute + rel * max(abs(a), abs(b))


def show(v):
    if isinstance(v, Matrix):
        return "the matrix " + "; ".join(", ".join(show(x) for x in r) for r in v.rows)
    if isinstance(v, Qty):
        return f"{show(v.value)} {v.label or dim_text(v.dim)}"
    v = complex(v)
    if abs(v.imag) > 1e-9:
        return f"{v.real:.6g}{v.imag:+.6g}i"
    r = v.real
    if not math.isfinite(r):
        return str(r)
    return str(int(round(r))) if abs(r - round(r)) < 1e-9 and (r == 0 or abs(r) >= ATOMIC) else f"{r:.6g}"


# ---------------------------------------------------------------------------- units

class Unit:
    """A unit in SI terms: its factor to the base units, the exponents of m, kg, s, A, K, mol and cd, and its text.
    celsius marks °C on its own, which is a point on a scale and not only a size; c_exp is the power of °C inside a
    compound unit (-1 for J/(g °C))."""

    def __init__(self, scale, dim, label, celsius=False, c_exp=0):
        self.scale, self.dim, self.label, self.celsius, self.c_exp = float(scale), tuple(dim), label, celsius, c_exp

    def c_power(self):
        return self.c_exp + (1 if self.celsius else 0)

    def times(self, other, sign=1):
        return Unit(self.scale * other.scale ** sign, [a + sign * b for a, b in zip(self.dim, other.dim)], self.label,
                    False, self.c_power() + sign * other.c_power())

    def pow(self, k):
        return Unit(self.scale ** k, [a * k for a in self.dim], self.label, False, self.c_power() * k)


def dims(**exponents):
    return tuple(exponents.get(n, 0) for n in BASE_UNITS)


_J, _PA = dims(kg=1, m=2, s=-2), dims(kg=1, m=-1, s=-2)
# symbol -> (factor to SI, dimension, whether a prefix may stand before it). Symbols are case sensitive, as in SI.
UNITS = {
    "m": (1, dims(m=1), True), "g": (1e-3, dims(kg=1), True), "s": (1, dims(s=1), True), "A": (1, dims(A=1), True),
    "K": (1, dims(K=1), True), "mol": (1, dims(mol=1), True), "cd": (1, dims(cd=1), True),
    "L": (1e-3, dims(m=3), True), "l": (1e-3, dims(m=3), True), "N": (1, dims(kg=1, m=1, s=-2), True),
    "J": (1, _J, True), "W": (1, dims(kg=1, m=2, s=-3), True), "Pa": (1, _PA, True), "bar": (1e5, _PA, True),
    "atm": (101325, _PA, False), "Torr": (101325 / 760, _PA, False), "torr": (101325 / 760, _PA, False),
    "mmHg": (101325 / 760, _PA, False), "Hz": (1, dims(s=-1), True), "C": (1, dims(A=1, s=1), True),
    "V": (1, dims(kg=1, m=2, s=-3, A=-1), True), "Ω": (1, dims(kg=1, m=2, s=-3, A=-2), True),
    "F": (1, dims(A=2, s=4, kg=-1, m=-2), True), "eV": (1.602176634e-19, _J, True), "cal": (4.184, _J, True),
    "Wh": (3600, _J, True), "min": (60, dims(s=1), False), "h": (3600, dims(s=1), False),
    "M": (1000, dims(mol=1, m=-3), True), "t": (1000, dims(kg=1), False), "T": (1, dims(kg=1, s=-2, A=-1), True),
    "S": (1, dims(kg=-1, m=-2, s=3, A=2), True), "Å": (1e-10, dims(m=1), False), "rad": (1, NO_DIM, False),
    "Nm": (1, _J, False), "Pas": (1, dims(kg=1, m=-1, s=-1), False), "Js": (1, dims(kg=1, m=2, s=-1), False),
    "Ns": (1, dims(kg=1, m=1, s=-1), False),
}
PREFIXES = {"f": 1e-15, "p": 1e-12, "n": 1e-9, "µ": 1e-6, "u": 1e-6, "m": 1e-3, "c": 1e-2, "d": 1e-1, "h": 1e2,
            "k": 1e3, "M": 1e6, "G": 1e9}
CELSIUS = Unit(1, dims(K=1), "°C", True)


def attach(v, unit):
    """A value with the unit written after it: 4.0 g is 0.004 kg; 25 °C keeps its 25, as it is a point on a scale."""
    if isinstance(v, Matrix):
        raise Unsupported("a matrix with a unit")
    if isinstance(v, Qty):
        return qty_mul(v, Qty(unit.scale, unit.dim, None, unit.celsius, unit.c_exp))
    if unit.celsius:
        return Qty(v, unit.dim, unit.label, True)
    if unit.dim == NO_DIM:
        if unit.c_exp:
            raise Unsupported("°C against kelvin in one unit")
        return complex(v * unit.scale)
    return Qty(v * unit.scale, unit.dim, unit.label, False, unit.c_exp)


def unit_symbol(sym):
    """The Unit for one symbol: a whole symbol first ("m" is the metre, "M" molar, "min" minutes), else a prefix and
    a symbol that takes one ("mm", "mM" is millimolar, "MPa", "ms", "kcal")."""
    if sym == "°C":
        return CELSIUS
    if sym in UNITS:
        scale, dim, _ = UNITS[sym]
        return Unit(scale, dim, sym)
    if sym[:1] in PREFIXES and sym[1:] in UNITS and UNITS[sym[1:]][2]:
        scale, dim, _ = UNITS[sym[1:]]
        return Unit(PREFIXES[sym[0]] * scale, dim, sym)
    return None


def unit_source(text):
    """A written unit as plain text with one spelling: \\mathrm{g\\,mol^{-1}} -> "g mol^-1", \\mu\\mathrm{m} -> "µm"."""
    s = text.replace("\\ ", " ")
    for _ in range(3):
        s = re.sub(r"\\(?:mathrm|text|textrm|mbox|textnormal)\s*\{([^{}]*)\}", r"\1", s)
        s = re.sub(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", r"(\1)/(\2)", s)
    s = re.sub(r"\\mu(?![a-zA-Z])\s*", "µ", s).replace("\u03bc", "µ")
    s = re.sub(r"\\Omega(?![a-zA-Z])\s*", "Ω", s).replace("\u2126", "Ω")
    s = re.sub(r"\^\s*\{?\s*\\circ\s*\}?\s*|\\circ\s*", "°", s)
    s = s.replace("−", "-").replace("–", "-").replace("⁻¹", "^-1").replace("⁻²", "^-2").replace("⁻³", "^-3")
    s = s.replace("¹", "^1").replace("²", "^2").replace("³", "^3")
    s = re.sub(r"\^\s*\{\s*([+-]?\s*\d+)\s*\}", lambda m: "^" + m.group(1).replace(" ", ""), s)
    s = re.sub(r"\\[,;:! ]|~", " ", s)
    s = re.sub(r"\\cdot|\\times|[·⋅*]", "·", s)
    s = re.sub(r"[{}$]", "", s)
    return re.sub(r"\s+", " ", s).strip()


UNIT_PART = re.compile(r"\s*(?:\^\s*([+-]?\d+)|([/·])|([()])|([A-Za-zµΩÅ°]+?)(?:([2-4])(?!\d))?(?![A-Za-zµΩÅ°]))")


def unit_product(toks, i, depth):
    """The Unit of the product that starts at toks[i] and the index where it stops (at a closing bracket or the
    end). At most one factor may follow a "/" ("m/s^2" and "J/(mol K)" are clear, "J/mol K" is not)."""
    result, state = Unit(1, NO_DIM, ""), "mul"       # "divide": a divisor is due; "done": it has been taken
    while i < len(toks):
        kind = toks[i][0]
        if kind == ")":
            if depth == 0 or state == "divide":
                raise Unsupported("a bracket")
            break
        if state == "done":
            raise Unsupported("an unclear division")
        if kind in ("/", "·"):
            if state == "divide":
                raise Unsupported("an operator after a division")
            state = "divide" if kind == "/" else state
            i += 1
            continue
        factor, i = unit_factor(toks, i, depth)
        if state == "divide":
            result, state = result.times(factor, -1), "done"
        else:
            result = result.times(factor)
    if state == "divide":
        raise Unsupported("a division without a divisor")
    return result, i


def unit_factor(toks, i, depth):
    kind, value = toks[i]
    if kind == "(":
        inner, i = unit_product(toks, i + 1, depth + 1)
        if i >= len(toks) or toks[i][0] != ")":
            raise Unsupported("an unclosed bracket")
        i += 1
    elif kind == "sym":
        inner = unit_symbol(value[0])
        if inner is None:
            raise Unsupported(f"the unit {value[0]}")
        if value[1]:
            inner = inner.pow(int(value[1]))
        i += 1
    else:
        raise Unsupported("a unit expected")
    if i < len(toks) and toks[i][0] == "pow":
        if kind == "sym" and value[0] == "ms" and int(toks[i][1]) < 0:
            raise Unsupported("ms with a negative power may be m s^-1, not per millisecond")
        inner = inner.pow(int(toks[i][1]))
        i += 1
    return inner, i


@functools.lru_cache(maxsize=1024)
def parse_unit(text):
    """The Unit a written unit stands for (g/mol, kg\\,m^{-3}, \\mu mol, ^\\circ C, J/(mol\\,K)), or None when a part
    of it is not a unit we know or a "/" leaves it unclear what is divided."""
    s = unit_source(text)
    if not s:
        return None
    if s == "°C":
        return CELSIUS
    toks, pos = [], 0
    while pos < len(s):
        m = UNIT_PART.match(s, pos)
        if m is None or m.end() == pos:
            return None
        pos = m.end()
        power_, op, bracket, sym, digit = m.groups()
        if power_ is not None:
            toks.append(("pow", power_))
        elif op:
            toks.append((op, None))
        elif bracket:
            toks.append((bracket, None))
        else:
            toks.append(("sym", (sym, digit)))
    try:
        unit, end = unit_product(toks, 0, 0)
    except (Unsupported, ArithmeticError, ValueError):       # km^{999} is too large for a float
        return None
    if end != len(toks) or not 1e-300 < unit.scale < 1e300:
        return None
    return Unit(unit.scale, unit.dim, s, False, unit.c_exp)


# ---------------------------------------------------------------------------- chemistry

# IUPAC conventional standard atomic weights in g/mol, elements 1-92. Where an element has no stable isotope the mass
# number of its most stable one stands, as in the usual tables.
_WEIGHTS = """
H 1.008 He 4.0026 Li 6.94 Be 9.0122 B 10.81 C 12.011 N 14.007 O 15.999 F 18.998 Ne 20.180
Na 22.990 Mg 24.305 Al 26.982 Si 28.085 P 30.974 S 32.06 Cl 35.45 Ar 39.95 K 39.098 Ca 40.078
Sc 44.956 Ti 47.867 V 50.942 Cr 51.996 Mn 54.938 Fe 55.845 Co 58.933 Ni 58.693 Cu 63.546 Zn 65.38
Ga 69.723 Ge 72.630 As 74.922 Se 78.971 Br 79.904 Kr 83.798 Rb 85.468 Sr 87.62 Y 88.906 Zr 91.224
Nb 92.906 Mo 95.95 Tc 98 Ru 101.07 Rh 102.91 Pd 106.42 Ag 107.87 Cd 112.41 In 114.82 Sn 118.71
Sb 121.76 Te 127.60 I 126.90 Xe 131.29 Cs 132.91 Ba 137.33 La 138.91 Ce 140.12 Pr 140.91 Nd 144.24
Pm 145 Sm 150.36 Eu 151.96 Gd 157.25 Tb 158.93 Dy 162.50 Ho 164.93 Er 167.26 Tm 168.93 Yb 173.05
Lu 174.97 Hf 178.49 Ta 180.95 W 183.84 Re 186.21 Os 190.23 Ir 192.22 Pt 195.08 Au 196.97 Hg 200.59
Tl 204.38 Pb 207.2 Bi 208.98 Po 209 At 210 Rn 222 Fr 223 Ra 226 Ac 227 Th 232.04 Pa 231.04 U 238.03
""".split()
WEIGHTS = {s: float(w) for s, w in zip(_WEIGHTS[::2], _WEIGHTS[1::2])}
SYMBOLS = set(WEIGHTS) | set("Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split())
SPECTATORS = {"heat", "light", "energy", "hv", "h\\nu", "hν", "\\delta", "δ", "wärme", "hitze", "licht"}
ARROW_NOTES = SPECTATORS | {"", "uv", "cat", "cat.", "catalyst", "katalysator", "electrolysis", "elektrolyse"}
MOLAR_MASS = dims(kg=1, mol=-1)

# Arrows in mhchem (->, <=>, <->, a spaced =) and the commands for them. A note may follow: ->[heat], \xrightarrow{..}
ARROW = re.compile(
    r"<<=>|<=>>?|<-{1,2}>|<-{1,2}|-{1,2}>|(?<=\s)=(?=\s)|[→⟶⇌⇄↔⟷←]|"
    r"\\(?:longleftrightarrow|leftrightarrow|rightleftharpoons|leftrightharpoons|rightleftarrows|leftrightarrows|"
    r"longrightarrow|rightarrow|longleftarrow|leftarrow|to|xrightarrow|xleftarrow|xrightleftharpoons)(?![A-Za-z])")
ARROW_NOTE = re.compile(r"\[([^\[\]]*)\]")
ARROW_XNOTE = re.compile(r"\s*(?:\[([^\[\]]*)\])?\s*\{([^{}]*)\}")
CE_COMMAND = re.compile(r"\\ce\s*(?=\{)")
CHEM_HEAD = re.compile(r"\\(?:text|mathrm|textrm|mathbf)\s*\{\s*([A-Za-z]{1,2})\s*\}|"
                       r"(?<![\\a-zA-Z])([A-Za-z])(?![A-Za-z])")
COEFFICIENT = re.compile(r"\s*(?:\\[dt]?frac\s*\{(\d+)\}\s*\{(\d+)\}|\\[dt]?frac\s*(\d)(\d)|(\d+)\s*/\s*(\d+)|"
                         r"(\d+\.\d+)|(\d+))\s*")
STATE = re.compile(r"\s*(?:_?\{\(?(aq|s|l|g|cr)\)?\}|_?\((aq|s|l|g|cr)\))\s*$")
STATE_AT = re.compile(r"\((?:aq|s|l|g|cr)\)")
FORMULA_COUNT = re.compile(r"_\{(\d+)\}|_(\d+)|(\d+)")
REACTION_SKIP = re.compile(r"(?:\s|\\[,;:! ]|~|\\q?quad|\\checkmark|\\cmark|✓|✔)+")


class ChemUnknown(Exception):
    """A species or an arrow the checker cannot read; the reaction is then unknown."""


def chem_clean(text):
    s = text.replace("−", "-").replace("–", "-")
    s = re.sub(r"\\[,;:! ]|~", " ", s)
    s = re.sub(r"\\cdot|\\bullet|·|•", "*", s)
    s = re.sub(r"\\(?:mathrm|text|textrm)\s*\{([^{}]*)\}", r"\1", s).replace("$", "").replace("{}", "")
    return re.sub(r"\s+", " ", s).strip()


def formula_count(s, i):
    m = FORMULA_COUNT.match(s, i)
    return (int(m.group(1) or m.group(2) or m.group(3)), m.end()) if m else (1, i)


def formula_group(s, i, closer):
    """({element: count}, index) of a formula from s[i] to the closing bracket (left unconsumed) or the end."""
    atoms = {}
    while i < len(s):
        c = s[i]
        if c in ")]":
            if c != closer:
                raise ChemUnknown("a bracket that does not match")
            return atoms, i
        if c in "([":
            inner, i = formula_group(s, i + 1, ")" if c == "(" else "]")
            if i >= len(s):
                raise ChemUnknown("a bracket that is not closed")
            n, i = formula_count(s, i + 1)
            for el, k in inner.items():
                atoms[el] = atoms.get(el, 0) + k * n
        elif c.isupper():
            sym = s[i:i + 2] if s[i + 1:i + 2].islower() else c
            if sym not in SYMBOLS:
                raise ChemUnknown(f"{sym} is not an element")
            n, i = formula_count(s, i + len(sym))
            atoms[sym] = atoms.get(sym, 0) + n
        else:
            raise ChemUnknown(f"cannot read {c!r} in a formula")
    if closer is not None:
        raise ChemUnknown("a bracket that is not closed")
    return atoms, i


def charge_value(text):
    t = text.replace(" ", "")
    for pattern in (r"([+-])(\d+)", r"(\d+)([+-])"):
        m = re.fullmatch(pattern, t)
        if m:
            sign, digits = (m.group(1), m.group(2)) if m.group(1) in "+-" else (m.group(2), m.group(1))
            return int(digits) * (1 if sign == "+" else -1)
    if t and (set(t) == {"+"} or set(t) == {"-"}):
        return len(t) * (1 if t[0] == "+" else -1)
    raise ChemUnknown("a charge that cannot be read")


def split_charge(s):
    """(formula, charge): Fe^{3+}, SO4^2-, Na^+, OH-, [Fe(CN)6]^{3-}."""
    m = re.search(r"\^\s*\{\s*([^{}]*?)\s*\}\s*$", s) or re.search(r"\^\s*([+\-]?\d*[+\-]?)\s*$", s)
    if m:
        return s[:m.start()].rstrip(), charge_value(m.group(1))
    m = re.search(r"(?<=[A-Za-z0-9)\]])([+\-]+)$", s)
    return (s[:m.start()], charge_value(m.group(1))) if m else (s, 0)


def hydrate_parts(body):
    """CuSO4.5H2O, CuSO4*5H2O: the parts around the dots. A dot after digits only is a decimal point (0.5H2O)."""
    parts, cur = [], ""
    for k, c in enumerate(body):
        if c == "*" or (c == "." and k + 1 < len(body) and any(ch.isalpha() or ch in "()[]" for ch in cur)):
            parts.append(cur)
            cur = ""
        else:
            cur += c
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def coefficient_of(m):
    a, b, c, d, e, f, g, h = m.groups()
    if a:
        return Fraction(int(a), int(b))
    if c:
        return Fraction(int(c), int(d))
    if e:
        return Fraction(int(e), int(f))
    return Fraction(g or h)


def parse_species(text):
    """(coefficient, {element: count}, charge) of one species of a reaction (2H2, 1/2 O2, Ca(OH)2(aq), SO4^{2-}, e^-,
    CuSO4.5H2O), None for a word like "heat". Raises ChemUnknown when it cannot be read."""
    s = re.sub(r"\s+(?:v|\^)$|\\downarrow$|\\uparrow$", "", chem_clean(text)).strip()
    if s.lower() in SPECTATORS:
        return None
    coeff = Fraction(1)
    m = COEFFICIENT.match(s)
    if m:
        coeff, s = coefficient_of(m), s[m.end():]
    s = STATE.sub("", s).strip()
    if not s:
        raise ChemUnknown("a species without a formula")
    if re.fullmatch(r"e\s*(?:\^\s*\{?\s*-\s*\}?|-)", s):
        return coeff, {}, -1
    s, charge = split_charge(s)
    atoms = {}
    for part in hydrate_parts(s):
        k, m = Fraction(1), COEFFICIENT.match(part)
        if m:
            k, part = coefficient_of(m), part[m.end():]
        group, _ = formula_group(part, 0, None)
        if not group:
            raise ChemUnknown("a species without atoms")
        for el, n in group.items():
            atoms[el] = atoms.get(el, 0) + k * n
    return coeff, atoms, charge


def formula_mass(text):
    """The molar mass in g/mol of a formula (H2O, Ca(OH)2, CuSO4.5H2O), or None when it cannot be read or an element
    has no standard weight here."""
    try:
        parsed = parse_species(text)
    except (ChemUnknown, ZeroDivisionError):
        return None
    if parsed is None or parsed[0] != 1 or not parsed[1] or any(el not in WEIGHTS for el in parsed[1]):
        return None
    return float(sum(WEIGHTS[el] * n for el, n in parsed[1].items()))


def arrow_at(text, i):
    """(index after the arrow and its note, [notes]) when an arrow starts at text[i], else None."""
    m = ARROW.match(text, i)
    if m is None:
        return None
    end, notes = m.end(), []
    if m.group(0).startswith(("\\xright", "\\xleft")):
        x = ARROW_XNOTE.match(text, end)
        if x:
            notes, end = [n for n in x.groups() if n is not None], x.end()
    else:
        n = ARROW_NOTE.match(text, end)
        while n:
            notes.append(n.group(1))
            end = n.end()
            n = ARROW_NOTE.match(text, end)
    return end, notes


def split_arrows(text):
    """The sides of a reaction text between its arrows, and the notes written on the arrows."""
    sides, notes, depth, start, i = [], [], 0, 0, 0
    while i < len(text):
        arrow = arrow_at(text, i) if depth == 0 else None
        if arrow:
            sides.append(text[start:i])
            start = i = arrow[0]
            notes += arrow[1]
            continue
        depth += (text[i] in "([{") - (text[i] in ")]}")
        i += 1
    sides.append(text[start:])
    return sides, notes


def split_plus(side):
    """The species of a side. A plus is a separator when a space stands before it or a formula starts after it (2H2+O2);
    otherwise it is a charge (Na+, H+ + OH-)."""
    parts, cur, depth = [], "", 0
    for k, c in enumerate(side):
        depth += (c in "([{") - (c in ")]}")
        before, after = side[k - 1] if k else " ", side[k + 1] if k + 1 < len(side) else " "
        # Ag+(aq): the plus is the charge and (aq) the state, not the start of a species in brackets
        if c == "+" and depth == 0 and not STATE_AT.match(side, k + 1) and (
                before.isspace() or after.isalnum() or after in "(["):
            parts.append(cur)
            cur = ""
        else:
            cur += c
    parts.append(cur)
    return [p for p in parts if p.strip()]


def amount(n):
    return str(int(n)) if n == int(n) else f"{float(n):g}"


def signed(n):
    return "0" if n == 0 else ("+" if n > 0 else "-") + amount(abs(n))


def balance_problem(left, right):
    """Why two sides of a reaction do not balance ("O: 2 on the left, 1 on the right"), or None."""
    def totals(side):
        atoms, charge = {}, Fraction(0)
        for coeff, group, c in side:
            for el, n in group.items():
                atoms[el] = atoms.get(el, 0) + coeff * n
            charge += coeff * c
        return atoms, charge
    (la, lc), (ra, rc) = totals(left), totals(right)
    order = dict.fromkeys(el for side in (left, right) for _, group, _ in side for el in group)
    problems = [f"{el}: {amount(la.get(el, 0))} on the left, {amount(ra.get(el, 0))} on the right"
                for el in order if la.get(el, 0) != ra.get(el, 0)]
    if lc != rc:
        problems.append(f"charge: {signed(lc)} on the left, {signed(rc)} on the right")
    return "; ".join(problems) or None


def reaction_texts(line):
    """The reactions of a line made of \\ce{} groups, plus signs and arrows (\\ce{2H2} + \\ce{O2} \\rightarrow
    \\ce{2H2O}), each as one string in mhchem notation. Two groups with only spacing between them (\\ce{..} \\qquad
    \\ce{..}) are two reactions. [] when the line is anything else."""
    s = re.sub(r"(?<=\d),(?=\d)", ".", line)
    texts, parts, groups, last, i = [], [], 0, None, 0
    while i < len(s):
        ce = ce_at(s, i)
        skip = REACTION_SKIP.match(s, i)
        heading = re.match(r"\\text\s*\{([^{}]*:\s*)\}", s[i:]) if not groups else None
        arrow = arrow_at(s, i)
        if ce:
            if last == "ce":
                texts.append("".join(parts))
                parts = []
            parts.append(ce[0])
            groups, last, i = groups + 1, "ce", ce[1]
        elif skip:
            i = skip.end()
        elif heading and is_heading(heading.group(1)):
            i += heading.end()
        elif s[i] == "+":
            parts.append(" + ")
            last, i = "plus", i + 1
        elif arrow:
            parts.append(" " + s[i:arrow[0]] + " ")
            last, i = "arrow", arrow[0]
        elif re.fullmatch(r"[.,;]\s*", s[i:]):
            break
        else:
            return []
    texts.append("".join(parts))
    return texts if groups else []


def chem_reaction(text):
    """("ok" | "failed" | "unknown", problem, species) for one reaction in mhchem notation; None when it has no arrow.
    species is what stands on each side without coefficients and states, or None where the reaction is unreadable."""
    try:
        sides_text, notes = split_arrows(text)
        if len(sides_text) < 2:
            return None
        for note in notes:
            if re.sub(r"[\s$]", "", note).lower() not in ARROW_NOTES:
                raise ChemUnknown(f"cannot tell what {note} on the arrow stands for")
        sides = []
        for piece in sides_text:
            species = [p for p in map(parse_species, split_plus(piece)) if p is not None]
            if not species:
                raise ChemUnknown("a side of the reaction without a species")
            sides.append(species)
        # NH4+Cl- may be a plus between two substances or the charge of the first; with charges about, say nothing
        if re.search(r"(?<=\S)\+(?=[A-Za-z0-9\[]|\((?!(?:aq|s|l|g|cr)\)))", " ".join(sides_text)) and any(
                charge for side in sides for _, _, charge in side):
            raise ChemUnknown("a plus sign without a space may be a charge")
    except ChemUnknown as e:
        return ("unknown", str(e), None)
    except (Unsupported, ZeroDivisionError, ValueError, RecursionError):
        return None
    about = tuple(frozenset((tuple(sorted(group.items())), charge) for _, group, charge in side) for side in sides)
    problems = [balance_problem(left, right) for left, right in zip(sides, sides[1:])]
    problem = next((p for p in problems if p), None)
    return ("failed", problem, about) if problem else ("ok", None, about)


def chem_line(line):
    """("ok" | "failed" | "unknown", problem, species) when the line is a reaction in \\ce{} (or several side by side)
    that has atoms and charge on both sides of every arrow; None for any other line. species is what the reactions
    are about, so that a line which only goes on balancing the same equation can be told from another one."""
    if "\\ce" not in line:
        return None
    try:
        texts = reaction_texts(line)
    except (Unsupported, ZeroDivisionError, ValueError, RecursionError):
        return None
    found = [chem_reaction(t) for t in texts]
    if not found or None in found:
        return None
    species = tuple(f[2] for f in found) if all(f[2] is not None for f in found) else None
    for kind in ("failed", "unknown"):
        hit = next((f for f in found if f[0] == kind), None)
        if hit:
            return (kind, hit[1], species)
    return ("ok", None, species)


def ce_at(src, i):
    """(content, index after it) when \\ce{...} starts at src[i]."""
    m = CE_COMMAND.match(src, i)
    if m is None:
        return None
    inner, end = braced(src, m.end())
    return inner, end


def chem_name(inner):
    return chem_clean(inner).replace(" ", "")


def unwrap_ce(text):
    """text with every \\ce{X} replaced by X."""
    out, i = "", 0
    while i < len(text):
        ce = ce_at(text, i)
        if ce:
            out, i = out + chem_name(ce[0]), ce[1]
        else:
            out, i = out + text[i], i + 1
    return out


def chem_label_at(src, i):
    """(name, index after it) for chemistry written as a name: \\ce{H2O}, [\\ce{H+}], n(\\ce{H2}), M_{\\ce{H2O}}.
    The name of a quantity of a substance is the same in all three spellings: M(H2O)."""
    ce = ce_at(src, i)
    if ce:
        return "\\ce{" + chem_name(ce[0]) + "}", ce[1]
    if src.startswith("[", i):
        k = i + 1
        while src[k:k + 1] == " ":
            k += 1
        ce = ce_at(src, k)
        if ce:
            k = ce[1]
            while src[k:k + 1] == " ":
                k += 1
            if src.startswith("]", k):
                return "[" + chem_name(ce[0]) + "]", k + 1
        return None
    m = CHEM_HEAD.match(src, i)
    if m is None:
        return None
    head, k = m.group(1) or m.group(2), m.end()
    while src[k:k + 1] == " ":
        k += 1
    if src.startswith("(", k):
        depth, end = 0, None
        for j in range(k, len(src)):
            depth += (src[j] == "(") - (src[j] == ")")
            if depth == 0:
                end = j
                break
        if end is not None and "\\ce" in src[k:end]:
            return f"{head}({unwrap_ce(src[k + 1:end]).replace(' ', '')})", end + 1
    elif src.startswith("_", k):
        k += 1
        ce = ce_at(src, k)
        if ce:
            return f"{head}({chem_name(ce[0])})", ce[1]
        if src.startswith("{", k):
            inner, end = braced(src, k)
            if "\\ce" in inner:
                return f"{head}({unwrap_ce(inner).replace(' ', '')})", end
    return None


# ---------------------------------------------------------------------------- tokens

GREEK = {"alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota",
         "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi",
         "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Phi", "Psi", "Omega"}
FUNCTIONS = {"sin": cmath.sin, "cos": cmath.cos, "tan": cmath.tan, "arcsin": cmath.asin, "arccos": cmath.acos,
             "arctan": cmath.atan, "sinh": cmath.sinh, "cosh": cmath.cosh, "tanh": cmath.tanh, "ln": cmath.log,
             "exp": cmath.exp, "lg": cmath.log10, "cot": lambda x: 1 / cmath.tan(x)}
RELATIONS = {"=": "=", "<": "<", ">": ">", "\\le": "<=", "\\leq": "<=", "\\leqslant": "<=", "\\ge": ">=",
             "\\geq": ">=", "\\geqslant": ">=", "\\neq": "!=", "\\ne": "!=", "\\approx": "~",
             "\\simeq": "~", "\\doteq": "~", "\\thickapprox": "~", "\\coloneqq": "=",
             ":=": "=", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~"}
AND_WORDS = {"and", "und", "also", "so", "thus", "hence", "then", "dann", "daher", "somit", "folglich", "i.e.",
             "d.h.", "bzw.", "sowie", "with", "mit", "where", "wobei", "da", "since", "because", "weil", "therefore"}
OR_WORDS = {"or", "oder"}
AND_COMMANDS = {"\\Rightarrow", "\\Leftrightarrow", "\\iff", "\\implies", "\\Longrightarrow", "\\Longleftrightarrow",
                "\\therefore", "\\land", "\\wedge", "\\quad", "\\qquad", "\\\\", "\\to", "\\mapsto"}
OR_COMMANDS = {"\\lor", "\\vee"}
SKIP = {"\\left", "\\right", "\\big", "\\Big", "\\bigg", "\\Bigg", "\\bigl", "\\bigr", "\\Bigl", "\\Bigr",
        "\\displaystyle", "\\textstyle", "\\limits", "\\nolimits", "\\,", "\\;", "\\:", "\\!", "\\ ", "~",
        "\\boxed", "\\underbrace", "\\overbrace", "\\phantom", "\\mathbf", "\\boldsymbol", "\\mathit", "\\vec",
        "\\bm", "\\checkmark", "\\cmark", "✓", "✔"}
HEADINGS = {"probe", "check", "kontrolle", "test", "prüfung", "verification", "einsetzen", "einsetzprobe"}
# Other words that only announce what follows. A heading outside these ("Falsch: ", "Unausgeglichen: ", "Fehler: ")
# may say that the line is wrong on purpose, so the line stays unknown with it.
NEUTRAL_HEADINGS = {"gegeben", "gesucht", "lösung", "loesung", "solution", "given", "rechnung", "calculation",
                    "ergebnis", "result", "antwort", "answer", "umformen", "rearranging"}
STEP_HEADING = re.compile(r"(?:schritt|step)\s*\d+[a-z]?")
VERDICTS = {"wahr", "true", "stimmt", "richtig", "korrekt", "correct", "ok", "w.a.", "q.e.d.", "✓", "✔"}
UNIT = re.compile(r"^(?:[kcmµμn]?m|km/h|m/s|[kmµμ]?g|t|[mk]?l|s|min|h|ms|°|€|\$|eur|euro|usd|grad|stück|cent|ct)$",
                  re.I)
MATRIX_ENVS = {"pmatrix", "bmatrix", "Bmatrix", "vmatrix", "matrix", "smallmatrix"}
NOOP_ENVS = {"aligned", "align", "align*", "gathered", "gather", "gather*", "split", "equation", "equation*"}

TOKEN = re.compile(r"\\[a-zA-Z]+|\\.|\d+(?:\.\d+)?|[a-zA-Z]|:=|[^\s]")
# 1.2e-3, 6.022E23, 3e8: scientific notation as it is typed. Euler's e is written 2e^{3}, which this does not match.
SCI = re.compile(r"\d+(?:\.\d+)?[eE][+-]?\d+(?![A-Za-z0-9_^({])")

# Units after a value: \mathrm{g/mol}, \text{ mol}, \mu\mathrm{m}, \Omega, ^\circ\mathrm{C}, °C, each possibly with an
# exponent, and several in a row (\mathrm{m}/\mathrm{s}^2).
UNIT_GROUP = re.compile(r"\\(?:mathrm|text|textrm|mbox)\s*(?=\{)")
UNIT_CIRC = re.compile(r"\s*(?:\{\s*\\circ\s*\}|\\circ|°)\s*"
                       r"(?:\\(?:mathrm|text|textrm)\s*\{\s*([CF])\s*\}|([CF])(?![A-Za-z]))")
UNIT_SPACE = re.compile(r"(?:\s|\\[,;:! ]|~)*")
UNIT_POWER = re.compile(r"\s*\^\s*(?:\{\s*([+\-−–]?\s*\d+)\s*\}|([+\-−–]?\d))")
UNIT_MICRO = re.compile("[\u00b5\u03bc][A-Za-z]+")
UNIT_STARTS = {"\\mathrm", "\\text", "\\textrm", "\\mbox", "\\mu", "\\Omega", "^", "°", "\u03a9", "\u2126", "\u00b5",
               "\u03bc"}

# A value written like a function of an event or a variable: P(A), E[X \\mid Y = 1], \\operatorname{Var}(X). Read as
# letters it would be a product of unknowns; it is a name, whose value the lines around it give or use.
LABEL_HEAD = re.compile(
    r"\\(?:mathbb|mathrm|mathbf)\s*\{\s*([PE])\s*\}|\\(Pr)(?![a-zA-Z])|"
    r"\\(?:operatorname|mathrm|text|textrm)\s*\{\s*(Var|Cov|SD|Std|Pr|P|E)\s*\}|"
    r"(?<![\\a-zA-Z])(Var|Cov|SD|Std|Pr)(?![a-zA-Z])|(?<![\\a-zA-Z])([PE])(?![a-zA-Z])"
)
# What makes P(...) or E(...) a name rather than a function of a number: a relation, a set operation, a condition or
# words inside, or nothing but capital letters (events and random variables).
LABEL_INNER = re.compile(r"[=<>|]|\\(?:mid|cap|cup|le|leq|ge|geq|in|setminus|text|textrm|mathrm|bar|overline|neg|ne"
                         r"|neq)(?![a-zA-Z])|\^c|\\mathbb")
EVENTS = re.compile(r"(?:\s|[A-Z](?:_\{?[A-Za-z0-9]+\}?)?|')+")


def label_name(inner):
    """The text inside a name's brackets without its spelling: \\text{..} opened, \\mid as |, no spaces or spacing."""
    t = re.sub(r"\\(?:text|textrm|mathrm|mbox|textit)\s*\{([^{}]*)\}", r"\1", inner)
    for command, plain in (("\\mid", "|"), ("\\cap", "∩"), ("\\cup", "∪"), ("\\leq", "<="), ("\\geq", ">="),
                           ("\\le", "<="), ("\\ge", ">=")):
        t = re.sub(re.escape(command) + r"(?![a-zA-Z])", plain, t)
    t = re.sub(r"\\[,;:! ]|\\q?quad|~|\s+", "", t)
    return re.sub(r"([_^])\{(\w)\}", r"\1\2", t)


def label_at(src, i):
    """(name, index after it) when a name written like a function starts at src[i], else None."""
    chem = chem_label_at(src, i)
    if chem is not None:
        return chem
    m = LABEL_HEAD.match(src, i)
    if m is None:
        return None
    head = next(g for g in m.groups() if g)
    head = "P" if head == "Pr" else head
    k = m.end()
    while k < len(src) and src[k] == " ":
        k += 1
    if k >= len(src) or src[k] not in "([":
        return None
    depth, close = 0, None
    for j in range(k, len(src)):
        if src[j] in "([{" and src[j - 1] != "\\":
            depth += 1
        elif src[j] in ")]}" and src[j - 1] != "\\":
            depth -= 1
            if depth == 0:
                close = j
                break
    if close is None:
        return None
    inner = src[k + 1:close]
    if head in ("P", "E") and src[k] == "(" and not (LABEL_INNER.search(inner) or EVENTS.fullmatch(inner)):
        return None
    return f"{head}({label_name(inner)})", close + 1


def is_heading(text):
    """Whether words set in \\text before a statement only announce it ("Probe: ", "Gegeben: ", "Schritt 2: ")."""
    word = re.sub(r"\s+", " ", text).strip().lower().strip(" .:;")
    return word in HEADINGS or word in NEUTRAL_HEADINGS or STEP_HEADING.fullmatch(word) is not None


class Tok:
    def __init__(self, kind, text, value=None):
        self.kind, self.text, self.value = kind, text, value

    def __repr__(self):
        return f"{self.kind}:{self.text}"


def braced(src, i):
    """The text inside the brace group that opens at src[i], and the index after it."""
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{" and (j == 0 or src[j - 1] != "\\"):
            depth += 1
        elif src[j] == "}" and src[j - 1] != "\\":
            depth -= 1
            if depth == 0:
                return src[i + 1:j], j + 1
    raise Unsupported("an unclosed brace")


def unit_power(src, j):
    """The index after a unit's exponent, as in \\text{cm}^2, which belongs to the unit and not to the number."""
    k = j
    while k < len(src) and src[k] == " ":
        k += 1
    if k < len(src) and src[k] == "^":
        k += 1
        while k < len(src) and src[k] == " ":
            k += 1
        if k < len(src) and src[k] == "{":
            return braced(src, k)[1]
        return k + 1
    return j


def unit_piece(src, i):
    """(text, index after it) of one unit written at src[i]: \\mathrm{kg}, \\text{ mol}, \\Omega, \\mu\\mathrm{m},
    ^\\circ\\mathrm{C}, °C, µm; else None."""
    m = UNIT_GROUP.match(src, i)
    if m:
        inner, end = braced(src, m.end())
        return inner.strip(), end
    if src.startswith("\\mu", i) and not src[i + 3:i + 4].isalpha():
        m = UNIT_GROUP.match(src, i + 3)                # \mu stands for the prefix only when it touches the unit
        if m:
            inner, end = braced(src, m.end())
            return "µ" + inner.strip(), end
        return None
    if src.startswith("\\Omega", i) and not src[i + 6:i + 7].isalpha():
        return "Ω", i + 6
    if src[i:i + 1] in ("Ω", "Ω"):
        return "Ω", i + 1
    if src[i:i + 1] in ("^", "°"):
        m = UNIT_CIRC.match(src, i + 1 if src[i] == "^" else i)
        return ("°" + (m.group(1) or m.group(2)), m.end()) if m else None
    m = UNIT_MICRO.match(src, i)
    return ("µ" + m.group(0)[1:], m.end()) if m else None


def unit_group(src, i):
    """(text, index after it, whether it ends in an exponent) of the unit at src[i] with the pieces that touch it
    (\\mathrm{k}\\Omega is one word) and its exponent; else None."""
    piece = unit_piece(src, i)
    if piece is None:
        return None
    text, j = piece
    while True:
        m = UNIT_POWER.match(src, j)
        if m:
            exponent = (m.group(1) or m.group(2)).replace(" ", "").replace("−", "-").replace("–", "-")
            return f"{text}^{exponent}", m.end(), True
        nxt = unit_piece(src, j)
        # a piece that is no unit by itself takes the next one that touches it; \mathrm{m}\mathrm{s} stays m times s.
        # A prefix before \Omega is a prefix, although "M" and "m" are units on their own: M\Omega is mega-ohm.
        prefix = nxt is not None and nxt[0] == "Ω" and text in PREFIXES
        if nxt is None or not prefix and (parse_unit(text) is not None or parse_unit(text + nxt[0]) is None):
            return text, j, False
        text, j = text + nxt[0], nxt[1]


def unit_span(src, i):
    """The unit written at src[i] right after a value, as ("ok", end, Unit); ("bad", end, text) for a \\mathrm word
    that is no unit we know; None when nothing unit-like is there. Several groups in a row multiply, or divide after
    a "/" (\\mathrm{m}/\\mathrm{s}^2); a second factor after a division is unclear and makes the unit "bad"."""
    first = unit_group(src, i)
    if first is None:
        return None
    text, j, had_power = first
    unit = parse_unit(text)
    if unit is None:
        core = text.split("^")[0]
        if UNIT.match(text.replace(" ", "")):            # EUR, €, Stück: a note or a currency, not a unit to convert
            return None
        if src.startswith("\\mathrm", i) and core.lower() != "e" and re.fullmatch(r"[^\s{}\\]{1,10}", core):
            return "bad", j, text
        return None
    divided, combined, label = False, False, unit.label
    while True:
        k = UNIT_SPACE.match(src, j).end()
        joiner = None
        if src.startswith("/", k):
            joiner, k = "/", UNIT_SPACE.match(src, k + 1).end()
        elif src.startswith("\\cdot", k) and not src[k + 5:k + 6].isalpha():
            joiner, k = "·", UNIT_SPACE.match(src, k + 5).end()
        elif src[k:k + 1] in ("·", "⋅"):
            joiner, k = "·", UNIT_SPACE.match(src, k + 1).end()
        elif k > j or had_power:
            joiner = "·"
        nxt = unit_group(src, k) if joiner else None
        more = parse_unit(nxt[0]) if nxt else None
        if more is None:
            break
        if divided:
            return "bad", nxt[1], src[i:nxt[1]]
        divided, combined = joiner == "/", True
        unit = unit.times(more, -1 if divided else 1)
        label += joiner + more.label
        j, had_power = nxt[1], nxt[2]
    return "ok", j, Unit(unit.scale, unit.dim, label, False, unit.c_power()) if combined else unit


def valueish(t):
    """Whether a token can be followed by a unit: a number, a name, a closing bracket."""
    return t is not None and (t.kind in ("num", "letter", "label", "unit") or (
        t.kind == "op" and t.text in (")", "]", "}")) or (t.kind == "cmd" and t.text[1:] in GREEK | {"pi"}))


def tokenize(src):
    """Tokens of one line: numbers, letters, commands, relations, separators ("and"/"or") and matrix markers."""
    src = (src.replace("{,}", ".").replace("−", "-").replace("–", "-").replace("·", "\\cdot ").replace("×", "\\times ")
           .replace("π", "\\pi ").replace("√", "\\sqrt ").replace("²", "^2").replace("³", "^3").replace("∞", "\\infty ")
           .replace("⋅", "\\cdot ").replace("÷", "\\div ").replace("{}", ""))     # {}^\circ: an empty group
    src = re.sub(r"(?<=\d),(?=\d)", ".", src)              # 1,5 is a German decimal
    out, i = [], 0
    while i < len(src):
        label = label_at(src, i)
        if label is not None:
            out.append(Tok("label", label[0]))
            i = label[1]
            continue
        sci = SCI.match(src, i)
        if sci is not None and (i == 0 or not (src[i - 1].isalnum() or src[i - 1] in "_.")):
            out.append(Tok("num", sci.group(0), complex(float(sci.group(0)))))
            i = sci.end()
            continue
        m = TOKEN.match(src, i)
        if m is None:
            i += 1
            continue
        t = m.group(0)
        j = m.end()
        if t.isspace():
            i = j
            continue
        if t in UNIT_STARTS and valueish(next((x for x in reversed(out) if x is not None), None)):
            span = unit_span(src, i)
            if span is not None:
                out.append(Tok("unit", span[2].label, span[2]) if span[0] == "ok" else Tok("badunit", span[2]))
                i = span[1]
                continue
        if t in ("\\text", "\\textrm", "\\mathrm", "\\mbox", "\\textbf", "\\textit", "\\operatorname"):
            k = j
            while k < len(src) and src[k] == " ":
                k += 1
            if k >= len(src) or src[k] != "{":
                raise Unsupported("text without braces")
            inner, j = braced(src, k)
            word = inner.strip().lower()
            if t == "\\operatorname" and word in FUNCTIONS | {"det"}:
                out.append(Tok("cmd", "\\" + word))
            elif t == "\\mathrm" and word == "e":
                out.append(Tok("cmd", "\\e"))
            elif not word or word in AND_WORDS or word.rstrip(",") in AND_WORDS:
                out.append(Tok("sep", "and"))
            elif word in OR_WORDS:
                out.append(Tok("sep", "or"))
            elif UNIT.match(word.replace(" ", "")):
                out.append(Tok("unit", inner))
                j = unit_power(src, j)
            else:
                out.append(Tok("word", inner))
            i = j
            continue
        if t == "\\boxed":                         # \boxed{x = 2}: the relation inside counts
            k = j
            while k < len(src) and src[k] == " ":
                k += 1
            if k < len(src) and src[k] == "{":
                inner, j = braced(src, k)
                out.extend(tokenize(inner))
            i = j
            continue
        if t in ("€", "$"):
            out.append(Tok("unit", t))
            i = unit_power(src, j)
            continue
        if t in ("\\begin", "\\end"):
            env, j = braced(src, j)
            if env in MATRIX_ENVS:
                out.append(Tok(t[1:], env))
            elif env not in NOOP_ENVS:
                raise Unsupported(f"the {env} environment")
            i = j
            continue
        if t == "\\%":
            out.append(Tok("op", "%"))
        elif t in SKIP or t == "&":
            out.append(Tok("amp", "&") if t == "&" else None)
        elif t in RELATIONS:
            out.append(Tok("rel", RELATIONS[t]))
        elif t == ":" and src.startswith("=", j):
            out.append(Tok("rel", "="))
            j += 1
        elif t in AND_COMMANDS:
            out.append(Tok("row" if t == "\\\\" else "sep", "and"))
        elif t in OR_COMMANDS:
            out.append(Tok("sep", "or"))
        elif t in (",", ";"):
            out.append(Tok("comma", t))
        elif t[0].isdigit():
            out.append(Tok("num", t, complex(float(t))))
        elif t[0].isalpha():
            out.append(Tok("letter", t))
        elif t.startswith("\\"):
            out.append(Tok("cmd", t))
        else:
            out.append(Tok("op", t))
        i = j
    return [t for t in out if t is not None]


def tidy_words(toks):
    """Words set in \\text at the top level of a line. At the start of a statement and before a relation one names a
    value ("\\text{Fläche} = 3 \\cdot 4"); after a value and before the end, a comma or a relation it is a note
    ("0.5 \\text{ probability}") and goes. Any other word stays, and the relation it is in stays unknown. A heading at
    the start of a statement ("\\text{Probe: } 2 \\cdot 3 = 6") and a verdict ("\\Rightarrow \\text{wahr}") go too.
    A note is kept as a unit that means nothing, so that a side with a note is not compared with one with a unit.
    Only an announcing heading goes (see is_heading); "\\text{Falsch: } 1/2 + 1/3 = 2/5" is a wrong line on purpose."""
    out, depth = [], 0
    for k, t in enumerate(toks):
        if t.kind == "begin" or (t.kind == "op" and t.text in ("(", "[", "{")):
            depth += 1
        elif t.kind == "end" or (t.kind == "op" and t.text in (")", "]", "}")):
            depth -= 1
        if t.kind == "word" and depth == 0:
            before = out[-1] if out else None
            after = toks[k + 1] if k + 1 < len(toks) else None
            starts = before is None or before.kind in ("sep", "comma", "row")
            word = re.sub(r"\s+", " ", t.text).strip().lower()
            if starts and after is not None and after.kind == "rel":
                out.append(Tok("label", "“" + word + "”"))
                continue
            if starts and is_heading(word):
                continue
            if starts and word.strip(" .:;!") in VERDICTS and (after is None or after.kind in ("sep", "comma", "row")):
                continue
            value = before is not None and (before.kind in ("num", "letter", "label", "unit") or
                                            (before.kind == "op" and before.text in (")", "]", "}", "%")))
            if value and (after is None or after.kind in ("sep", "comma", "row", "rel")):
                out.append(Tok("unit", t.text))
                continue
        out.append(t)
    return out


# ---------------------------------------------------------------------------- parser

FUNC_LETTERS = set("fghFGH")


class Parser:
    """Recursive descent over one expression; evaluate() returns the list of values (several after \\pm)."""

    def __init__(self, toks, env):
        self.toks, self.i, self.env = list(toks), 0, env      # a copy: digit() splits numbers in place

    def peek(self, k=0):
        return self.toks[self.i + k] if self.i + k < len(self.toks) else None

    def take(self):
        t = self.peek()
        self.i += 1
        return t

    def expect(self, kind, text=None):
        t = self.take()
        if t is None or t.kind != kind or (text is not None and t.text != text):
            raise Unsupported(f"expected {text or kind}")
        return t

    def at_op(self, *texts):
        t = self.peek()
        return t is not None and t.kind in ("op", "cmd") and t.text in texts

    # expr := term (('+' | '-' | \pm | \mp) term)*
    def expr(self):
        if self.at_op("+"):
            self.take()
        if self.at_op("-"):
            self.take()
            values = [neg(v) for v in self.term()]
        elif self.at_op("\\pm", "\\mp"):
            self.take()
            t = self.term()
            values = [v for x in t for v in (x, neg(x))]
        else:
            values = self.term()
        while self.at_op("+", "-", "\\pm", "\\mp"):
            op = self.take().text
            right = self.term()
            if op == "+":
                values = combine(values, right, add)
            elif op == "-":
                values = combine(values, right, sub)
            else:
                values = combine(values, right, add) + combine(values, right, sub)
        return values

    def starts_atom(self):
        t = self.peek()
        if t is None:
            return False
        if t.kind in ("num", "letter", "begin", "label"):
            return True
        if t.kind == "op":
            return t.text in ("(", "[", "{")
        return t.kind == "cmd" and t.text not in ("\\cdot", "\\times", "\\div", "\\pm", "\\mp", "\\circ")

    # term := factor (('\cdot' | '\times' | '*' | '/' | '\div' | ':' | implicit) factor)*
    def term(self):
        values = self.factor()
        while True:
            if self.at_op("\\cdot", "\\times", "*"):
                self.take()
                values = combine(values, self.factor(), mul)
            elif self.at_op("/", "\\div"):
                self.take()
                values = combine(values, self.factor(), div)
            elif self.starts_atom():
                values = combine(values, self.factor(), mul)
            else:
                return values

    def factor(self):
        if self.at_op("-"):
            self.take()
            return [neg(v) for v in self.factor()]
        if self.at_op("+"):
            self.take()
        return self.power()

    # power := atom ('!')? ('^' exponent)?
    def power(self):
        base = self.atom()
        if self.at_op("!"):
            self.take()
            base = [factorial(v) for v in base]
        if self.at_op("%"):
            self.take()
            base = [mul(v, 0.01) for v in base]
        while self.at_op("^"):
            self.take()
            t = self.peek()
            if t is not None and t.kind == "op" and t.text == "{":
                inner = self.group_tokens()
                if [x.text for x in inner] in (["T"], ["\\top"], ["t"]):
                    base = [transpose(v) for v in base]
                    continue
                if [x.text for x in inner] == ["\\circ"]:
                    base = [mul(v, math.pi / 180) for v in base]
                    continue
                exponent = Parser(inner, self.env).whole()
            elif t is not None and t.text in ("T", "\\top"):
                self.take()
                base = [transpose(v) for v in base]
                continue
            elif t is not None and t.text == "\\circ":
                self.take()
                base = [mul(v, math.pi / 180) for v in base]
                continue
            elif t is not None and t.kind == "num":
                exponent = [self.digit().value]          # x^23 is x squared times 3 in LaTeX
            elif t is not None and t.kind == "op" and t.text == "-" and self.peek(1) is not None \
                    and self.peek(1).kind == "num":
                self.take()                              # 10^-3, typed without braces
                exponent = [neg(self.digit().value)]
            elif t is not None and t.kind == "letter":
                self.take()
                exponent = [self.variable(t.text)]
            else:
                raise Unsupported("an exponent")
            base = combine(base, exponent, power)
        return self.units(base)

    def units(self, base):
        """The unit written after a value. Without units in play it is a note and goes; with them the value becomes
        a quantity. A unit this checker does not know makes the whole relation unknown."""
        t = self.peek()
        while t is not None and t.kind in ("unit", "badunit"):
            self.take()
            if t.kind == "badunit":
                raise Unsupported(f"the unit {t.text} is not known")
            if t.value is not None and self.env.get("__units__"):
                base = [attach(v, t.value) for v in base]
            t = self.peek()
        return base

    def group_tokens(self):
        """The tokens of a {...} group, the braces consumed."""
        self.expect("op", "{")
        depth, start = 1, self.i
        while True:
            t = self.take()
            if t is None:
                raise Unsupported("an unclosed group")
            if t.kind == "op" and t.text == "{":
                depth += 1
            elif t.kind == "op" and t.text == "}":
                depth -= 1
                if depth == 0:
                    return self.toks[start:self.i - 1]

    def group(self):
        return Parser(self.group_tokens(), self.env).whole()

    def argument(self):
        """A {group} or a single token, as after \\frac or \\sqrt: \\frac12 is a half."""
        t = self.peek()
        if t is not None and t.kind == "op" and t.text == "{":
            return self.group()
        if t is not None and t.kind == "num":
            return [self.digit().value]
        if t is not None and t.kind == "letter":
            self.take()
            return [self.variable(t.text)]
        raise Unsupported("an argument")

    def digit(self):
        """The first digit of the next number, leaving the rest of it as a number of its own."""
        t = self.take()
        if not t.text.isdigit():
            raise Unsupported("a decimal without braces")
        if len(t.text) > 1:
            self.toks.insert(self.i, Tok("num", t.text[1:], complex(float(t.text[1:]))))
        return Tok("num", t.text[0], complex(float(t.text[0])))

    def whole(self):
        values = self.expr()
        if self.peek() is not None:
            raise Unsupported(f"unexpected {self.peek().text}")
        return values

    def variable(self, name):
        if name == "e":
            return cmath.e
        if self.env.get("__units__"):                # names that were given a value with a unit, then plain values
            for known in (self.env.get("__qty__", {}), self.env.get("__plain__", {})):
                if name in known:
                    return known[name]
        if name not in self.env:
            raise FreeVariable(name)
        return self.env[name]

    def subscript(self, name):
        if self.at_op("_"):
            self.take()
            t = self.peek()
            if t is not None and t.kind == "op" and t.text == "{":
                inner = self.group_tokens()
                name += "_{" + "".join(x.text for x in inner) + "}"
            elif t is not None and t.kind in ("num", "letter"):
                self.take()
                name += "_{" + t.text[0] + "}"
                if t.kind == "num" and len(t.text) > 1:
                    raise Unsupported("a multi-digit index without braces")
            else:
                raise Unsupported("an index")
        return name

    def atom(self):
        t = self.take()
        if t is None:
            raise Unsupported("a missing operand")
        if t.kind == "num":
            return [t.value]
        if t.kind == "op" and t.text in ("(", "["):
            inner = self.until(")" if t.text == "(" else "]")
            return Parser(inner, self.env).whole()
        if t.kind == "op" and t.text == "{":
            self.i -= 1
            return self.group()
        if t.kind == "op" and t.text == "|":
            inner = self.until("|")
            return [abs_value(v) for v in Parser(inner, self.env).whole()]
        if t.kind == "begin":
            return [self.matrix(t.text)]
        if t.kind == "label":
            return [self.variable(t.text)]
        if t.kind == "letter":
            name = self.subscript(t.text)
            primes = 0
            while self.at_op("'"):
                self.take()
                primes += 1
            nxt = self.peek()
            if nxt is not None and nxt.kind == "op" and nxt.text == "(" and (t.text in FUNC_LETTERS or primes):
                self.take()
                args = Parser(self.until(")"), self.env).whole()
                return [apply_function(self.env, name, primes, a) for a in args]
            if primes:
                raise Unsupported("a derivative without its argument")
            if name in self.env.get("__functions__", {}):
                raise Unsupported("a function without its argument")
            return [self.variable(name)]
        if t.kind == "cmd":
            name = t.text[1:]
            if name in GREEK:
                return [self.variable(self.subscript("\\" + name))]
            if name == "pi":
                return [complex(math.pi)]
            if name == "e":
                return [cmath.e]
            if name in ("frac", "dfrac", "tfrac"):
                top, bottom = self.argument(), self.argument()
                return combine(top, bottom, div)
            if name == "binom":
                n, k = self.argument(), self.argument()
                return combine(n, k, binomial)
            if name == "sqrt":
                degree = None
                if self.at_op("["):
                    self.take()
                    degree = Parser(self.until("]"), self.env).whole()
                radicand = self.argument()
                if degree is None:
                    return [root(v, 2) for v in radicand]
                return combine(radicand, degree, lambda a, d: root(a, d))
            if name in FUNCTIONS or name in ("det", "log"):
                base = None
                if name == "log":
                    if not self.at_op("_"):
                        raise Unsupported("a logarithm without its base")
                    self.take()
                    base = self.argument()
                exponent = None
                if self.at_op("^"):                  # \sin^2 x
                    self.take()
                    exponent = self.argument()
                arg = self.function_argument()
                if name == "det":
                    values = [det(v) for v in arg]
                elif name == "log":
                    values = combine(arg, base, lambda a, b: cmath.log(scalar(a)) / cmath.log(scalar(b)))
                else:
                    values = [FUNCTIONS[name](scalar(v)) for v in arg]
                return combine(values, exponent, power) if exponent else values
            if name == "lvert":
                inner = self.until_cmd("\\rvert")
                return [abs_value(v) for v in Parser(inner, self.env).whole()]
            raise Unsupported(f"\\{name}")
        raise Unsupported(f"{t.text}")

    def function_argument(self):
        """(x), {x} or a single atom; "\\sin 2x" is ambiguous, so a bare argument must stand alone."""
        t = self.peek()
        if t is not None and t.kind == "op" and t.text in ("(", "{"):
            return self.atom()
        if t is not None and t.kind == "begin":
            return self.atom()
        values = self.power()
        if self.starts_atom():
            raise Unsupported("a function argument without brackets")
        return values

    def until(self, close_text):
        depth, start = 0, self.i
        opening = {")": "(", "]": "[", "|": None}[close_text]
        while True:
            t = self.take()
            if t is None:
                raise Unsupported(f"a missing {close_text}")
            if t.kind == "op" and opening and t.text == opening:
                depth += 1
            elif t.kind == "op" and t.text == close_text:
                if depth == 0:
                    return self.toks[start:self.i - 1]
                depth -= 1

    def until_cmd(self, text):
        start = self.i
        while True:
            t = self.take()
            if t is None:
                raise Unsupported(f"a missing {text}")
            if t.kind == "cmd" and t.text == text:
                return self.toks[start:self.i - 1]

    def matrix(self, env):
        rows, row, cell = [], [], []
        while True:
            t = self.take()
            if t is None:
                raise Unsupported("an unclosed matrix")
            if t.kind == "end":
                break
            if t.kind == "amp" or t.kind == "row":
                row.append(cell)
                cell = []
                if t.kind == "row":
                    rows.append(row)
                    row = []
                continue
            cell.append(t)
        if cell or row:
            row.append(cell)
            rows.append(row)
        rows = [r for r in rows if any(c for c in r)]
        values = []
        for r in rows:
            out = []
            for c in r:
                v = Parser(c, self.env).whole()
                if len(v) != 1 or isinstance(v[0], Matrix):
                    raise Unsupported("a matrix entry")
                out.append(v[0])
            values.append(out)
        if not values or len({len(r) for r in values}) != 1:
            raise Unsupported("a ragged matrix")
        m = Matrix(values)
        return m.det() if env == "vmatrix" else m


class FreeVariable(Exception):
    """A variable without a value; the caller tries again with values for it."""


def combine(left, right, fn):
    out = [fn(a, b) for a in left for b in right]
    if len(out) > 16:
        raise Unsupported("too many branches")
    return out


def scalar(v):
    if isinstance(v, Matrix):
        raise Unsupported("a function of a matrix")
    return v


def transpose(v):
    if not isinstance(v, Matrix):
        raise Unsupported("a transpose of a number")
    return v.transpose()


def det(v):
    if not isinstance(v, Matrix):
        raise Unsupported("a determinant of a number")
    return v.det()


def abs_value(v):
    return complex(abs(scalar(v)))


def root(v, degree):
    degree = scalar(degree)
    if isinstance(v, Qty):                           # sqrt of m^2 is m; sqrt of m is no unit we use
        dim = [d / degree.real for d in v.dim]
        c_exp = v.c_exp / degree.real
        if any(abs(d - round(d)) > 1e-9 for d in dim) or abs(c_exp - round(c_exp)) > 1e-9:
            raise Unsupported("a root of a unit")
        if v.celsius:
            raise Unsupported("a root of a temperature in °C")
        return with_dim(root(v.value, degree), [int(round(d)) for d in dim], int(round(c_exp)), v.pt)
    v = scalar(v)
    if abs(v.imag) < 1e-15 and v.real >= 0:
        return complex(v.real ** (1 / degree.real))
    if abs(v.imag) < 1e-15 and abs(degree.real - round(degree.real)) < 1e-12 and round(degree.real) % 2 == 1:
        return complex(-((-v.real) ** (1 / degree.real)))   # odd roots of negative numbers stay real
    return v ** (1 / degree)


def factorial(v):
    v = scalar(v)
    if abs(v.imag) > 1e-12 or v.real < 0 or abs(v.real - round(v.real)) > 1e-12:
        raise Unsupported("a factorial of a number that is not natural")
    return complex(math.factorial(int(round(v.real))))


def binomial(n, k):
    n, k = scalar(n), scalar(k)
    if any(abs(x.imag) > 1e-12 or abs(x.real - round(x.real)) > 1e-12 for x in (n, k)):
        raise Unsupported("a binomial coefficient of numbers that are not whole")
    return complex(math.comb(int(round(n.real)), int(round(k.real))))


def apply_function(env, name, primes, arg):
    functions = env.get("__functions__", {})
    if name not in functions:
        raise Unsupported(f"the unknown function {name}")
    var, body = functions[name]

    def f(x):
        local = dict(env)
        local[var] = x
        values = Parser(body, local).whole()
        if len(values) != 1:
            raise Unsupported("a function with several values")
        return scalar(values[0])

    arg = scalar(arg)
    if primes == 0:
        return f(arg)
    if primes == 1:
        h = 1e-5 * max(1, abs(arg))
        return (f(arg + h) - f(arg - h)) / (2 * h)
    if primes == 2:
        h = 1e-3 * max(1, abs(arg))
        return (f(arg + h) - 2 * f(arg) + f(arg - h)) / (h * h)
    raise Unsupported("a third derivative")


# ---------------------------------------------------------------------------- relations

OPERATIONS = {"+", "-", "*", "/", ":", "\\cdot", "\\div", "\\times"}


def split_line(toks):
    """A line as its statements and how they combine: ([statement tokens, ...], "and" | "or"). A note of the
    operation applied to both sides ("3x - 7 = 2x + 5 \\quad | -2x") is left out."""
    parts, cur, joiner, depth, note = [], [], "and", 0, False
    for k, t in enumerate(toks):
        if t.kind == "begin" or (t.kind == "op" and t.text in ("(", "[", "{")):
            depth += 1
        elif t.kind == "end" or (t.kind == "op" and t.text in (")", "]", "}")):
            depth -= 1
        top = depth == 0 and t.kind != "end"
        if top and t.kind in ("sep", "comma", "row"):
            if t.kind == "sep" and t.text == "or":
                joiner = "or"
            if cur:
                parts.append(cur)
            cur, note = [], False
            continue
        nxt = toks[k + 1] if k + 1 < len(toks) else None
        if top and t.kind == "op" and t.text == "|" and nxt is not None and nxt.text in OPERATIONS:
            note = True
        if top and not note and t.kind == "unit" and t.value is None and cur:
            cur[-1].labelled = True                  # a note or a currency: it means nothing, but it was there
        if note or (top and (t.kind == "amp" or t.kind == "unit" and t.value is None)):
            continue
        cur.append(t)
    if cur:
        parts.append(cur)
    return parts, joiner


def chain(statement):
    """A statement as its sides and the relations between them: ([sides], [relations])."""
    sides, rels, cur, depth = [], [], [], 0
    for t in statement:
        if t.kind in ("begin",) or (t.kind == "op" and t.text in ("(", "[", "{")):
            depth += 1
        elif t.kind == "end" or (t.kind == "op" and t.text in (")", "]", "}")):
            depth -= 1
        if t.kind == "rel" and depth == 0:
            sides.append(cur)
            rels.append(t.text)
            cur = []
        else:
            cur.append(t)
    sides.append(cur)
    if any(not s for s in sides):
        raise Unsupported("a relation without a side")
    return sides, rels


def text_of(toks):
    out = ""
    for t in toks:
        piece = t.text
        if out and (piece[0].isalnum() or piece.startswith("\\") or t.kind == "unit" and piece[0] != "°") and (
                out[-1].isalnum() or t.kind == "unit" and out[-1] in "}])"):
            out += " "
        out += piece
    return out


def simple_name(side):
    """The variable a side names on its own ("x", "x_1", "\\lambda_{2}"), or None."""
    p = Parser(side, {})
    t = p.take()
    if t is None:
        return None
    if t.kind == "label":
        name = t.text
    elif (t.kind == "letter" and t.text != "e") or (t.kind == "cmd" and t.text[1:] in GREEK):
        try:
            name = p.subscript(t.text)
        except Unsupported:                      # x_ with no index after it
            return None
    else:
        return None
    return name if p.peek() is None else None


def function_head(side):
    """("f", "x") for a side "f(x)", else None."""
    if (len(side) == 4 and side[0].kind == "letter" and side[0].text in FUNC_LETTERS and side[1].text == "("
            and side[2].kind == "letter" and side[3].text == ")"):
        return side[0].text, side[2].text
    return None


def claims_function(side, functions):
    """Whether a side is f(x), f'(x) or f''(x) of a defined f at a bare variable: a claim for every x."""
    k = 1
    while k < len(side) and side[k].kind == "op" and side[k].text == "'":
        k += 1
    rest = [t.text for t in side[k:]]
    return (len(side) == k + 3 and side[0].kind == "letter" and side[0].text in functions and rest[0] == "("
            and side[k + 1].kind == "letter" and rest[2] == ")")


def printed_number(side):
    """(decimals of the mantissa, whether it has a decimal point, power of ten, whether it is a percentage) of a side
    that is one number as a tutor prints it: 2.33, -7, 33 %, 1.2e-3, 1.2 \\times 10^{-3}. Else None. A unit after the
    number does not count."""
    toks = [t for t in side if t.kind != "unit"]
    if toks and toks[0].kind == "op" and toks[0].text == "-":
        toks = toks[1:]
    percent = len(toks) == 2 and toks[1].kind == "op" and toks[1].text == "%"
    toks = toks[:1] if percent else toks
    if len(toks) == 1 and toks[0].kind == "num":
        m = re.fullmatch(r"(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?", toks[0].text)
        return len(m.group(2) or ""), m.group(2) is not None, int(m.group(3) or 0), percent
    if len(toks) >= 5 and toks[0].kind == "num" and toks[0].text.replace(".", "").isdigit() \
            and toks[1].text in ("\\times", "\\cdot", "*") and toks[2].text == "10" and toks[3].text == "^":
        rest, braces = toks[4:], False
        if rest and rest[0].text == "{" and rest[-1].text == "}":
            rest, braces = rest[1:-1], True
        sign = -1 if rest and rest[0].kind == "op" and rest[0].text == "-" else 1
        rest = rest[1:] if rest and rest[0].kind == "op" and rest[0].text in ("+", "-") else rest
        if len(rest) == 1 and rest[0].kind == "num" and rest[0].text.isdigit() and (braces or len(rest[0].text) == 1):
            point = "." in toks[0].text
            return len(toks[0].text.split(".")[1]) if point else 0, point, sign * int(rest[0].text), False
    return None


def numbers_of(side):
    """A side's decimals, counted from the unit digit of the value, when it is a plain decimal like 2.33 or 1.2e-3 (a
    number printed with a point is rounded); else None. A whole number with a unit and three digits or more (4326 J)
    is taken as rounded to its last digit."""
    p = printed_number(side)
    if p is None or p[3]:
        return None
    if p[1]:
        return p[0] - p[2]
    digits = [t.text for t in side if t.kind == "num"]
    if p[2] == 0 and len(digits) == 1 and len(digits[0]) >= 3 and any(
            t.kind == "unit" and t.value is not None for t in side):
        return 0
    return None


def places_of(side):
    """The decimals a side prints when it is one plain number or percentage (33 %, 2.50, -7, 6 \\times 10^{23}), else
    None."""
    p = printed_number(side)
    return p[0] - p[2] + (2 if p[3] else 0) if p is not None else None


def printed(rel, left, right):
    """(decimals, side) of the side that sets the rounding of a relation: a plain decimal rounds an equality, and for
    \\approx any plain number (or percentage) is rounded to the places it prints. The right side counts first."""
    pick = places_of if rel == "~" else numbers_of
    for side in (right, left):
        places = pick(side)
        if places is not None:
            return places, side
    return None, None


def rounding(rel, left, right):
    """The decimals the relation between two sides may differ by; see printed()."""
    return printed(rel, left, right)[0]


def evaluate(side, env):
    try:
        return Parser(side, env).whole()
    except (TypeError, AttributeError):          # a quantity where only a number makes sense
        raise Unsupported("a quantity where a number is needed")


def holds(rel, a, b, decimals=None):
    """Whether a rel b holds for the values: lists of alternatives, compared as sets; one value against several
    ("x_{1,2} = 2 \\pm 1" for x_{1,2} = 3) is one of them."""
    if rel in ("=", "~", "!="):
        if len(a) == 1 and len(b) > 1 or len(b) == 1 and len(a) > 1:
            one, many = (a[0], b) if len(a) == 1 else (b[0], a)
            same = any(equal(one, y, rel, decimals) for y in many)
        elif len(a) != len(b):
            same = False
        else:
            used, same = set(), True
            for x in a:
                k = next((k for k, y in enumerate(b) if k not in used and equal(x, y, rel, decimals)), None)
                if k is None:
                    same = False
                    break
                used.add(k)
        return not same if rel == "!=" else same
    if len(a) != 1 or len(b) != 1 or isinstance(a[0], Matrix) or isinstance(b[0], Matrix):
        raise Unsupported("an inequality of several values")
    x, y = a[0], b[0]
    if abs(x.imag) > 1e-9 or abs(y.imag) > 1e-9:
        raise Unsupported("an inequality of complex numbers")
    x, y = x.real, y.real
    strict, loose = (1e-12 * max(abs(x), abs(y)), 1e-9 * max(abs(x), abs(y))) if tiny(x, y) else (1e-12, 1e-9)
    return {"<": x < y - strict, ">": x > y + strict, "<=": x <= y + loose, ">=": x >= y - loose}[rel]


def rounds_to(x, y, decimals):
    """Whether x is y rounded to the decimals given (a negative number counts places left of the point)."""
    return abs(x - y) <= 0.5 * 10 ** -decimals * (1 + 1e-9)


def equal(x, y, rel, decimals):
    if rel == "~":
        # within a percent, or within the rounding of the places the printed side shows; the margin of an absolute
        # 0.006 is for two values that print nothing, and would swallow any small value
        return close(x, y, rel=0.01, absolute=0.006 if decimals is None else 0) or (
            decimals is not None and not isinstance(x, Matrix) and not isinstance(y, Matrix)
            and rounds_to(x, y, decimals))
    if decimals is not None and not isinstance(x, Matrix) and not isinstance(y, Matrix):
        return rounds_to(x, y, decimals) or close(x, y)
    return close(x, y)


SAMPLES = [0.7314, 1.2718, -0.6431, 2.1129, 0.4142, -1.3567]


def free_variables(side, env):
    """Variables of a side that have no value, found by evaluating until nothing is missing."""
    missing, local = [], dict(env)
    for _ in range(12):
        try:
            evaluate(side, local)
            return missing
        except FreeVariable as e:
            missing.append(e.args[0])
            local[e.args[0]] = complex(SAMPLES[len(missing) % len(SAMPLES)])
    raise Unsupported("too many unknowns")


def identity(sides, rels, env, names):
    """Whether every relation holds at random values of the free variables (an identity)."""
    if any(r not in ("=", "~") for r in rels):
        return False
    good = 0
    for trial in range(5):
        local = dict(env)
        for k, name in enumerate(names):
            local[name] = complex(SAMPLES[(trial + 2 * k) % len(SAMPLES)] * (1 + 0.37 * k))
        try:
            values = [evaluate(s, local) for s in sides]
        except (ZeroDivisionError, ValueError, OverflowError):
            continue
        if not all(holds(r, values[k], values[k + 1]) for k, r in enumerate(rels)):
            return False
        good += 1
    return good >= 3


def assigned_names(sides, rels):
    """The names a chain gives its value to: "P(A) = P(B) = 0.5" gives it to both. [] when it is no assignment."""
    name = simple_name(sides[0]) if len(sides) > 1 and rels[0] == "=" else None
    if name is None:
        return []
    heads = [name]
    while (len(heads) < len(sides) - 1 and rels[len(heads) - 1] == "="
           and simple_name(sides[len(heads)]) is not None):
        heads.append(simple_name(sides[len(heads)]))
    return heads if rels[len(heads) - 1] == "=" else []


def check_lines(lines):
    """[{"status", "problem"?}] per line; see the module docstring. A value that no float holds, or a bug, may cost a
    line its context but not the other lines their verdict: they are checked one by one then."""
    try:
        return check_all(lines)
    except Exception:
        out = []
        for line in lines:
            try:
                out.append(check_all([line])[0])
            except Exception:
                out.append({"status": "unknown"})
        return out


def check_all(lines):
    """check_lines() over the solution as a whole, where the lines give each other their values."""
    parsed, reactions = [], {}
    for index, line in enumerate(lines):
        reaction = chem_line(line)
        if reaction is not None:                 # a reaction in \ce{} is balanced, not evaluated
            reactions[index] = reaction
            parsed.append(([], "and", None))
            continue
        try:
            parts, joiner = split_line(tidy_words(tokenize(line)))
            parsed.append(([chain(p) for p in parts], joiner, None))
        except Unsupported as e:
            parsed.append(([], "and", str(e)))
        except (ArithmeticError, ValueError, RecursionError):      # one odd line costs only its own verdict
            parsed.append(([], "and", "the line could not be read"))
    # balancing step by step: an equation that is not balanced yet, followed by one over the same species, is a move
    for index, (status, _, species) in list(reactions.items()):
        if status == "failed" and species is not None and any(
                later[2] == species for k, later in reactions.items() if k > index):
            reactions[index] = ("unknown", None, species)

    # definitions (matrices, functions) and candidate values (assignments), in order
    env, functions, alternatives, derived = {"__functions__": {}}, {}, {}, {}
    env["__functions__"] = functions
    env["__derived__"] = derived                 # values that a chain computed, by name
    rounded = env["__rounded__"] = set()         # names whose value was printed rounded, or built on such values
    for statements, joiner, _ in parsed:
        for sides, rels in statements:
            if len(sides) < 2 or rels[0] != "=":
                continue
            head = function_head(sides[0])
            if head and head[0] not in functions:
                functions[head[0]] = (head[1], sides[1])
                continue
            heads = assigned_names(sides, rels)
            if not heads:
                continue
            try:
                try:
                    values = evaluate(sides[len(heads)], env)
                except FreeVariable:              # "A = 2w \cdot w = 50": the chain ends in A's value
                    values = evaluate(sides[-1], env)
            except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
                continue
            if has_decimals(sides) or uses_rounded(sides[len(heads):], rounded):
                rounded.update(name.split("_", 1)[0] for name in heads)
            for name in heads:
                if any(isinstance(v, Matrix) for v in values):
                    if name not in env:
                        env[name] = values[0]
                else:
                    known = alternatives.setdefault(name, [])
                    known += [v for v in values if not any(close(v, k) for k in known)]
                    if len(sides) - len(heads) >= 2 and computed(sides[len(heads):], rels[len(heads):], env):
                        derived.setdefault(name, []).extend(values)
    # a name that a chain computed has that value; a stray claim does not make it uncertain
    for name in derived:
        if "(" in name:
            values = derived[name]
            alternatives[name] = [v for i, v in enumerate(values) if not any(close(v, w) for w in values[:i])]
    # x_1 = 2, x_2 = 3 are values of x as well
    for name in list(alternatives):
        base = name.split("_", 1)[0]
        if base != name and base not in alternatives and "(" not in name:
            alternatives.setdefault(base + "#", []).extend(alternatives[name])
    for name in [n for n in alternatives if n.endswith("#")]:
        values = alternatives.pop(name)
        alternatives[name[:-1]] = [v for i, v in enumerate(values) if not any(close(v, w) for w in values[:i])]
    # a name given a value with a unit ("m = 4.0\,\mathrm{g}") keeps it for the lines that use it with units; the
    # plain values (as written) stay what they were. A name that stands for two values has no unit to use.
    qty, plain, printed_qty = {}, {n: v[0] for n, v in alternatives.items() if len(v) == 1}, {}
    env["__qty__"], env["__plain__"], env["__qty_printed__"] = qty, plain, printed_qty
    uenv, clashes = dict(env), set()
    uenv["__units__"] = True
    for statements, joiner, _ in parsed:
        for sides, rels in statements:
            heads = assigned_names(sides, rels)
            for side in sides[len(heads):]:
                if unit_state(side, env) != "known":
                    continue
                try:
                    values = evaluate(side, uenv)
                except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
                    continue
                if len(values) == 1 and isinstance(values[0], Qty):
                    for name in heads:
                        # the same value computed from rounded names (20 m, 20.01 m) is not a second one
                        if name in qty and not close(qty[name], values[0]) and not (
                                uses_rounded([side], rounded) and qty[name].dim == values[0].dim
                                and near(qty[name].value, values[0].value)):
                            clashes.add(name)
                        qty.setdefault(name, values[0])
                    shown = printed_result(sides[-1], values[0], env, uenv) if sides[-1] is not side else None
                    for name in heads:
                        if shown is not None:
                            printed_qty.setdefault(name, shown)
                break
    for name in clashes | {n for n in qty if len(alternatives.get(n, ())) > 1}:
        qty.pop(name, None)
        printed_qty.pop(name, None)
    names = sorted(alternatives)
    envs = []
    for combo in itertools.islice(itertools.product(*(alternatives[n] for n in names)), 16):
        local = dict(env)
        local.update(zip(names, combo))
        envs.append(local)

    checked = [[check_safely(sides, rels, env, envs, functions) for sides, rels in statements]
               if error is None else [] for statements, joiner, error in parsed]
    checked = claims(parsed, checked, alternatives)
    out = []
    for index, ((statements, joiner, error), results) in enumerate(zip(parsed, checked)):
        if index in reactions:
            status, problem, _ = reactions[index]
            out.append({"status": status, **({"problem": problem} if problem else {})})
            continue
        if error is not None or not statements:
            out.append({"status": "unknown"} if error is None else {"status": "unknown", "problem": error})
            continue
        out.append(line_status(results) if joiner == "and" else either(statements, results, envs))
    return out


def labels_in(sides):
    return {t.text for side in sides for t in side if t.kind == "label"}


def computed(sides, rels, env):
    """Whether a chain of plain numbers computes one value: every side is a number and each equals the next."""
    try:
        values = [evaluate(side, env) for side in sides]
        return all(holds(r, values[k], values[k + 1], rounding(r, sides[k], sides[k + 1])) for k, r in enumerate(rels))
    except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
        return False


def claims(parsed, checked, alternatives):
    """A name given a value is only a claim, and a line of claims stays unknown, unless a statement that checks out
    computes or uses the name: "P(A) = 0.3" is what the later "P(A \\cap B) = P(A) \\cdot 0.5 = 0.15" is computed from,
    and nothing else checks it. A name with two different values in the solution is a claim as well."""
    verified = set()
    for (statements, _, _), results in zip(parsed, checked):
        for (sides, _), (kind, _) in zip(statements, results):
            if kind == "ok":
                verified |= labels_in(sides)
    out = []
    for (statements, _, _), results in zip(parsed, checked):
        out.append([("claim", None) if kind == "assign" and labels_in(sides) and (
            not labels_in(sides) & verified or any(len(alternatives.get(n, ())) > 1 for n in labels_in(sides)))
                    else (kind, problem) for (sides, _), (kind, problem) in zip(statements, results)])
    return out


def either(statements, results, envs):
    """A line joined by "or" ("x = 2 \\lor x = 3"): for every candidate, one of its relations holds."""
    if any(k == "ok" for k, _ in results):
        return {"status": "ok"}
    verdicts = []
    for e in envs:
        seen = good = False
        for sides, rels in statements:
            try:
                values = [evaluate(s, e) for s in sides]
            except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
                continue
            seen = True
            good = good or all(holds(r, values[k], values[k + 1]) for k, r in enumerate(rels))
        if seen:
            verdicts.append(good)
    if verdicts and all(verdicts):
        return {"status": "ok"}
    if verdicts and not any(verdicts):
        return {"status": "failed", "problem": "none of its relations holds for the solution's values"}
    return {"status": "unknown"}


def unit_state(side, env):
    """"known" when a side carries a unit we can read or a name that was given one, "bad" when it names a unit we
    cannot read, "label" when all it has is a note or a currency, else None."""
    if any(t.kind == "badunit" for t in side):
        return "bad"
    if any(t.kind == "unit" and t.value is not None for t in side):
        return "known"
    qty = env.get("__qty__", {})
    if qty and simple_name(side) is None:        # a name on its own is what an assignment gives a value to
        for k, t in enumerate(side):
            nxt = side[k + 1] if k + 1 < len(side) else None
            named = t.kind == "label" or t.kind == "letter" or (t.kind == "cmd" and t.text[1:] in GREEK)
            if named and t.text in qty and not (nxt is not None and nxt.kind == "op" and nxt.text in ("_", "'")):
                return "known"
    if any(t.kind == "unit" or getattr(t, "labelled", False) for t in side):
        return "label"
    return None


def unit_scale(side):
    """The factor to SI of the units a side prints: those of its tokens multiplied, 1 without units."""
    scale = 1.0
    for t in side:
        if t.kind == "unit" and t.value is not None:
            scale *= t.value.scale
    return scale


def unit_label(side, dim):
    """The unit a side prints, as written, else the dimension in base units."""
    labels = [t.text for t in side if t.kind == "unit" and t.value is not None]
    return " ".join(labels) if labels else dim_text(dim)


def as_qty(v):
    if isinstance(v, Matrix):
        raise Unsupported("a matrix with a unit")
    return v if isinstance(v, Qty) else Qty(v, NO_DIM)


def near(x, y, tolerance=0.005):
    """Whether two numbers are within half a percent: what the rounding of a value carried over from another line
    explains."""
    if isinstance(x, Matrix) or isinstance(y, Matrix):
        return False
    try:
        return abs(x - y) <= tolerance * max(abs(x), abs(y))
    except OverflowError:
        return False


def uses_rounded(sides, rounded):
    """Whether a side names a value that was printed rounded somewhere in the solution (n = 4.0/2.02 = 1.98 mol): a
    relation built on it can miss the printed numbers by that rounding."""
    return bool(rounded) and any(
        t.text in rounded for side in sides for t in side
        if t.kind in ("letter", "label") or (t.kind == "cmd" and t.text[1:] in GREEK))


def has_decimals(sides):
    """Whether a chain prints a number with a decimal point or in scientific notation: a rounded value."""
    return any(t.kind == "num" and re.search(r"[.eE]", t.text) for side in sides for t in side)


def after_exponent(side, k):
    """The index after the exponent that starts at side[k]: a {group}, or a number with its sign."""
    if k < len(side) and side[k].text == "{":
        depth = 0
        while k < len(side):
            depth += (side[k].text == "{") - (side[k].text == "}")
            k += 1
            if depth == 0:
                break
        return k
    return k + 2 if k < len(side) and side[k].text in ("-", "+") else k + 1


def lacks_unit(side, env):
    """Whether a side multiplies in a number or a name without a unit after it (2.00 \\cdot 56\\,g/mol, m \\cdot g with
    g = 9.81): tutors leave units out of some factors. An exponent, and the 1.2 \\times 10^{-3} that a unit follows
    as a whole, do not count."""
    plain, qty = env.get("__plain__", {}), env.get("__qty__", {})
    k = 0
    while k < len(side):
        t = side[k]
        if t.kind == "op" and t.text == "^":
            k = after_exponent(side, k + 1)
            continue
        if t.kind == "num":
            j = k + 1
            if [x.text for x in side[j:j + 3]] in (["\\times", "10", "^"], ["\\cdot", "10", "^"], ["*", "10", "^"]):
                j = after_exponent(side, j + 3)
            nxt = side[j] if j < len(side) else None
            if not (nxt is not None and nxt.kind == "unit" and nxt.value is not None):
                return True
            k = j
            continue
        if (t.kind in ("letter", "label") or (t.kind == "cmd" and t.text[1:] in GREEK)) and t.text != "e":
            if t.text in plain and t.text not in qty:
                return True
        k += 1
    return False


def written(qs, side):
    """The numbers of quantities as they are printed with the units of the side: SI over the scale of its units."""
    scale = unit_scale(side)
    return [q.value / scale for q in qs]


def compare_units(rel, left, right, a, b, env=None):
    """("ok" | "failed" | "unknown", problem) for left rel right, both sides carrying units; a and b are their values.
    The dimensions must agree, and the values in SI; a printed rounding is read in the unit it is printed in."""
    env = env or {}
    qa, qb = [as_qty(v) for v in a], [as_qty(v) for v in b]
    kinds = [{q.dim for q in qs} for qs in (qa, qb)] + [{q.celsius for q in qs} for qs in (qa, qb)]
    if any(len(k) != 1 for k in kinds):
        raise Unsupported("values of different kinds")
    decimals, side = printed(rel, left, right)
    scale = unit_scale(side) if side is not None else 1.0
    xs, ys = [q.value / scale for q in qa], [q.value / scale for q in qb]
    rounded = uses_rounded([left, right], env.get("__rounded__"))
    if kinds[0] != kinds[1]:
        # 2.00 \cdot 56 g/mol = 112 g: a factor without its unit shows as a unit that does not fit, the numbers agree
        if (lacks_unit(left, env) or lacks_unit(right, env)) and any(
                holds(rel, p, q, decimals) or rounded and any(near(x, y) for x in p for y in q)
                for p, q in ((xs, ys), (written(qa, left), written(qb, right)))):
            return ("unknown", "a factor without a unit stands where the units do not match")
        return ("failed", f"units do not match: {kind_of(qa[0])} vs {kind_of(qb[0])}")
    if any(q.pt for q in qa + qb) and len({q.c_exp for q in qa + qb}) != 1:
        return ("unknown", "an absolute temperature in °C was used as a size, which is kelvin")
    text = f"{text_of(left)} {rel} {text_of(right)}"
    if kinds[2] != kinds[3]:                     # a temperature in °C against one in K
        if rel not in ("=", "~"):
            raise Unsupported("an inequality between °C and K")
        (celsius, c_side), (kelvin, k_side) = ((xs, left), (ys, right)) if qa[0].celsius else ((ys, right), (xs, left))
        for offset in (273.15, 273):             # 25 °C = 298.15 K, or 298 K as it is rounded
            if holds(rel, [c + offset for c in celsius], kelvin, decimals):
                return ("ok", None)
        if holds(rel, celsius, kelvin, decimals):
            return ("unknown", "the same number in °C and K is a difference of temperatures, not a temperature")
        return ("failed", f"{text} is false: {text_of(c_side)} is {show_all([c + 273.15 for c in celsius])} K, "
                          f"{text_of(k_side)} is {show_all(kelvin)} K")
    if holds(rel, xs, ys, decimals):
        return ("ok", None)
    if rounded and any(near(p.value, q.value) for p in qa for q in qb):
        return ("unknown", None)                 # off by what a rounded name from another line explains
    # the values are shown in the unit of the side that is a number with a unit
    shown = next((s for s in (right, left) if printed_number(s) is not None
                  and any(t.kind == "unit" and t.value is not None for t in s)), None)
    shown_scale = unit_scale(shown) if shown is not None else 1.0
    unit = unit_label(shown, qa[0].dim) if shown is not None else dim_text(qa[0].dim)
    return ("failed", f"{text} is false: {text_of(left)} is {show_all([q.value / shown_scale for q in qa])} {unit}, "
                      f"{text_of(right)} is {show_all([q.value / shown_scale for q in qb])} {unit}")


def unit_pair(rel, left, right, a, b, env=None):
    """compare_units for two neighbouring sides, unknown when something cannot be read."""
    if a is None or b is None:
        return ("unknown", "a unit could not be read")
    try:
        return compare_units(rel, left, right, a, b, env)
    except (Unsupported, ZeroDivisionError, ValueError, OverflowError) as e:
        return ("unknown", str(e) or None)


def combine_kinds(results):
    """One result for a chain checked in pieces: a failure first, then what is unknown, then what holds."""
    for kind in ("failed", "unknown", "mixed", "ok"):
        found = next((r for r in results if r[0] == kind), None)
        if found:
            return found
    return results[0] if results else ("unknown", None)


def converted(sides, rels, values, states, env):
    """The sides of a run with units and without compared in one unit: the unit sides in the unit of the printed
    result, the others as written. ("ok" | "failed", whether a unit was converted on the way) or None when nothing
    can be compared. 0.5 mol / 250 mL = 0.5 / 0.25 = 2 mol/L holds there, and does not as the numbers are written."""
    ref = next((s for s, v in reversed(list(zip(sides, values))) if v is not None and printed_number(s) is not None),
               None)
    scale = unit_scale(ref) if ref is not None else 1.0
    dim = None
    numbers, converted_units = [], False
    for side, v, state in zip(sides, values, states):
        if v is None:
            if state == "known":                 # a unit side that could not be evaluated cannot be converted
                return None
            try:
                numbers.append(evaluate(side, env))
            except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
                numbers.append(None)
            continue
        qs = [as_qty(x) for x in v]
        if len({(q.dim, q.celsius, q.c_exp) for q in qs}) != 1 or dim not in (None, qs[0].dim):
            return None
        dim = qs[0].dim
        numbers.append([q.value / scale for q in qs])
        try:
            plain = evaluate(side, env)
        except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
            continue
        converted_units = converted_units or any(
            abs(p) > 0 and abs(q.value / scale / p - 1) > 1e-9 for p, q in zip(plain, qs))
    seen = False
    for k, r in enumerate(rels):
        if numbers[k] is None or numbers[k + 1] is None:
            continue
        seen = True
        try:
            if not holds(r, numbers[k], numbers[k + 1], rounding(r, sides[k], sides[k + 1])):
                return ("failed", converted_units)
        except Unsupported:
            return None
    return ("ok", converted_units) if seen else None


def run_values(sides, rels, values, states, first, last, env, envs, functions):
    """check_values() for sides first..last of a chain with units in it. The numbers are compared as written ("n =
    4.0/2.016 = 1.98 mol"). A step that changes the unit on the way is compared in one unit instead; it stays
    unknown, not failed, where it does not match either and a unit was converted."""
    run, run_rels, run_vals = sides[first:last], rels[first:last - 1], values[first:last]
    run_states = states[first:last]
    result = check_values(run, run_rels, env, envs, functions)
    if result[0] != "failed" or all(v is None for v in run_vals) or all(v is not None for v in run_vals):
        return result
    try:
        again = converted(run, run_rels, run_vals, run_states, env)
    except (Unsupported, ZeroDivisionError, ValueError, OverflowError):
        return result
    if again is None:
        return result
    if again[0] == "ok":
        return ("ok", None)
    return ("unknown", None) if again[1] else result


def check_with_units(sides, rels, env, envs, functions, states):
    """A chain with units in it. Two neighbouring sides that both carry units must agree in dimension and, in SI, in
    value; any other pair is compared by its values, the unit being a label there ("n = 4.0/2.016 = 1.98 mol").
    Every side with a unit is also checked inside, so 5 m + 3 s fails whatever it is compared with."""
    uenv = dict(env)
    uenv["__units__"] = True
    values = []
    for side, state in zip(sides, states):
        values.append(None)
        if state != "known":
            continue
        try:
            values[-1] = evaluate(side, uenv)
        except UnitMismatch as e:
            return ("failed", str(e))
        except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
            pass
    results, start = [], 0
    for k, rel in enumerate(rels):
        if states[k] != "known" or states[k + 1] != "known":
            continue
        # the head of a chain is what the chain assigns (m = n \cdot M = ...), not a claim to check on its own
        head = start == 0 and k == 1 and rels[0] == "=" and simple_name(sides[0]) is not None
        if k > start and not head:
            results.append(run_values(sides, rels, values, states, start, k + 1, env, envs, functions))
        pair = unit_pair(rel, sides[k], sides[k + 1], values[k], values[k + 1], env)
        if pair[0] != "ok" and env.get("__qty_printed__") and uses_rounded(sides[k:k + 2], env.get("__rounded__")):
            pair = printed_pair(pair, rel, sides[k], sides[k + 1], env, uenv)
        results.append(pair)
        start = k + 1
    if len(sides) - start > 1:
        results.append(run_values(sides, rels, values, states, start, len(sides), env, envs, functions))
    return combine_kinds(results)


def printed_pair(pair, rel, left, right, env, uenv):
    """The result for two sides again with the names at the values as they were printed (1.98 mol and not the 1.9802
    mol that was computed): a tutor carries the printed number on. The earlier result stands unless this one holds."""
    printed_env = dict(uenv)
    printed_env["__qty__"] = {**env.get("__qty__", {}), **env["__qty_printed__"]}
    try:
        again = unit_pair(rel, left, right, evaluate(left, printed_env), evaluate(right, printed_env), env)
    except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
        return pair
    return again if again[0] == "ok" else pair


def molar_mass_of(side):
    """The molar mass in g/mol when a side is the name M(\\ce{H2O}) of a formula we know the weights of, else None."""
    if len(side) == 1 and side[0].kind == "label" and side[0].text.startswith("M(") and side[0].text.endswith(")"):
        return formula_mass(side[0].text[2:-1])
    return None


def check_molar_mass(sides, rels, env, envs, functions):
    """M(\\ce{H2O}) = 18.02\\,\\mathrm{g/mol}, also M_{\\ce{H2O}} = 2 \\cdot 1.008 + 16.00 = 18.02: every value given
    for the molar mass is compared with the standard atomic weights, within 0.5 %. The rest of the chain is checked
    as usual. None when no side is such a name."""
    found = [k for k, s in enumerate(sides) if molar_mass_of(s) is not None]
    if len(found) != 1 or found[0] not in (0, len(sides) - 1) or any(r not in ("=", "~") for r in rels):
        return None
    reference = molar_mass_of(sides[found[0]])
    formula = sides[found[0]][0].text[2:-1]
    rest, rest_rels = (sides[1:], rels[1:]) if found[0] == 0 else (sides[:-1], rels[:-1])
    uenv = dict(env)
    uenv["__units__"] = True
    for side in rest:
        state = unit_state(side, env)
        if state == "bad":
            return ("unknown", "a unit is not known")
        try:
            if state == "known":
                values = evaluate(side, uenv)
                if any(as_qty(v).dim != MOLAR_MASS for v in values):
                    return ("failed", f"units do not match: {kind_of(as_qty(values[0]))} vs g/mol")
                values = [as_qty(v).value * 1000 for v in values]        # kg/mol -> g/mol
            else:
                values = evaluate(side, env)
        except UnitMismatch as e:
            return ("failed", str(e))
        except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
            return ("unknown", None)
        # within the rounding of the places printed, as 2.0 g/mol is H2 (2.016): a place is 1000 \cdot scale g/mol
        places = places_of(side) if "~" in rels else numbers_of(side)
        slack = 0.5 * 10 ** -places * (1000 * unit_scale(side) if state == "known" else 1) if places is not None else 0
        for v in values:
            if isinstance(v, Matrix) or not (math.isfinite(v.real) and math.isfinite(v.imag)) or abs(v.imag) > 1e-9:
                return ("unknown", None)
            if abs(v.real - reference) > max(0.005 * reference, slack * (1 + 1e-9)):
                return ("failed", f"M({formula}) is {round(reference, 3):g} g/mol by the standard atomic weights, "
                                  f"not {show(v)} g/mol")
    if len(rest) > 1:
        done = check_statement(rest, rest_rels, env, envs, functions)
        if done[0] != "ok":
            return done
    return ("ok", None)


def check_safely(sides, rels, env, envs, functions):
    """check_statement(), where a bug costs the statement its verdict and not the whole solution."""
    try:
        return check_statement(sides, rels, env, envs, functions)
    except Exception:                            # never fail the other lines over a checker bug
        return ("unknown", None)


def printed_result(side, computed, env, uenv):
    """The quantity a chain prints as its result (1.98 mol), when it agrees with the one computed from the chain
    (1.9802 mol) within half a percent; None otherwise. A tutor carries the printed number on in the lines after."""
    if printed_number(side) is None or unit_state(side, env) != "known":
        return None
    try:
        shown = evaluate(side, uenv)
    except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
        return None
    if len(shown) != 1 or not isinstance(shown[0], Qty):
        return None
    q = shown[0]
    same = (q.dim, q.celsius, q.c_exp) == (computed.dim, computed.celsius, computed.c_exp)
    return q if same and near(q.value, computed.value) else None


def check_statement(sides, rels, env, envs, functions):
    """("ok" | "failed" | "unknown" | "assign" | "mixed", problem) for one chain of relations; "mixed" holds for
    some candidate values only. A molar mass is looked up first, units are read after, and the values are checked in
    check_values()."""
    if not rels:
        return ("unknown", None)
    done = check_molar_mass(sides, rels, env, envs, functions)
    if done is not None:
        return done
    states = [unit_state(s, env) for s in sides]
    if "bad" in states:
        bad = next(t.text for s in sides for t in s if t.kind == "badunit")
        return ("unknown", f"the unit {bad} is not known")
    if "known" in states:
        if "label" in states:
            return ("unknown", "a note stands where a unit is compared")
        return check_with_units(sides, rels, env, envs, functions, states)
    return check_values(sides, rels, env, envs, functions)


def check_values(sides, rels, env, envs, functions):
    """check_statement() for the values of a chain, units left aside."""
    text = " ".join(text_of(s) + (f" {r} " if i < len(rels) else "") for i, (s, r) in
                    enumerate(itertools.zip_longest(sides, rels, fillvalue="")))
    text = re.sub(r"\s+", " ", text).strip()
    if not rels:
        return ("unknown", None)
    head = function_head(sides[0])
    if head and len(sides) == 2 and functions.get(head[0], (None, None))[1] is sides[1]:
        return ("assign", None)                  # the definition of f itself
    try:
        names = []
        for s in sides:
            names += [n for n in free_variables(s, env) if n not in names]
        if not names:
            values = [evaluate(s, env) for s in sides]
            for k, r in enumerate(rels):
                if not holds(r, values[k], values[k + 1], rounding(r, sides[k], sides[k + 1])):
                    return ("failed", f"{text} is false: {text_of(sides[k])} is {show_all(values[k])}, "
                                      f"{text_of(sides[k + 1])} is {show_all(values[k + 1])}")
            return ("ok", None)
        if identity(sides, rels, env, names):
            return ("ok", None)
        lone = [simple_name(s) for s in sides]
        value_sides = [s for s, name in zip(sides, lone) if name is None]
        if labels_in(sides) and set(rels) == {"="} and len(value_sides) <= 1 and not labels_in(value_sides):
            # names given one value; see claims(). Not the value a chain computed for the name elsewhere: that fails.
            value = evaluate(value_sides[0], env) if value_sides else []
            for name in (n for n in lone if n and n in env["__derived__"]):
                places = numbers_of(value_sides[0]) if value_sides else None    # 1.98 for the 1.9802 computed
                if value and not any(equal(v, d, "=", places) for v in value for d in env["__derived__"][name]):
                    return ("failed", f"{text} is false: {name} is {show_all(value)} here, but "
                                      f"{show_all(env['__derived__'][name])} where it is computed")
            return ("assign", None)
        if simple_name(sides[0]) is not None and len(sides) == 2 and rels[0] == "=" and not labels_in(sides[1:]):
            return ("assign", None)
        if claims_function(sides[0], functions):
            return ("failed", f"{text} does not hold for every {names[0]}")
        covering = [e for e in envs if all(n in e for n in names)]
        if not covering:
            return partial(sides, rels, env, text) or ("unknown", None)
        verdicts = []
        for e in covering:
            values = [evaluate(s, e) for s in sides]
            held = [holds(r, values[k], values[k + 1], rounding(r, sides[k], sides[k + 1]))
                    for k, r in enumerate(rels)]
            close_by = all(h or any(near(x, y) for x in values[k] for y in values[k + 1]) for k, h in enumerate(held))
            verdicts.append((all(held), e, close_by))
        if all(ok for ok, _, _ in verdicts):
            return ("ok", None)
        if not any(ok for ok, _, _ in verdicts):
            if all(close_by for _, _, close_by in verdicts) and uses_rounded(sides, env.get("__rounded__")):
                return ("unknown", None)         # off by what a name rounded in another line explains
            where = ", ".join(f"{n} = {show(verdicts[0][1][n])}" for n in names)
            return ("failed", f"{text} does not hold for {where}")
        return ("mixed", None)
    except (Unsupported, FreeVariable) as e:
        return partial(sides, rels, env, text) or ("unknown", str(e))
    except (ZeroDivisionError, ValueError, OverflowError):
        return ("unknown", "a value is undefined")


def partial(sides, rels, env, text):
    """A chain that cannot be evaluated as a whole can still be wrong where two plain numbers stand side by side
    ("P(A) = \\frac{|A|}{|\\Omega|} = \\frac{3}{6} = \\frac{1}{3}"): that relation must hold. ("failed", why) or None.
    """
    values = []
    for side in sides:
        try:
            values.append(evaluate(side, env))
        except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
            values.append(None)
    for k, r in enumerate(rels):
        if values[k] is None or values[k + 1] is None:
            continue
        try:
            if not holds(r, values[k], values[k + 1], rounding(r, sides[k], sides[k + 1])):
                return ("failed", f"{text} is false: {text_of(sides[k])} is {show_all(values[k])}, "
                                  f"{text_of(sides[k + 1])} is {show_all(values[k + 1])}")
        except Unsupported:
            continue
    return None


def show_all(values):
    return " or ".join(show(v) for v in values)


def line_status(results):
    """A line joined by "and": failed when one relation fails, ok when all hold or assign."""
    kinds = [k for k, _ in results]
    failed = [p for k, p in results if k == "failed"]
    if failed:
        return {"status": "failed", "problem": failed[0]}
    # a claim that nothing checks does not spoil a line in which something else was checked
    if all(k in ("ok", "assign", "claim") for k in kinds) and ("claim" not in kinds or "ok" in kinds):
        return {"status": "ok"}
    problem = next((p for k, p in results if k == "unknown" and p), None)
    return {"status": "unknown", **({"problem": problem} if problem else {})}


def main(argv=None):
    try:
        data = json.loads(sys.stdin.read())
        lines = [str(x) for x in data.get("lines", [])][:40]
    except (ValueError, AttributeError):
        print(json.dumps({"lines": []}))
        return 0
    try:
        out = check_lines(lines)
    except Exception as e:                       # never fail the tour over a checker bug
        out = [{"status": "unknown", "problem": f"checker error: {type(e).__name__}"} for _ in lines]
    print(json.dumps({"lines": out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
