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
    f'(x) and f''(x) are checked by finite differences.
Anything else (sums, integrals, limits, words) is "unknown". Exit status 0 with JSON on stdout, also for bad input.
"""

import cmath
import itertools
import json
import math
import re
import sys

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


def add(a, b):
    if isinstance(a, Matrix) and isinstance(b, Matrix):
        return a.zip(b, lambda x, y: x + y)
    if isinstance(a, Matrix) or isinstance(b, Matrix):
        raise Unsupported("a number plus a matrix")
    return a + b


def neg(a):
    return a.map(lambda x: -x) if isinstance(a, Matrix) else -a


def mul(a, b):
    if isinstance(a, Matrix) and isinstance(b, Matrix):
        return a.matmul(b)
    if isinstance(a, Matrix):
        return a.map(lambda x: x * b)
    if isinstance(b, Matrix):
        return b.map(lambda x: a * x)
    return a * b


def div(a, b):
    if isinstance(b, Matrix):
        raise Unsupported("division by a matrix")
    return a.map(lambda x: x / b) if isinstance(a, Matrix) else a / b


def power(a, b):
    if isinstance(b, Matrix):
        raise Unsupported("a matrix exponent")
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


def close(a, b, rel=1e-7, absolute=1e-9):
    if isinstance(a, Matrix) or isinstance(b, Matrix):
        if not (isinstance(a, Matrix) and isinstance(b, Matrix)) or a.shape != b.shape:
            return False
        return all(close(x, y, rel, absolute) for r, s in zip(a.rows, b.rows) for x, y in zip(r, s))
    return abs(a - b) <= absolute + rel * max(abs(a), abs(b))


def show(v):
    if isinstance(v, Matrix):
        return "the matrix " + "; ".join(", ".join(show(x) for x in r) for r in v.rows)
    v = complex(v)
    if abs(v.imag) > 1e-9:
        return f"{v.real:.6g}{v.imag:+.6g}i"
    r = v.real
    return str(int(round(r))) if abs(r - round(r)) < 1e-9 else f"{r:.6g}"


# ---------------------------------------------------------------------------- tokens

GREEK = {"alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota",
         "kappa", "lambda", "mu", "nu", "xi", "rho", "sigma", "tau", "upsilon", "phi", "varphi", "chi", "psi",
         "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Sigma", "Phi", "Psi", "Omega"}
FUNCTIONS = {"sin": cmath.sin, "cos": cmath.cos, "tan": cmath.tan, "arcsin": cmath.asin, "arccos": cmath.acos,
             "arctan": cmath.atan, "sinh": cmath.sinh, "cosh": cmath.cosh, "tanh": cmath.tanh, "ln": cmath.log,
             "exp": cmath.exp, "lg": cmath.log10, "cot": lambda x: 1 / cmath.tan(x)}
RELATIONS = {"=": "=", "<": "<", ">": ">", "\\le": "<=", "\\leq": "<=", "\\leqslant": "<=", "\\ge": ">=",
             "\\geq": ">=", "\\geqslant": ">=", "\\neq": "!=", "\\ne": "!=", "\\approx": "~", "\\coloneqq": "=",
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
        "\\bm"}
UNIT = re.compile(r"^(?:[kcmµμn]?m|km/h|m/s|[kmµμ]?g|t|[mk]?l|s|min|h|ms|°|€|\$|eur|euro|usd|grad|stück|cent|ct)$",
                  re.I)
MATRIX_ENVS = {"pmatrix", "bmatrix", "Bmatrix", "vmatrix", "matrix", "smallmatrix"}
NOOP_ENVS = {"aligned", "align", "align*", "gathered", "gather", "gather*", "split", "equation", "equation*"}

TOKEN = re.compile(r"\\[a-zA-Z]+|\\.|\d+(?:\.\d+)?|[a-zA-Z]|:=|[^\s]")


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


def tokenize(src):
    """Tokens of one line: numbers, letters, commands, relations, separators ("and"/"or") and matrix markers."""
    src = (src.replace("{,}", ".").replace("−", "-").replace("–", "-").replace("·", "\\cdot ").replace("×", "\\times ")
           .replace("π", "\\pi ").replace("√", "\\sqrt ").replace("²", "^2").replace("³", "^3").replace("∞", "\\infty ")
           .replace("⋅", "\\cdot ").replace("÷", "\\div "))
    src = re.sub(r"(?<=\d),(?=\d)", ".", src)              # 1,5 is a German decimal
    out, i = [], 0
    while i < len(src):
        m = TOKEN.match(src, i)
        if m is None:
            i += 1
            continue
        t = m.group(0)
        j = m.end()
        if t.isspace():
            i = j
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
                values = combine(values, right, lambda a, b: add(a, neg(b)))
            else:
                values = combine(values, right, add) + combine(values, right, lambda a, b: add(a, neg(b)))
        return values

    def starts_atom(self):
        t = self.peek()
        if t is None:
            return False
        if t.kind in ("num", "letter", "begin"):
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
            elif t is not None and t.kind == "letter":
                self.take()
                exponent = [self.variable(t.text)]
            else:
                raise Unsupported("an exponent")
            base = combine(base, exponent, power)
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
        if "." in t.text:
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
                    values = combine(arg, base, lambda a, b: cmath.log(a) / cmath.log(b))
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
    v, degree = scalar(v), scalar(degree)
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
        if note or (top and t.kind in ("amp", "unit")):
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
        if out and (piece[0].isalnum() or piece.startswith("\\")) and (out[-1].isalnum()):
            out += " "
        out += piece
    return out


def simple_name(side):
    """The variable a side names on its own ("x", "x_1", "\\lambda_{2}"), or None."""
    p = Parser(side, {})
    t = p.take()
    if t is None:
        return None
    if t.kind == "letter" and t.text != "e":
        name = p.subscript(t.text)
    elif t.kind == "cmd" and t.text[1:] in GREEK:
        name = p.subscript(t.text)
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


def numbers_of(side):
    """A side's value when it is a plain decimal like 2.33, with its number of decimals; else None."""
    toks = side[1:] if side and side[0].kind == "op" and side[0].text == "-" else side
    if len(toks) == 1 and toks[0].kind == "num" and "." in toks[0].text:
        return len(toks[0].text.split(".")[1])
    return None


