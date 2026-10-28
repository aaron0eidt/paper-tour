"""The solution checker: worked lines as a tutor writes them, right, wrong and beyond what it can check."""

import contextlib
import io
import json
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
