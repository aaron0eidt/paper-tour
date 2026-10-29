"""The solution checker: worked lines as a tutor writes them, right, wrong and beyond what it can check."""

import contextlib
import io
import json
import re
import unittest
from unittest import mock

import verify_math


def statuses(lines):
    return [r["status"] for r in verify_math.check_lines(lines)]


class VerifyMathTests(unittest.TestCase):
    def test_a_linear_equation_solved_step_by_step(self):
        self.assertEqual(statuses(["3x - 7 = 2x + 5", "x - 7 = 5", "x = 12"]), ["ok"] * 3)
        # German school notation: the operation applied to both sides, and a boxed result
        self.assertEqual(statuses(["3x - 7 = 2x + 5 \\quad | -2x", "x - 7 = 5 \\quad |\\, +7", "\\boxed{x = 12}"]),
                         ["ok"] * 3)

    def test_a_wrong_answer_fails_the_equation_it_does_not_solve(self):
        out = verify_math.check_lines(["3x - 7 = 2x + 5", "x = 5 + 6"])
        self.assertEqual([r["status"] for r in out], ["failed", "ok"])
        self.assertIn("does not hold for x = 11", out[0]["problem"])

    def test_arithmetic_with_rounding(self):
        out = verify_math.check_lines(["1 \\cdot 4 - 2 \\cdot 3 = -2", "1 \\cdot 4 - 2 \\cdot 3 = -1",
                                       "\\frac{7}{3} = 2.33", "\\frac{7}{3} = 2.4", "\\sqrt{2} \\approx 1.41",
                                       "\\frac12 + \\frac13 = \\frac56", "5\\% \\cdot 950 = 47.5"])
        self.assertEqual([r["status"] for r in out], ["ok", "failed", "ok", "failed", "ok", "ok", "ok"])
        self.assertIn("is -2", out[1]["problem"])

    def test_a_quadratic_with_the_pq_formula(self):
        lines = ["x^2 - 5x + 6 = 0", "x_{1,2} = \\frac{5}{2} \\pm \\sqrt{\\frac{25}{4} - 6}",
                 "x_{1,2} = \\frac{5}{2} \\pm \\frac{1}{2}", "x_1 = 3, \\quad x_2 = 2", "x_1 + x_2 = 5 = -p"]
        self.assertEqual(statuses(lines)[:4], ["ok"] * 4)
        self.assertEqual(statuses(["x^2 - 5x + 6 = 0", "x_1 = 4, \\quad x_2 = 1"])[0], "failed")
        # one root right and one wrong is not proof of an error: values of x may come from different cases
        self.assertEqual(statuses(["x^2 - 5x + 6 = 0", "x_1 = 3, \\quad x_2 = 1"])[0], "unknown")
        # a line joined by "or" needs one relation that holds
        self.assertEqual(statuses(["(x - 2)(x - 3) = 0", "x - 2 = 0 \\lor x - 3 = 0", "x = 2 \\text{ oder } x = 3"]),
                         ["ok"] * 3)

    def test_a_linear_system_by_substitution(self):
        lines = ["x + 2y = 5, \\quad 3x - y = 1", "x = 5 - 2y", "3(5 - 2y) - y = 1", "15 - 7y = 1", "y = 2",
                 "x = 5 - 2 \\cdot 2 = 1"]
        self.assertEqual(statuses(lines), ["ok"] * 6)
        self.assertEqual(statuses(["x + 2y = 5, \\quad 3x - y = 1", "y = 2", "x = 2"])[0], "failed")

    def test_matrices_and_determinants(self):
        lines = ["A = \\begin{pmatrix} 1 & 2 \\\\ 3 & -1 \\end{pmatrix}", "\\det A = 1 \\cdot (-1) - 2 \\cdot 3 = -7",
                 "\\det(A) = -5", "\\begin{vmatrix} 2 & 1 \\\\ 1 & 2 \\end{vmatrix} = 3",
                 "A^T = \\begin{pmatrix} 1 & 3 \\\\ 2 & -1 \\end{pmatrix}",
                 "A \\begin{pmatrix} 1 \\\\ 2 \\end{pmatrix} = \\begin{pmatrix} 5 \\\\ 1 \\end{pmatrix}"]
        self.assertEqual(statuses(lines), ["ok", "ok", "failed", "ok", "ok", "ok"])

    def test_a_function_and_its_derivatives(self):
        lines = ["f(x) = x^3 - 6x^2 + 9x + 1", "f'(x) = 3x^2 - 12x + 9",
                 "3x^2 - 12x + 9 = 0 \\Leftrightarrow x^2 - 4x + 3 = 0", "x = 1 \\text{ oder } x = 3",
                 "f''(x) = 6x - 12", "f''(1) = -6 < 0", "f(1) = 5"]
        self.assertEqual(statuses(lines), ["ok"] * 7)
        self.assertEqual(statuses(["f(x) = x^2", "f'(x) = x"])[1], "failed")

    def test_identities_units_and_a_word_problem(self):
        self.assertEqual(statuses(["\\frac{x^2 - 9}{x - 3} = \\frac{(x-3)(x+3)}{x-3} = x + 3"]), ["ok"])
        self.assertEqual(statuses(["2w + 2 \\cdot 2w = 30", "6w = 30", "w = 5\\,\\text{cm}",
                                   "A = 2w \\cdot w = 50\\,\\text{cm}^2"]), ["ok"] * 4)
        self.assertEqual(statuses(["\\sin(2x) = 2\\sin(x)\\cos(x)", "e^{\\ln 2} = 2"]), ["ok", "ok"])

    def test_probabilities_and_expectations_are_names_of_values(self):
        lines = ["P(\\text{says blue}) = 0.99 \\times 0.01 + 0.02 \\times 0.99 = 0.0297",
                 "P(\\text{blue} \\mid \\text{says blue}) = \\frac{0.0099}{0.0297} = \\frac{1}{3}",
                 "E[X|R_1=1]=1+11/7=18/7,\\; E[X|R_1=2]=2+20/7=34/7",
                 "E[X]=\\frac{1}{2}\\cdot \\frac{18}{7}+\\frac{1}{2}\\cdot \\frac{34}{7}=\\frac{26}{7}"]
        self.assertEqual(statuses(lines), ["ok"] * 4)
        # an expected value of a sum of fractions, and a variance whose E[X^2] nothing gives
        self.assertEqual(statuses(["\\mathbb{E}[X] = 3 \\cdot \\frac12 + 1 \\cdot \\frac12 = 2"]), ["ok"])
        self.assertEqual(statuses(["\\operatorname{Var}(X) = E[X^2] - E[X]^2 = 5 - 2^2 = 1"]), ["unknown"])
        # the same value written another way is the same name
        self.assertEqual(statuses(["P(A \\cap B) = 0.15", "P(A \\cap B) = \\Pr(A\\cap B) = 0.3 \\cdot 0.5 = 0.15"]),
                         ["ok", "ok"])

    def test_wrong_arithmetic_behind_a_name_fails(self):
        out = verify_math.check_lines([
            "P(\\text{says blue}) = 0.99 \\times 0.01 + 0.02 \\times 0.99 = 0.0397",
            "E[X|R_1=1]=1+11/7=19/7",
            "E[X]=\\frac{1}{2}\\cdot \\frac{18}{7}+\\frac{1}{2}\\cdot \\frac{34}{7}=\\frac{27}{7}",
            "P(A) = \\frac{|A|}{|\\Omega|} = \\frac{3}{6} = \\frac{1}{3}",
            "\\operatorname{Var}(X) = E[X^2] - E[X]^2 = 5 - 2^2 = 2"])
        self.assertEqual([r["status"] for r in out], ["failed"] * 5)
        self.assertIn("does not hold", out[0]["problem"])
        # two plain numbers side by side must agree even when the rest of the chain cannot be evaluated
        self.assertIn("is false", out[3]["problem"])
        self.assertEqual(statuses(["P(A) = \\frac{|A|}{|\\Omega|} = \\frac{3}{6} = \\frac{1}{2}"]), ["unknown"])

    def test_values_given_to_names_are_checked_where_they_are_used(self):
        lines = ["P(A) = 0.3", "P(B \\mid A) = 0.5",
                 "P(A \\cap B) = P(A) \\cdot P(B \\mid A) = 0.3 \\cdot 0.5 = 0.15"]
        self.assertEqual(statuses(lines), ["ok"] * 3)
        wrong = verify_math.check_lines(lines[:2] + [lines[2].replace("= 0.15", "= 0.2")])
        self.assertEqual([r["status"] for r in wrong], ["unknown", "unknown", "failed"])
        bayes = ["P(B|A) = \\frac{P(A|B)P(B)}{P(A)}", "P(A|B) = 0.9, P(B) = 0.01, P(A) = 0.05",
                 "P(B|A) = \\frac{0.9 \\cdot 0.01}{0.05} = 0.18"]
        self.assertEqual(statuses(bayes), ["ok"] * 3)
        self.assertEqual(statuses(bayes[:2] + [bayes[2].replace("0.18", "0.19")])[2], "failed")

    def test_a_name_with_just_a_value_is_a_claim_nothing_checks(self):
        self.assertEqual(statuses(["P(S=4)=\\frac{1}{4}", "P(I_i = 1) = \\frac{1}{3}"]), ["unknown"] * 2)
        both = "P(\\text{both} \\mid \\text{older}) = P(\\text{younger}) = \\frac{1}{2}"
        self.assertEqual(statuses([both]), ["unknown"])
        # a line in which something is computed carries its claims; a value stated again must be the computed one
        line = "P(S=4)=\\frac{1}{4},\\; P(S=6)=\\frac{1}{4},\\; P(S=8)=\\frac{2}{4}=\\frac{1}{2}"
        self.assertEqual(statuses([line, "P(S=8) = 0.5"]), ["ok", "ok"])
        again = verify_math.check_lines([line, "P(S=8) = \\frac{1}{3}"])
        self.assertEqual([r["status"] for r in again], ["ok", "failed"])
        self.assertIn("where it is computed", again[1]["problem"])
        # a sum cannot be checked, so the value it uses is not verified by it either
        self.assertEqual(statuses(["P(I_i = 1) = \\frac{1}{3}", "E[X] = \\sum_{i=1}^n P(I_i=1) = \\frac{n}{3}"]),
                         ["unknown", "unknown"])

    def test_names_do_not_swallow_ordinary_algebra(self):
        # P(1 + r) is a product (as before), P(x) a function nobody defined, E(2x) a product: never a name
        for line in ["K = P(1+r)", "P(x) = x^2 - 1", "E(2x) = 4"]:
            self.assertNotIn("label", [t.kind for t in verify_math.tokenize(line)], line)
        self.assertEqual(statuses(["P = 1000", "r = 0.05", "K = P \\cdot (1+r) = 1050"]), ["ok"] * 3)
        self.assertEqual(statuses(["P = 1000", "r = 0.05", "K = P \\cdot (1+r) = 1060"])[2], "failed")

    def test_approximations_round_to_the_places_they_print(self):
        right = ["\\frac13 \\approx 0.33", "\\frac13 \\approx 0.3", "\\sqrt{10} \\approx 3.2", "\\sqrt{10} \\approx 3",
                 "\\frac13 \\approx 33\\%", "\\frac13 \\approx 33.3 \\%", "17.5 \\approx 18", "\\pi \\simeq 3.14"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["\\frac13 \\approx 0.4", "\\sqrt{10} \\approx 4", "\\frac13 \\approx 40\\%", "2.4 \\approx 3"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))

    def test_percentages_and_notes_in_text(self):
        right = ["0.5 = 50\\%", "20\\% \\cdot 50 = 10", "\\frac{1}{8} = 12.5\\%",
                 "99 \\times 0.02 = 1.98 \\text{ says blue}", "0.5 \\text{ probability} = \\frac12",
                 "\\text{Fläche} = 3 \\cdot 4 = 12", "a = 2, b = 3, \\quad a + b = 5"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["0.25 = 30\\%", "20\\% \\cdot 50 = 12", "99 \\times 0.02 = 2.98 \\text{ says blue}",
                 "\\text{Fläche} = 3 \\cdot 4 = 13"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        out = verify_math.check_lines(["\\text{Fläche} = 3 \\cdot 4 = 13"])
        self.assertIn("fläche", out[0]["problem"])
        # words inside an expression, or in front of one, still stop the check
        mixed = "1\\text{ blue: }0.99\\text{ says blue}, \\quad 99\\text{ green: }99 \\times 0.02 = 1.98"
        self.assertEqual(statuses([mixed]), ["unknown"])

    def test_the_checker_never_executes_what_it_reads(self):
        with open(verify_math.__file__, encoding="utf-8") as f:
            source = f.read()
        self.assertIsNone(re.search(r"(?<![\\w.])(eval|exec|compile)\(|__import__|subprocess|os\.system", source))
        for line in ["__import__('os').system('echo hacked')", "P(__import__('os')) = 1", "E[exec('x=1')] = 2"]:
            self.assertEqual(statuses([line]), ["unknown"])

    def test_what_it_cannot_check_stays_unknown(self):
        lines = ["\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}", "\\sin 2x = 2 \\sin x \\cos x", "\\int_0^1 x\\,dx = \\frac12",
                 "\\text{Da } A \\text{ invertierbar ist, gilt } \\det A \\neq 0", "x + 3 = 8", "\\frac{x^2-9}{x-3}",
                 "\\begin{cases} 1 & x > 0 \\\\ 0 & \\text{sonst} \\end{cases}", "\\frac{1}{0} = 2", "{",
                 "6 : 2 = 3", "x = 1: f(1) = 2"]
        self.assertEqual([statuses([line])[0] for line in lines], ["unknown"] * len(lines))
        # a colon may label a case, so it never gives x a value
        self.assertEqual(statuses(["x = 1: f(1) = 2", "x + 3 = 8"]), ["unknown", "unknown"])

    def test_the_command_line_reads_and_writes_json(self):
        def run(stdin):
            out = io.StringIO()
            with mock.patch("sys.stdin", io.StringIO(stdin)), contextlib.redirect_stdout(out):
                self.assertEqual(verify_math.main(), 0)
            return json.loads(out.getvalue())

        self.assertEqual(run(json.dumps({"lines": ["1 + 1 = 2", "1 + 1 = 3"]}))["lines"][0], {"status": "ok"})
        self.assertEqual(run("not json"), {"lines": []})
        with mock.patch.object(verify_math, "check_lines", side_effect=RecursionError):
            self.assertEqual(run(json.dumps({"lines": ["x"]}))["lines"][0]["status"], "unknown")


if __name__ == "__main__":
    unittest.main()