def evaluate(side, env):
    return Parser(side, env).whole()


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
    return {"<": x < y - 1e-12, ">": x > y + 1e-12, "<=": x <= y + 1e-9, ">=": x >= y - 1e-9}[rel]


def equal(x, y, rel, decimals):
    if rel == "~":
        return close(x, y, rel=0.01, absolute=0.006)
    if decimals is not None and not isinstance(x, Matrix) and not isinstance(y, Matrix):
        return abs(x - y) <= 0.5 * 10 ** -decimals + 1e-9 or close(x, y)
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


def check_lines(lines):
    """[(status, problem)] per line; see the module docstring."""
    parsed = []
    for line in lines:
        try:
            parts, joiner = split_line(tokenize(line))
            parsed.append(([chain(p) for p in parts], joiner, None))
        except Unsupported as e:
            parsed.append(([], "and", str(e)))

    # definitions (matrices, functions) and candidate values (assignments), in order
    env, functions, alternatives = {"__functions__": {}}, {}, {}
    env["__functions__"] = functions
    for statements, joiner, _ in parsed:
        for sides, rels in statements:
            if len(sides) < 2 or rels[0] != "=":
                continue
            head = function_head(sides[0])
            if head and head[0] not in functions:
                functions[head[0]] = (head[1], sides[1])
                continue
            name = simple_name(sides[0])
            if name is None:
                continue
            try:
                try:
                    values = evaluate(sides[1], env)
                except FreeVariable:              # "A = 2w \cdot w = 50": the chain ends in A's value
                    values = evaluate(sides[-1], env)
            except (Unsupported, FreeVariable, ZeroDivisionError, ValueError, OverflowError):
                continue
            if any(isinstance(v, Matrix) for v in values):
                if name not in env:
                    env[name] = values[0]
            else:
                known = alternatives.setdefault(name, [])
                known += [v for v in values if not any(close(v, k) for k in known)]
    # x_1 = 2, x_2 = 3 are values of x as well
    for name in list(alternatives):
        base = name.split("_", 1)[0]
        if base != name and base not in alternatives:
            alternatives.setdefault(base + "#", []).extend(alternatives[name])
    for name in [n for n in alternatives if n.endswith("#")]:
        values = alternatives.pop(name)
        alternatives[name[:-1]] = [v for i, v in enumerate(values) if not any(close(v, w) for w in values[:i])]
    names = sorted(alternatives)
    envs = []
    for combo in itertools.islice(itertools.product(*(alternatives[n] for n in names)), 16):
        local = dict(env)
        local.update(zip(names, combo))
        envs.append(local)

    out = []
    for statements, joiner, error in parsed:
        if error is not None or not statements:
            out.append({"status": "unknown"} if error is None else {"status": "unknown", "problem": error})
            continue
        results = [check_statement(sides, rels, env, envs, functions) for sides, rels in statements]
        out.append(line_status(results) if joiner == "and" else either(statements, results, envs))
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


def check_statement(sides, rels, env, envs, functions):
    """("ok" | "failed" | "unknown" | "assign" | "mixed", problem) for one chain of relations; "mixed" holds for
    some candidate values only."""
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
        decimals = [numbers_of(s) for s in sides]
        if not names:
            values = [evaluate(s, env) for s in sides]
            for k, r in enumerate(rels):
                d = decimals[k + 1] if decimals[k + 1] is not None else decimals[k]
                if not holds(r, values[k], values[k + 1], d):
                    return ("failed", f"{text} is false: {text_of(sides[k])} is {show_all(values[k])}, "
                                      f"{text_of(sides[k + 1])} is {show_all(values[k + 1])}")
            return ("ok", None)
        if identity(sides, rels, env, names):
            return ("ok", None)
        if simple_name(sides[0]) is not None and len(sides) == 2 and rels[0] == "=":
            return ("assign", None)
        if claims_function(sides[0], functions):
            return ("failed", f"{text} does not hold for every {names[0]}")
        covering = [e for e in envs if all(n in e for n in names)]
        if not covering:
            return ("unknown", None)
        verdicts = []
        for e in covering:
            values = [evaluate(s, e) for s in sides]
            ok = all(holds(r, values[k], values[k + 1], decimals[k + 1] if decimals[k + 1] is not None else
                           decimals[k]) for k, r in enumerate(rels))
            verdicts.append((ok, e))
        if all(ok for ok, _ in verdicts):
            return ("ok", None)
        if not any(ok for ok, _ in verdicts):
            where = ", ".join(f"{n} = {show(verdicts[0][1][n])}" for n in names)
            return ("failed", f"{text} does not hold for {where}")
        return ("mixed", None)
    except (Unsupported, FreeVariable) as e:
        return ("unknown", str(e))
    except (ZeroDivisionError, ValueError, OverflowError):
        return ("unknown", "a value is undefined")


def show_all(values):
    return " or ".join(show(v) for v in values)


def line_status(results):
    """A line joined by "and": failed when one relation fails, ok when all hold or assign."""
    kinds = [k for k, _ in results]
    failed = [p for k, p in results if k == "failed"]
    if failed:
        return {"status": "failed", "problem": failed[0]}
    if all(k in ("ok", "assign") for k in kinds):
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
