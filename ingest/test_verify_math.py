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

    def test_units_convert_to_si_before_two_sides_are_compared(self):
        right = ["0.5\\,\\mathrm{L} = 500\\,\\mathrm{mL}", "1.5\\,\\mathrm{kJ/mol} = 1500\\,\\mathrm{J/mol}",
                 "2\\,\\mathrm{g\\,mol^{-1}} = 2\\,\\mathrm{g/mol}", "0.1\\,\\mathrm{mol\\,L^{-1}} = 0.1\\,\\mathrm{M}",
                 "100\\,\\mathrm{kPa} = 1\\,\\mathrm{bar}", "1\\,\\mathrm{atm} = 101325\\,\\mathrm{Pa}",
                 "760\\,\\mathrm{mmHg} = 1\\,\\mathrm{atm}", "1\\,\\mathrm{h} = 60\\,\\mathrm{min}",
                 "1\\,\\mu\\mathrm{m} = 1000\\,\\mathrm{nm}", "1\\,\\mathrm{kN} = 1000\\,\\mathrm{N}",
                 "5\\,\\mathrm{M} = 5\\,\\mathrm{mol/L}", "1\\,\\mathrm{eV} = 1.602 \\cdot 10^{-19}\\,\\mathrm{J}",
                 "1\\,\\mathrm{cal} = 4.184\\,\\mathrm{J}", "1\\,\\mathrm{C} = 1\\,\\mathrm{A\\,s}",
                 "10\\,\\mathrm{cm} < 1\\,\\mathrm{m}", "1\\,\\mathrm{MHz} = 10^6\\,\\mathrm{Hz}",
                 # the spacings and the ways of writing a unit that tutors use
                 "5\\ \\mathrm{N} \\cdot 2\\,\\mathrm{m} = 10~\\mathrm{J}",
                 "60\\,\\mathrm{W} \\cdot 2\\,\\text{ s} = 120\\,\\text{ J}",
                 "10\\,\\Omega \\cdot 2\\,\\mathrm{A} = 20\\,\\mathrm{V}", "1\\,\\mathrm{kg} = 1000\\,\\text{g}",
                 # German notation: comma decimals
                 "0,5\\,\\mathrm{L} = 500\\,\\mathrm{mL}", "2,5\\,\\mathrm{kg} = 2500\\,\\mathrm{g}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["0.5\\,\\mathrm{L} = 400\\,\\mathrm{mL}", "1\\,\\mathrm{atm} = 1000\\,\\mathrm{Pa}",
                 "1\\,\\mathrm{h} = 100\\,\\mathrm{min}", "1\\,\\mu\\mathrm{m} = 100\\,\\mathrm{nm}",
                 "5\\,\\mathrm{M} = 5\\,\\mathrm{mol/m^3}", "10\\,\\mathrm{cm} > 1\\,\\mathrm{m}",
                 "0,5\\,\\mathrm{L} = 400\\,\\mathrm{mL}"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        out = verify_math.check_lines(["0.5\\,\\mathrm{L} = 400\\,\\mathrm{mL}"])
        self.assertIn("0.5 L is 500 mL", out[0]["problem"])

    def test_units_inside_expressions(self):
        right = ["n = \\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}",
                 "v = 9.81\\,\\mathrm{m/s^2} \\cdot 2.0\\,\\mathrm{s} = 19.6\\,\\mathrm{m/s}",
                 "c = \\frac{0.5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = 2\\,\\mathrm{M}",
                 "3\\,\\mathrm{m} \\cdot 4\\,\\mathrm{m} = 12\\,\\mathrm{m^2}",
                 "t = \\sqrt{\\frac{2 \\cdot 20\\,\\mathrm{m}}{9.81\\,\\mathrm{m/s^2}}} = 2.02\\,\\mathrm{s}",
                 "n = \\frac{4,0\\,\\mathrm{g}}{2,016\\,\\mathrm{g/mol}} = 1,98\\,\\mathrm{mol}",
                 "\\frac{12\\,\\mathrm{m}}{3\\,\\mathrm{m}} = 4",
                 "q = 100\\,\\mathrm{g} \\cdot 4.18\\,\\mathrm{J/(g\\,K)} \\cdot 20\\,\\mathrm{K} = 8360\\,\\mathrm{J}",
                 "p = \\frac{1\\,\\mathrm{mol} \\cdot 8.314\\,\\mathrm{J/(mol\\,K)} \\cdot 298\\,\\mathrm{K}}"
                 "{0.0244\\,\\mathrm{m^3}} = 1.0 \\times 10^{5}\\,\\mathrm{Pa}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        # n = 4.0/2.016 = 1.98 mol: a side without a unit against one with a unit compares the numbers
        plain = ["n = 4.0/2.016 = 1.98 \\text{ mol}", "n = 4.0/2.016 = 1.98\\,\\mathrm{mol}"]
        self.assertEqual(statuses(plain), ["ok"] * 2)
        self.assertEqual(statuses(["n = 4.0/2.016 = 2.5 \\text{ mol}"]), ["failed"])
        wrong = ["n = \\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 2.5\\,\\mathrm{mol}",
                 "v = 9.81\\,\\mathrm{m/s^2} \\cdot 2.0\\,\\mathrm{s} = 20.6\\,\\mathrm{m/s}",
                 "3\\,\\mathrm{m} \\cdot 4\\,\\mathrm{m} = 13\\,\\mathrm{m^2}",
                 "c = \\frac{0.5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = 4\\,\\mathrm{M}"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # the rounding is read in the unit it is printed in
        rounded = ["1.984\\,\\mathrm{mol} = 1984\\,\\mathrm{mmol}", "1.984\\,\\mathrm{mol} = 1.98\\,\\mathrm{mol}",
                   "1.984\\,\\mathrm{mol} = 1.99\\,\\mathrm{mol}",
                   "1.984\\,\\mathrm{mol} = 1.98 \\cdot 10^3\\,\\mathrm{mmol}"]
        self.assertEqual(statuses(rounded), ["ok", "ok", "failed", "ok"])

    def test_units_that_do_not_match_fail(self):
        out = verify_math.check_lines([
            "5\\,\\mathrm{g} = 5\\,\\mathrm{mol}",
            "n = \\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{g}",
            "v = 9.81\\,\\mathrm{m/s^2} \\cdot 2.0\\,\\mathrm{s} = 19.6\\,\\mathrm{m/s^2}",
            "5\\,\\mathrm{m} + 3\\,\\mathrm{s} = 8", "3\\,\\mathrm{m} \\cdot 4\\,\\mathrm{m} = 12\\,\\mathrm{m}",
            "c = \\frac{0.5\\,\\mathrm{mol}}{0.25\\,\\mathrm{L}} = 2\\,\\mathrm{mol}"])
        self.assertEqual([r["status"] for r in out], ["failed"] * 6)
        self.assertEqual(out[0]["problem"], "units do not match: g vs mol")
        self.assertIn("units do not match: mol vs g", out[1]["problem"])
        self.assertIn("m/s vs m/s^2", out[2]["problem"])
        self.assertIn("m vs s", out[3]["problem"])

    def test_units_it_cannot_read_stay_unknown(self):
        lines = ["5\\,\\mathrm{foo} = 5\\,\\mathrm{foo}", "5\\,\\mathrm{foo} = 6\\,\\mathrm{m}",
                 "2\\,\\mathrm{J/mol\\,K} = 2\\,\\mathrm{J\\,mol^{-1}\\,K^{-1}}",    # divides mol, or mol K?
                 "x\\,\\mathrm{mm} = 5\\,\\mathrm{m}",                               # x has no value
                 "5\\,\\text{apples} = 0.5\\,\\mathrm{kg}", "5\\,\\mathrm{lb} = 2.27\\,\\mathrm{kg}",
                 "3\\,\\mathrm{m} + 4 = 7\\,\\mathrm{m}"]
        self.assertEqual(statuses(lines), ["unknown"] * len(lines))
        # a note after a value is still a note
        notes = ["0.5 \\text{ probability} = \\frac12", "1.98 \\text{ mol of water} = 1.98"]
        self.assertEqual(statuses(notes), ["ok"] * 2)

    def test_units_given_to_names_are_used_where_the_names_are(self):
        lines = ["m = 4.0\\,\\mathrm{g}", "M = 2.016\\,\\mathrm{g/mol}", "n = \\frac{m}{M} = 1.98\\,\\mathrm{mol}",
                 "n = \\frac{m}{M} = \\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}"]
        self.assertEqual(statuses(lines), ["ok"] * 4)
        self.assertEqual(statuses(lines[:2] + ["n = \\frac{m}{M} = 1.98\\,\\mathrm{g}"])[2], "failed")
        self.assertEqual(statuses(lines[:2] + ["n = \\frac{m}{M} = 2.5\\,\\mathrm{mol}"])[2], "failed")
        # lines without units still use the number as it was written
        self.assertEqual(statuses(["w = 5\\,\\text{cm}", "6w = 30", "A = w \\cdot w = 25\\,\\text{cm}^2"]), ["ok"] * 3)
        self.assertEqual(statuses(["w = 5\\,\\text{cm}", "A = w \\cdot w = 25\\,\\text{cm}"])[1], "failed")
        # a name given a value is a claim, with a unit as well; it does not check itself
        self.assertEqual(statuses(["n(\\ce{H2}) = 0.5\\,\\mathrm{mol}", "P(A) = 0.5\\,\\mathrm{kg}"]), ["unknown"] * 2)
        # a symbol that stands for two things has no unit to give
        two = ["m = 4.0\\,\\mathrm{g}", "m = 2.0\\,\\mathrm{kg}", "m \\cdot 3 = 6\\,\\mathrm{kg}"]
        self.assertEqual(statuses(two)[2], "unknown")

    def test_temperatures_are_points_on_a_scale_and_sizes_in_a_product(self):
        heat = "q = 100\\,\\mathrm{g} \\cdot 4.18\\,\\mathrm{J/(g\\,^\\circ C)} \\cdot 20\\,^\\circ\\mathrm{C}"
        right = ["25\\,^\\circ\\mathrm{C} = 298.15\\,\\mathrm{K}", "25\\,^\\circ\\mathrm{C} = 298\\,\\mathrm{K}",
                 "d = 35\\,^\\circ\\mathrm{C} - 25\\,^\\circ\\mathrm{C} = 10\\,\\mathrm{K}",
                 heat + " = 8360\\,\\mathrm{J}", "0\\,^\\circ\\mathrm{C} = 273.15\\,\\mathrm{K}",
                 "20\\,^\\circ\\mathrm{C} = 20\\,^\\circ\\mathrm{C}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["25\\,^\\circ\\mathrm{C} = 300\\,\\mathrm{K}",
                 "d = 35\\,^\\circ\\mathrm{C} - 25\\,^\\circ\\mathrm{C} = 11\\,\\mathrm{K}",
                 heat + " = 8360\\,\\mathrm{kJ}"]
        self.assertEqual(statuses(wrong), ["failed"] * 3)
        # 25 °C = 25 K is a difference of temperatures at best: not for the checker to decide
        self.assertEqual(statuses(["25\\,^\\circ\\mathrm{C} = 25\\,\\mathrm{K}"]), ["unknown"])

    def test_scientific_notation_in_every_form_a_tutor_writes(self):
        right = ["1.2 \\times 10^{-3} = 0.0012", "1.2\\cdot10^{-3} = 0.0012", "1.2 \\cdot 10^{-3} = 0.0012",
                 "1.2e-3 = 0.0012", "1.2E-3 = 0.0012", "3.0e8 = 300000000", "2 \\times 10^{3} = 2000",
                 "1,2 \\cdot 10^{-3} = 0,0012", "1{,}2 \\times 10^{3} = 1200", "10^-3 = 0.001",
                 "1.2 \\cdot 10^{-3}\\,\\mathrm{mol} = 1.2\\,\\mathrm{mmol}",
                 "6.022 \\times 10^{23}\\,\\mathrm{mol^{-1}} = 6.022 \\times 10^{23}\\,\\mathrm{mol^{-1}}",
                 "6.022\\times10^{23}\\,\\mathrm{mol^{-1}} = 6.022e23\\,\\mathrm{mol^{-1}}",
                 "2.5\\times10^{2}\\,\\mathrm{g} = 0.25\\,\\mathrm{kg}",
                 # rounded to the places of the mantissa
                 "\\frac{0.0012}{0.6} = 2.0 \\times 10^{-3}", "0.0012345 = 1.23 \\times 10^{-3}",
                 "0.0012345 \\approx 1.2 \\times 10^{-3}", "6.022 \\times 10^{23} \\approx 6 \\times 10^{23}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["1.2 \\times 10^{-3} = 0.002", "1.2e-3 = 0.002", "1.2\\cdot10^{-3} = 0.012", "1.2e3 = 120",
                 "1.2 \\cdot 10^{-3}\\,\\mathrm{mol} = 2.0\\,\\mathrm{mmol}",
                 "\\frac{0.0012}{0.6} = 2.1 \\times 10^{-3}", "0.0012345 = 1.3 \\times 10^{-3}",
                 "1,2 \\cdot 10^{-3} = 0,002"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # 1.2e-3 was read as 1.2 times Euler's number, minus 3
        self.assertEqual([t.kind for t in verify_math.tokenize("1.2e-3")], ["num"])

    def test_a_reaction_balances_atoms_and_charge(self):
        right = ["\\ce{2H2 + O2 -> 2H2O}", "\\ce{CH4 + 2O2 -> CO2 + 2H2O}", "\\ce{N2 + 3H2 <=> 2NH3}",
                 "\\ce{2H2 + O2 <-> 2H2O}", "\\ce{2H2 + O2 = 2H2O}", "\\ce{2H2} + \\ce{O2} \\rightarrow \\ce{2H2O}",
                 "\\ce{2H2 + O2} \\rightleftharpoons \\ce{2H2O}", "\\ce{2H2 + O2 \\rightarrow 2H2O}",
                 "\\ce{Ca(OH)2 + 2HCl -> CaCl2 + 2H2O}", "\\ce{Fe^{3+} + 3OH- -> Fe(OH)3}",
                 "\\ce{Fe^3+ + 3OH^- -> Fe(OH)3(s)}", "\\ce{Fe^{2+} -> Fe^{3+} + e^-}",
                 "\\ce{Fe^2+ -> Fe^3+ + e-}", "\\ce{MnO4^- + 8H+ + 5Fe^{2+} -> Mn^{2+} + 5Fe^{3+} + 4H2O}",
                 "\\ce{MnO4- + 5 Fe^2+ + 8 H+ -> Mn^2+ + 5 Fe^3+ + 4 H2O}",
                 "\\ce{[Fe(CN)6]^{3-} + e^- -> [Fe(CN)6]^{4-}}", "\\ce{CuSO4.5H2O -> CuSO4 + 5H2O}",
                 "\\ce{CuSO4*5H2O -> CuSO4 + 5H2O}", "\\ce{CuSO4 \\cdot 5H2O -> CuSO4 + 5H2O}",
                 "\\ce{H2 + 1/2 O2 -> H2O}", "\\ce{H2 + 0.5 O2 -> H2O}", "\\ce{H2 + 0,5 O2 -> H2O}",
                 "\\ce{2H2(g) + O2(g) -> 2H2O(l)}", "\\ce{NaCl(aq) + AgNO3(aq) -> AgCl(s) + NaNO3(aq)}",
                 "\\ce{2H2O -> 2H2 + O2 + heat}", "\\ce{CaCO3 ->[\\Delta] CaO + CO2}",
                 "\\ce{2H2O ->[h\\nu] 2H2 + O2}", "\\ce{2 H2 + O2} \\xrightarrow{\\Delta} \\ce{2 H2O}",
                 "\\ce{2H2 + O2 -> 2H2O} \\;\\checkmark", "\\text{Probe: } \\ce{2H2 + O2 -> 2H2O}",
                 "\\ce{2H_2 + O_2 -> 2H_2O}", "\\ce{2H2+O2->2H2O}", "\\ce{AgNO3 + NaCl -> AgCl v + NaNO3}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        # one solution each: an equation followed by one over the same species is a step of balancing (see below)
        out = [verify_math.check_lines([line])[0] for line in [
            "\\ce{H2 + O2 -> H2O}", "\\ce{2H2 + O2 -> H2O}", "\\ce{Fe^{2+} -> Fe^{3+}}",
            "\\ce{2Na + Cl2 -> NaCl2}", "\\ce{CuSO4 \\cdot 5H2O -> CuSO4 + 4H2O}",
            "\\ce{MnO4- + Fe^2+ -> Mn^2+ + Fe^3+}", "\\ce{H2 + 1/2 O2 -> 2H2O}"]]
        self.assertEqual([r["status"] for r in out], ["failed"] * 7)
        self.assertEqual(out[0]["problem"], "O: 2 on the left, 1 on the right")
        self.assertIn("O: 2 on the left, 1 on the right", out[1]["problem"])
        self.assertIn("H: 4 on the left, 2 on the right", out[1]["problem"])
        self.assertEqual(out[2]["problem"], "charge: +2 on the left, +3 on the right")
        self.assertIn("Na: 2 on the left, 1 on the right", out[3]["problem"])
        self.assertIn("charge: +1 on the left, +5 on the right", out[5]["problem"])

    def test_a_reaction_it_cannot_read_stays_unknown(self):
        lines = ["\\ce{A -> B}", "\\ce{2H2 + Xx2 -> 2H2Xx}", "\\ce{^{14}C -> ^{14}N + e-}",
                 "\\ce{CaCO3 ->[foo] CaO + CO2}", "\\ce{NH3 + HCl -> NH4+Cl-}",
                 "\\ce{2H2O -> 2H2 + O2} \\text{ (electrolysis)}", "\\ce{H2O}", "\\ce{D2O -> D2 + O2}",
                 "\\ce{2 H2 + O2} \\xrightarrow[500 K]{Pt} \\ce{2 H2O}", "\\ce{H2 + O2 -> }"]
        self.assertEqual(statuses(lines), ["unknown"] * len(lines))

    def test_a_molar_mass_is_checked_against_the_standard_atomic_weights(self):
        right = ["M(\\ce{H2O}) = 18.02\\,\\mathrm{g/mol}", "\\text{M}(\\ce{H2O}) = 18.02\\,\\text{g/mol}",
                 "M_{\\ce{H2O}} = 18.02\\,\\mathrm{g\\,mol^{-1}}",
                 "M(\\ce{H2O}) = 2 \\cdot 1.008 + 16.00 = 18.02\\,\\mathrm{g/mol}",
                 "M(\\ce{H2O}) = 2 \\cdot 1.008 + 15.999 = 18.015\\,\\mathrm{g/mol}",
                 "M(\\ce{H2O}) = 18\\,\\mathrm{g/mol}", "M(\\ce{H2O}) = 18,02\\,\\mathrm{g/mol}",
                 "M(\\ce{NaCl}) = 58.44\\,\\mathrm{g/mol}", "M(\\ce{CO2}) = 44.01\\,\\mathrm{g/mol}",
                 "M(\\ce{CO2}) = 0.04401\\,\\mathrm{kg/mol}", "M(\\ce{Ca(OH)2}) = 74.09\\,\\mathrm{g/mol}",
                 "M(\\ce{CuSO4.5H2O}) = 249.7\\,\\mathrm{g/mol}", "M(\\ce{C6H12O6}) = 180.16\\,\\mathrm{g/mol}",
                 "M(\\ce{[Fe(CN)6]^{3-}}) = 211.96\\,\\mathrm{g/mol}", "M(\\ce{U}) = 238.03\\,\\mathrm{g/mol}",
                 "M(\\ce{Au}) = 197\\,\\mathrm{g/mol}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        out = verify_math.check_lines([
            "M(\\ce{H2O}) = 20\\,\\mathrm{g/mol}", "M(\\ce{H2O}) = 2 \\cdot 1.008 + 16.00 = 20\\,\\mathrm{g/mol}",
            "M(\\ce{Ca(OH)2}) = 80\\,\\mathrm{g/mol}", "M(\\ce{NaCl}) = 0.0584\\,\\mathrm{g/mol}",
            "M(\\ce{CO2}) = 44.01\\,\\mathrm{g}", "M(\\ce{H2O}) = 2 \\cdot 1.008 + 16.00 = 19.02\\,\\mathrm{g/mol}"])
        self.assertEqual([r["status"] for r in out], ["failed"] * 6)
        self.assertIn("18.015", out[0]["problem"])
        self.assertIn("18.015", out[1]["problem"])
        self.assertIn("74.092", out[2]["problem"])
        self.assertIn("units do not match", out[4]["problem"])
        # elements beyond uranium have no standard weight, and a formula it cannot read is a name with a value
        unread = ["M(\\ce{Og}) = 294\\,\\mathrm{g/mol}", "M(\\ce{XyZ}) = 18\\,\\mathrm{g/mol}"]
        self.assertEqual(statuses(unread), ["unknown"] * 2)
        # the table: elements 1 to 92, a few of them as IUPAC lists them
        self.assertEqual(len(verify_math.WEIGHTS), 92)
        picked = [verify_math.WEIGHTS[e] for e in ("H", "C", "O", "Fe", "U")]
        self.assertEqual(picked, [1.008, 12.011, 15.999, 55.845, 238.03])

    def test_a_ce_formula_is_a_name_in_other_relations(self):
        lines = ["n(\\ce{N2}) = \\frac{56.0\\,\\mathrm{g}}{28.0\\,\\mathrm{g/mol}} = 2.00\\,\\mathrm{mol}",
                 "m(\\ce{NH3}) = 2.00\\,\\mathrm{mol} \\cdot 17.0\\,\\mathrm{g/mol} = 34.0\\,\\mathrm{g}",
                 "[\\ce{H+}] = 0.01\\,\\mathrm{mol/L}", "\\mathrm{pH} = -\\log_{10}[\\ce{H+}] = 2"]
        self.assertEqual(statuses(lines), ["ok"] * 4)
        wrong = ["n(\\ce{N2}) = \\frac{56.0\\,\\mathrm{g}}{28.0\\,\\mathrm{g/mol}} = 2.50\\,\\mathrm{mol}",
                 "m(\\ce{NH3}) = 2.00\\,\\mathrm{mol} \\cdot 17.0\\,\\mathrm{g/mol} = 35.0\\,\\mathrm{g}"]
        self.assertEqual(statuses(wrong), ["failed"] * 2)
        # a name with just a value is a claim, and the formula is no number
        self.assertEqual(statuses(["n(\\ce{H2}) = 0.5\\,\\mathrm{mol}", "\\ce{H2O} = 18"]), ["unknown"] * 2)
        for line in ["n(\\ce{H2})", "M_{\\ce{H2O}}", "[\\ce{H+}]", "\\ce{H2O}"]:
            self.assertEqual([t.kind for t in verify_math.tokenize(line)], ["label"], line)

    def test_the_check_line_is_evaluated(self):
        right = ["5 \\cdot 3 + 2 = 17", "2(3)^2 - 18 = 0", "5 \\cdot 3 + 2 = 17 \\checkmark",
                 "5 \\cdot 3 + 2 = 17 \\;\\checkmark", "5 \\cdot 3 + 2 = 17 \\quad \\checkmark",
                 "\\text{Probe: } 5 \\cdot 3 + 2 = 17", "\\text{Probe: } 5 \\cdot 3 + 2 = 17 \\;\\checkmark",
                 "\\text{Kontrolle: } 2(3)^2 - 18 = 0 \\;\\checkmark", "\\text{Check: } 2 \\cdot 3 + 3 = 9",
                 "2(3)^2 - 18 = 0 \\Rightarrow 0 = 0 \\checkmark",
                 "2x + 3 = 11 \\Rightarrow 2x = 8 \\Rightarrow x = 4", "\\Rightarrow 3 + 4 = 7 \\checkmark",
                 "2 \\cdot 3 + 3 = 9 \\;\\Rightarrow\\; \\text{wahr}",
                 "\\text{Probe: } 2 \\cdot 3 + 3 = 9 \\Rightarrow \\text{wahr}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["5 \\cdot 3 + 2 = 18 \\checkmark", "\\text{Probe: } 5 \\cdot 3 + 2 = 18",
                 "\\text{Kontrolle: } 2(3)^2 - 18 = 1 \\;\\checkmark", "2(3)^2 - 18 = 0 \\Rightarrow 0 = 1 \\checkmark",
                 "\\text{Probe: } 2 \\cdot 3 + 3 = 10 \\Rightarrow \\text{wahr}"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # a word before a relation still names a value, and a colon in the maths is no heading
        self.assertEqual(statuses(["\\text{Fläche} = 3 \\cdot 4 = 12", "x = 1: f(1) = 2"]), ["ok", "unknown"])
        # the check of a solution, with the working above it
        working = ["2x + 3 = 11", "x = 4", "\\text{Probe: } 2 \\cdot 4 + 3 = 11 \\;\\checkmark"]
        self.assertEqual(statuses(working), ["ok"] * 3)

    def test_values_of_atomic_scale_are_told_apart_by_their_ratio(self):
        right = ["E = 6.626 \\times 10^{-34}\\,\\mathrm{J\\,s} \\cdot 5.0 \\times 10^{14}\\,\\mathrm{Hz} = 3.3 "
                 "\\times 10^{-19}\\,\\mathrm{J}",
                 "m = \\frac{1\\,\\mathrm{g/mol}}{6.022 \\times 10^{23}\\,\\mathrm{mol^{-1}}} = 1.66 \\times "
                 "10^{-24}\\,\\mathrm{g}",
                 "1\\,\\mathrm{eV} = 1.6 \\times 10^{-19}\\,\\mathrm{J}", "1.2e-12 = 1.2 \\times 10^{-12}",
                 "1\\,\\mathrm{eV} < 2 \\times 10^{-19}\\,\\mathrm{J}", "3 \\times 10^{-19} > 2 \\times 10^{-19}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["E = 6.626 \\times 10^{-34}\\,\\mathrm{J\\,s} \\cdot 5.0 \\times 10^{14}\\,\\mathrm{Hz} = 9.9 "
                 "\\times 10^{-19}\\,\\mathrm{J}",
                 "1\\,\\mathrm{eV} = 5 \\times 10^{-19}\\,\\mathrm{J}", "1.2e-12 = 7.5e-12",
                 "m = \\frac{1\\,\\mathrm{g/mol}}{6.022 \\times 10^{23}\\,\\mathrm{mol^{-1}}} = 5.0 \\times "
                 "10^{-24}\\,\\mathrm{g}",
                 "1\\,\\mathrm{eV} > 2 \\times 10^{-19}\\,\\mathrm{J}", "5 \\times 10^{-19} \\le 1 \\times 10^{-19}"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # the value in the reason is not rounded to zero
        problem = verify_math.check_lines([wrong[1]])[0]["problem"]
        self.assertIn("1.60218e-19 J", problem)
        self.assertNotIn(" 0 J", problem)
        # the same margin for sums and noise around zero as before
        self.assertEqual(statuses(["0.1 + 0.2 = 0.3", "\\sin(\\pi) = 0", "0.1 + 0.2 - 0.3 \\le 0"]), ["ok"] * 3)

    def test_approx_with_no_places_printed_needs_a_relative_match(self):
        right = ["\\lambda = \\frac{3.0 \\times 10^8\\,\\mathrm{m/s}}{5.0 \\times 10^{14}\\,\\mathrm{Hz}} \\approx "
                 "6 \\times 10^{-7}\\,\\mathrm{m}",
                 "n = \\frac{0.1\\,\\mathrm{g}}{58.44\\,\\mathrm{g/mol}} \\approx 0.0017\\,\\mathrm{mol}",
                 "c = \\frac{0.002\\,\\mathrm{mol}}{1\\,\\mathrm{L}} \\approx 0.002\\,\\mathrm{mol/L}",
                 "\\frac13 \\approx 0.33"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["\\lambda = \\frac{3.0 \\times 10^8\\,\\mathrm{m/s}}{5.0 \\times 10^{14}\\,\\mathrm{Hz}} \\approx "
                 "9 \\times 10^{-7}\\,\\mathrm{m}",
                 "n = \\frac{0.1\\,\\mathrm{g}}{58.44\\,\\mathrm{g/mol}} \\approx 0.005\\,\\mathrm{mol}",
                 "c = \\frac{0.002\\,\\mathrm{mol}}{1\\,\\mathrm{L}} \\approx 0.007\\,\\mathrm{mol/L}",
                 "\\frac13 \\approx 0.4"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))

    def test_the_worked_examples_of_the_tutor_have_no_failed_line(self):
        # the free-fall example of exercise-examples.ts: steps, answer and check
        physics = ["h = \\frac{1}{2} g t^2", "t^2 = \\frac{2h}{g}",
                   "t^2 = \\frac{2 \\cdot 20\\,\\mathrm{m}}{9.81\\,\\mathrm{m/s^2}}", "t^2 = 4.08\\,\\mathrm{s^2}",
                   "t = \\sqrt{4.08\\,\\mathrm{s^2}} = 2.02\\,\\mathrm{s}", "t \\approx 2.0\\,\\mathrm{s}",
                   "\\frac{1}{2} \\cdot 9.81\\,\\mathrm{m/s^2} \\cdot (2.02\\,\\mathrm{s})^2 = 20.0\\,\\mathrm{m}"]
        got = statuses(physics)
        self.assertNotIn("failed", got)
        self.assertEqual(got[3:], ["ok"] * 4)
        # t^2 = 4.08 against 40/9.81 = 4.0775: rounding from the line below, so unknown and not failed
        self.assertEqual(got[2], "unknown")
        # the stoichiometry example: every line holds
        chemistry = ["n = \\frac{m}{M}", "\\ce{2H2 + O2 -> 2H2O}",
                     "n(\\ce{H2}) = \\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}",
                     "n(\\ce{H2O}) = n(\\ce{H2}) = 1.98\\,\\mathrm{mol}",
                     "m(\\ce{H2O}) = 1.98\\,\\mathrm{mol} \\cdot 18.02\\,\\mathrm{g/mol} = 35.7\\,\\mathrm{g}",
                     "m(\\ce{H2O}) \\approx 36\\,\\mathrm{g}",
                     "4.0\\,\\mathrm{g} \\cdot \\frac{18.02}{2.02} = 35.7\\,\\mathrm{g}"]
        self.assertEqual(statuses(chemistry), ["ok"] * len(chemistry))
        # wrong numbers in the same lines are still caught
        self.assertEqual(statuses(physics[:2] + [physics[2] + " = 4.10\\,\\mathrm{s^2}"] + physics[3:])[2], "failed")
        self.assertEqual(statuses(physics[:3] + ["t^2 = 4.50\\,\\mathrm{s^2}"] + physics[4:])[3], "failed")
        for index, wrong in [(3, "n(\\ce{H2O}) = n(\\ce{H2}) = 2.5\\,\\mathrm{mol}"),
                             (4, "m(\\ce{H2O}) = 1.98\\,\\mathrm{mol} \\cdot 18.02\\,\\mathrm{g/mol} = "
                                 "38.7\\,\\mathrm{g}"),
                             (6, "4.0\\,\\mathrm{g} \\cdot \\frac{18.02}{2.02} = 40.7\\,\\mathrm{g}")]:
            self.assertEqual(statuses(chemistry[:index] + [wrong] + chemistry[index + 1:])[index], "failed", wrong)

    def test_rounded_values_carried_into_later_lines(self):
        lines = ["n = \\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}",
                 "M = 18.02\\,\\mathrm{g/mol}",
                 "m = n \\cdot M = 1.98\\,\\mathrm{mol} \\cdot 18.02\\,\\mathrm{g/mol} = 35.7\\,\\mathrm{g}"]
        self.assertEqual(statuses(lines), ["ok"] * 3)
        self.assertEqual(statuses(lines[:2] + [lines[2].replace("35.7", "38.7")])[2], "failed")
        n2 = ["n(\\ce{N2}) = \\frac{56.0\\,\\mathrm{g}}{28.02\\,\\mathrm{g/mol}} = 2.00\\,\\mathrm{mol}",
              "n(\\ce{NH3}) = 2 \\cdot n(\\ce{N2}) = 4.00\\,\\mathrm{mol}"]
        self.assertEqual(statuses(n2), ["ok"] * 2)
        self.assertEqual(statuses(n2[:1] + [n2[1].replace("4.00", "4.50")])[1], "failed")
        h2o = [n2[0], "n(\\ce{H2}) = \\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}",
               "m(\\ce{H2O}) = n(\\ce{H2}) \\cdot 18.02\\,\\mathrm{g/mol} = 35.7\\,\\mathrm{g}"]
        self.assertEqual(statuses(h2o), ["ok"] * 3)
        self.assertEqual(statuses(h2o[:2] + [h2o[2].replace("35.7", "38.7")])[2], "failed")
        # a value that was printed with a point is rounded; whole numbers stay exact
        self.assertEqual(statuses(["x = 12", "\\frac{x}{3} = 4.01"])[1], "failed")
        self.assertEqual(statuses(["a = \\frac{4.0}{2.02} = 1.98", "b = 2 \\cdot a = 3.96"])[1], "unknown")
        self.assertEqual(statuses(["a = \\frac{4.0}{2.02} = 1.98", "b = 2 \\cdot a = 4.5"])[1], "failed")
        # a restated value is read with the rounding it prints
        restated = ["n(\\ce{H2}) = \\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}",
                    "n(\\ce{H2O}) = n(\\ce{H2}) = 1.98\\,\\mathrm{mol}"]
        self.assertEqual(statuses(restated), ["ok"] * 2)
        self.assertEqual(statuses([restated[0], "n(\\ce{H2O}) = n(\\ce{H2}) = 2.5\\,\\mathrm{mol}"])[1], "failed")

    def test_balancing_an_equation_step_by_step(self):
        steps = ["\\ce{C3H8 + O2 -> CO2 + H2O}", "\\ce{C3H8 + O2 -> 3CO2 + H2O}", "\\ce{C3H8 + O2 -> 3CO2 + 4H2O}",
                 "\\ce{C3H8 + 5O2 -> 3CO2 + 4H2O}"]
        self.assertEqual(statuses(steps), ["unknown"] * 3 + ["ok"])
        # the last line of an equation is the one that has to balance; another equation is no step of it
        self.assertEqual(statuses(steps[:3]), ["unknown", "unknown", "failed"])
        self.assertEqual(statuses([steps[0], "\\ce{CH4 + 2O2 -> CO2 + 2H2O}"]), ["failed", "ok"])
        self.assertEqual(statuses([steps[0], steps[3].replace("5O2", "6O2")]), ["unknown", "failed"])
        # states and coefficients do not make another equation
        self.assertEqual(statuses(["\\ce{H2 + O2 -> H2O}", "\\ce{2H2(g) + O2(g) -> 2H2O(l)}"]), ["unknown", "ok"])

    def test_two_reactions_on_one_line_are_checked_one_by_one(self):
        right = ["\\ce{2H2 + O2 -> 2H2O} \\qquad \\ce{N2 + 3H2 -> 2NH3}",
                 "\\ce{2H2 + O2 -> 2H2O} \\quad \\ce{N2 + 3H2 -> 2NH3}",
                 "\\ce{H2 -> 2H+ + 2e-} \\quad \\ce{O2 + 4H+ + 4e- -> 2H2O}",
                 "\\ce{2H2} + \\ce{O2} \\rightarrow \\ce{2H2O} \\qquad \\ce{N2 + 3H2 -> 2NH3}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        out = [verify_math.check_lines([line])[0] for line in [
            "\\ce{2H2 + O2 -> 2H2O} \\qquad \\ce{N2 + 3H2 -> 2NH4}",
            "\\ce{H2 + O2 -> 2H2O} \\qquad \\ce{N2 + 3H2 -> 2NH3}"]]
        self.assertEqual([r["status"] for r in out], ["failed"] * 2)
        self.assertIn("H: 6 on the left, 8 on the right", out[0]["problem"])
        self.assertEqual(statuses(["\\ce{2H2 + O2 -> 2H2O} \\qquad \\ce{N2 + Xx3 -> 2NH3}"]), ["unknown"])
        # a group beside a bare formula is no pair of reactions
        self.assertEqual(statuses(["\\ce{2H2 + O2 -> 2H2O} \\qquad \\ce{H2O}"]), ["unknown"])

    def test_net_ionic_equations_with_states(self):
        right = ["\\ce{Ag+(aq) + Cl-(aq) -> AgCl(s)}", "\\ce{NaCl(s) -> Na+(aq) + Cl-(aq)}",
                 "\\ce{Fe^3+(aq) + 3OH-(aq) -> Fe(OH)3(s)}", "\\ce{Fe^{3+}(aq) + 3OH^-(aq) -> Fe(OH)3(s)}",
                 "\\ce{Ba^2+(aq) + SO4^2-(aq) -> BaSO4(s)}", "\\ce{H+(aq) + OH-(aq) -> H2O(l)}",
                 "\\ce{Ag+ (aq) + Cl- (aq) -> AgCl (s)}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["\\ce{Ag+(aq) + 2Cl-(aq) -> AgCl(s)}", "\\ce{Ag+(aq) + Cl-(aq) -> AgCl2(s)}",
                 "\\ce{Fe^3+(aq) + 2OH-(aq) -> Fe(OH)3(s)}",
                 "\\ce{Ba^2+(aq) + SO4^2-(aq) -> BaSO4(s)} \\ce{Ag+ -> Ag}"]
        got = [verify_math.check_lines([line])[0] for line in wrong[:3]]
        self.assertEqual([r["status"] for r in got], ["failed"] * 3)
        self.assertIn("charge: -1 on the left, 0 on the right", got[0]["problem"])
        self.assertIn("charge: +1 on the left, 0 on the right", got[2]["problem"])
        # NH4+Cl- is still told apart from a plus between two ions only by a space
        self.assertEqual(statuses(["\\ce{NH3 + HCl -> NH4+Cl-}"]), ["unknown"])

    def test_a_temperature_in_a_product_is_kelvin_only_when_a_unit_per_degree_says_so(self):
        right = ["q = 100\\,\\mathrm{g} \\cdot 4.18\\,\\mathrm{J/(g\\,^\\circ C)} \\cdot 20\\,^\\circ\\mathrm{C} = "
                 "8360\\,\\mathrm{J}",
                 "20\\,^\\circ\\mathrm{C} \\cdot 100\\,\\mathrm{g} \\cdot 4.18\\,\\mathrm{J/(g\\,^\\circ C)} = "
                 "8360\\,\\mathrm{J}",
                 "4.18\\,\\mathrm{J/(g\\,^\\circ C)} \\cdot 20\\,^\\circ\\mathrm{C} = 83.6\\,\\mathrm{J/g}",
                 "c = \\frac{8360\\,\\mathrm{J}}{100\\,\\mathrm{g} \\cdot 20\\,^\\circ\\mathrm{C}} = "
                 "4.18\\,\\mathrm{J/(g\\,^\\circ C)}",
                 "V = \\frac{1\\,\\mathrm{mol} \\cdot 8.314\\,\\mathrm{J/(mol\\,K)} \\cdot "
                 "293\\,\\mathrm{K}}{101325\\,\\mathrm{Pa}} = 2.40 \\times 10^{-2}\\,\\mathrm{m^3}",
                 "d = 35\\,^\\circ\\mathrm{C} - 25\\,^\\circ\\mathrm{C} = 10\\,\\mathrm{K}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        # the classic mistake: °C where kelvin is due. The true volume is 2.41e-2 m^3, so this must not be ok
        gas = ["V = \\frac{1\\,\\mathrm{mol} \\cdot 8.314\\,\\mathrm{J/(mol\\,K)} \\cdot "
               "20\\,^\\circ\\mathrm{C}}{101325\\,\\mathrm{Pa}} = 1.64 \\times 10^{-3}\\,\\mathrm{m^3}",
               "1\\,\\mathrm{mol} \\cdot 8.314\\,\\mathrm{J/(mol\\,K)} \\cdot 20\\,^\\circ\\mathrm{C} = "
               "166\\,\\mathrm{J}",
               "2 \\cdot 20\\,^\\circ\\mathrm{C} = 40\\,\\mathrm{K}",
               "(20\\,^\\circ\\mathrm{C})^2 = 400\\,\\mathrm{K^2}"]
        self.assertNotIn("ok", statuses(gas))
        wrong = ["c = \\frac{8360\\,\\mathrm{J}}{100\\,\\mathrm{g} \\cdot 20\\,^\\circ\\mathrm{C}} = "
                 "8.18\\,\\mathrm{J/(g\\,^\\circ C)}",
                 "4.18\\,\\mathrm{J/(g\\,^\\circ C)} \\cdot 20\\,^\\circ\\mathrm{C} = 83.6\\,\\mathrm{J}"]
        self.assertEqual(statuses(wrong), ["failed"] * 2)
        # the names carry it too
        names = ["n = 1\\,\\mathrm{mol}", "R = 8.314\\,\\mathrm{J/(mol\\,K)}", "T = 20\\,^\\circ\\mathrm{C}",
                 "p = 101325\\,\\mathrm{Pa}",
                 "V = \\frac{n R T}{p} = \\frac{1\\,\\mathrm{mol} \\cdot 8.314\\,\\mathrm{J/(mol\\,K)} \\cdot "
                 "20\\,^\\circ\\mathrm{C}}{101325\\,\\mathrm{Pa}} = 1.64 \\times 10^{-3}\\,\\mathrm{m^3}"]
        self.assertNotEqual(statuses(names)[4], "ok")

    def test_a_step_without_units_may_convert_units(self):
        right = ["c = \\frac{0.5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = \\frac{0.5}{0.25} = 2\\,\\mathrm{mol/L}",
                 "v = \\frac{36\\,\\mathrm{km}}{0.5\\,\\mathrm{h}} = \\frac{36000}{1800} = 20\\,\\mathrm{m/s}",
                 "p = \\frac{F}{A} = \\frac{200\\,\\mathrm{N}}{4\\,\\mathrm{cm^2}} = \\frac{200}{0.0004} = 5 "
                 "\\times 10^5\\,\\mathrm{Pa}",
                 "c = \\frac{0,5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = \\frac{0,5}{0,25} = 2\\,\\mathrm{M}",
                 "n = 4.0/2.016 = 1.98\\,\\mathrm{mol}",
                 "w = \\frac{36\\,\\mathrm{m}}{2\\,\\mathrm{s}} = \\frac{36}{2} = 18\\,\\mathrm{m/s}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        # where a unit was converted on the way and the numbers match neither way, nothing is concluded
        converted = ["c = \\frac{0.5\\,\\mathrm{mol}}{250\\,\\mathrm{mL}} = \\frac{0.5}{0.25} = 3\\,\\mathrm{mol/L}",
                     "v = \\frac{36\\,\\mathrm{km}}{0.5\\,\\mathrm{h}} = \\frac{36000}{1800} = 25\\,\\mathrm{m/s}"]
        self.assertEqual(statuses(converted), ["unknown"] * 2)
        # without a conversion the numbers have to match
        wrong = ["n = 4.0/2.016 = 2.5\\,\\mathrm{mol}",
                 "v = \\frac{36\\,\\mathrm{m}}{2\\,\\mathrm{s}} = \\frac{36}{2} = 19\\,\\mathrm{m/s}"]
        self.assertEqual(statuses(wrong), ["failed"] * 2)

    def test_a_factor_without_its_unit_does_not_fail_a_line_whose_numbers_agree(self):
        lines = ["m(\\ce{Fe}) = 2{,}00 \\cdot 56\\,\\mathrm{g/mol} = 112\\,\\mathrm{g}",
                 "m = 2.00 \\cdot 17.0\\,\\mathrm{g/mol} = 34.0\\,\\mathrm{g}",
                 "m = 2.00 \\cdot 0.056\\,\\mathrm{kg/mol} = 112\\,\\mathrm{g}"]
        self.assertEqual(statuses(lines), ["unknown"] * 3)
        self.assertEqual(statuses(["m = 2.0\\,\\mathrm{kg}", "g = 9.81",
                                   "F = m \\cdot g = 19.6\\,\\mathrm{N}"])[2], "unknown")
        # the numbers have to agree, and the units to be left out of a factor and not the result
        wrong = ["m = 2.00 \\cdot 56\\,\\mathrm{g/mol} = 150\\,\\mathrm{g}", "5\\,\\mathrm{g} = 5\\,\\mathrm{mol}",
                 "m = 2.0\\,\\mathrm{kg}",
                 "n = \\frac{4.0\\,\\mathrm{g}}{2.016\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{g}"]
        self.assertEqual(statuses(wrong[:2]) + statuses(wrong[3:]), ["failed"] * 3)

    def test_a_molar_mass_may_be_rounded_to_the_places_printed(self):
        right = ["M(\\ce{H2}) = 2.0\\,\\mathrm{g/mol}", "M(\\ce{NaCl}) \\approx 58\\,\\mathrm{g/mol}",
                 "M(\\ce{HCl}) \\approx 36\\,\\mathrm{g/mol}", "M(\\ce{CO2}) = 0.044\\,\\mathrm{kg/mol}",
                 "M(\\ce{H2}) = 2,0\\,\\mathrm{g/mol}", "M(\\ce{C6H12O6}) = 180\\,\\mathrm{g/mol}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["M(\\ce{NaCl}) \\approx 60\\,\\mathrm{g/mol}", "M(\\ce{H2}) = 2.2\\,\\mathrm{g/mol}",
                 "M(\\ce{CO2}) = 0.045\\,\\mathrm{kg/mol}", "M(\\ce{HCl}) = 37\\,\\mathrm{g/mol}"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # an infinite value is no value
        self.assertEqual(statuses(["M(\\ce{H2O}) = 1e400\\,\\mathrm{g/mol}", "M(\\ce{H2O}) = 1e400",
                                   "M(\\ce{H2O}) = 1 - 1e400"]),
                         ["unknown"] * 3)

    def test_prefixes_before_ohm_and_ms_with_a_negative_power(self):
        right = ["R = 2.2\\,\\mathrm{M}\\Omega = 2.2 \\times 10^{6}\\,\\Omega",
                 "R = 5\\,\\mathrm{m}\\Omega = 0.005\\,\\Omega",
                 "R = 5\\,\\mathrm{k}\\Omega = 5000\\,\\Omega", "1\\,\\mathrm{M}\\Omega = 1000\\,\\mathrm{k}\\Omega",
                 "1\\,\\mathrm{M} = 1\\,\\mathrm{mol/L}", "5\\,\\mathrm{ms} = 0.005\\,\\mathrm{s}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        wrong = ["R = 2.2\\,\\mathrm{M}\\Omega = 2.2 \\times 10^{3}\\,\\Omega",
                 "R = 5\\,\\mathrm{m}\\Omega = 0.5\\,\\Omega",
                 "5\\,\\mathrm{ms} = 0.5\\,\\mathrm{s}"]
        self.assertEqual(statuses(wrong), ["failed"] * 3)
        # ms^{-2} is metres per second squared as often as per millisecond squared: not for the checker to say
        ambiguous = ["v = 9.81\\,\\text{ms}^{-2} \\cdot 2.0\\,\\text{s} = 19.6\\,\\text{ms}^{-1}",
                     "v = 9.81\\,\\mathrm{ms^{-2}} \\cdot 2.0\\,\\mathrm{s} = 19.6\\,\\mathrm{ms^{-1}}"]
        self.assertEqual(statuses(ambiguous), ["unknown"] * 2)

    def test_only_a_heading_that_announces_is_left_out_of_the_maths(self):
        right = ["\\text{Probe: } 2 \\cdot 3 = 6", "\\text{Gegeben: } x = 2", "\\text{Lösung: } 2 + 2 = 4",
                 "\\text{Schritt 2: } 2 \\cdot 4 = 8", "\\text{Step 1: } 1 + 1 = 2",
                 "\\text{Solution: } \\ce{2H2 + O2 -> 2H2O}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        on_purpose = ["\\text{Falsch: } \\frac{1}{2} + \\frac{1}{3} = \\frac{2}{5}",
                      "\\text{Unausgeglichen: } \\ce{H2 + O2 -> H2O}",
                      "\\text{Fehler: } 2 + 2 = 5", "\\text{Wrong: } 2 + 2 = 5", "\\text{Common mistake: } 2 + 2 = 5",
                      "\\text{Unbalanced: } \\ce{H2 + O2 -> H2O}"]
        self.assertEqual(statuses(on_purpose), ["unknown"] * len(on_purpose))
        # a wrong line under an announcing heading still fails
        self.assertEqual(statuses(["\\text{Probe: } 2 \\cdot 3 = 7",
                                   "\\text{Lösung: } \\ce{H2 + O2 -> H2O}"]), ["failed"] * 2)

    def test_currency_and_count_words_in_mathrm_are_notes(self):
        right = ["12\\,\\mathrm{EUR} \\cdot 3 = 36\\,\\mathrm{EUR}", "12\\,\\mathrm{€} \\cdot 3 = 36\\,\\mathrm{€}",
                 "5\\,\\mathrm{Stück} \\cdot 3 = 15\\,\\mathrm{Stück}",
                 "12\\,\\mathrm{ct} \\cdot 3 = 36\\,\\mathrm{ct}"]
        self.assertEqual(statuses(right), ["ok"] * len(right))
        self.assertEqual(statuses(["12\\,\\mathrm{EUR} \\cdot 3 = 37\\,\\mathrm{EUR}",
                                   "5\\,\\mathrm{Stück} \\cdot 3 = 16\\,\\mathrm{Stück}"]),
                         ["failed"] * 2)
        # a word that is neither a unit nor a currency still stops the line
        self.assertEqual(statuses(["5\\,\\mathrm{foo} \\cdot 3 = 15\\,\\mathrm{foo}"]), ["unknown"])

    def test_a_whole_number_with_a_unit_is_rounded_to_its_last_digit(self):
        right = ["E = \\frac{1}{2} \\cdot 80\\,\\mathrm{kg} \\cdot (10.4\\,\\mathrm{m/s})^2 = 4326\\,\\mathrm{J}",
                 "E = \\frac{1}{2} \\cdot 80\\,\\mathrm{kg} \\cdot (10.4\\,\\mathrm{m/s})^2 = 4326.4\\,\\mathrm{J}",
                 "1\\,\\mathrm{kg} = 1000\\,\\mathrm{g}"]
        self.assertEqual(statuses(right), ["ok"] * 3)
        wrong = ["E = \\frac{1}{2} \\cdot 80\\,\\mathrm{kg} \\cdot (10.4\\,\\mathrm{m/s})^2 = 4327\\,\\mathrm{J}",
                 "E = \\frac{1}{2} \\cdot 80\\,\\mathrm{kg} \\cdot (10.4\\,\\mathrm{m/s})^2 = 5000\\,\\mathrm{J}",
                 "12\\,\\mathrm{m} \\cdot 3 = 37\\,\\mathrm{m}",
                 "1\\,\\mathrm{h} = 100\\,\\mathrm{min}", "2 \\cdot 3 = 7"]
        self.assertEqual(statuses(wrong), ["failed"] * len(wrong))
        # without a unit a whole number stays exact
        self.assertEqual(statuses(["80 \\cdot 54.08 = 4326"]), ["failed"])

    def test_the_new_checks_never_raise(self):
        broken = ["\\ce{", "\\ce{}", "\\ce{->}", "\\ce{2H2 + -> }", "\\ce{(} -> \\ce{)}", "\\ce{H2O ->[} H2}",
                  "5\\,\\mathrm{", "5\\,\\mathrm{}", "5\\,\\mathrm{m^}", "5\\,\\mathrm{/}", "5\\,\\mathrm{m/}",
                  "5\\,\\mathrm{(m}", "5\\,^\\circ", "5\\,^\\circ\\mathrm{", "\\Omega", "5\\Omega\\Omega", "\\mu",
                  "5\\mu", "1e", "1e-", "e-3", "1.e-3", "10^{", "10^-", "M(\\ce{H2O", "M_{\\ce{", "[\\ce{H+}",
                  "n(\\ce{H2}", "\\ce{H2O}\\ce{H2O}", "0\\,\\mathrm{m} = 1 / 0",
                  "1\\,\\mathrm{m} / 0\\,\\mathrm{s} = 1\\,\\mathrm{m/s}",
                  "\\sqrt{-1\\,\\mathrm{m}} = 1", "\\log(5\\,\\mathrm{m}) = 1", "5\\,\\mathrm{m}! = 1",
                  "\\begin{pmatrix}1\\,\\mathrm{m}\\end{pmatrix} = 1", "5\\,\\mathrm{km^{999}} = 1",
                  "5\\,\\mathrm{mm^{-999}} = 1", "M(\\ce{H2O}) = 1e400", "M(\\ce{H2O}) = 1e400\\,\\mathrm{g/mol}",
                  "1e400 = 1e400", "1e400\\,\\mathrm{m} = 1e400\\,\\mathrm{m}", "(" * 400 + "1" + ")" * 400 + " = 1"]
        self.assertEqual(len(statuses(broken)), len(broken))
        for line in broken:
            self.assertIn(statuses([line])[0], ("unknown", "failed", "ok"), line)
        self.assertEqual(statuses(["\\ce{", "5\\,\\mathrm{", "1 + 1 = 2"]), ["unknown", "unknown", "ok"])

    def test_one_line_that_goes_wrong_does_not_cost_the_others_their_verdict(self):
        # a unit with a power too large for a float, and an infinite molar mass, used to raise for the whole solution
        lines = ["5\\,\\mathrm{km^{999}} = 1", "M(\\ce{H2O}) = 1e400", "1 + 1 = 2", "\\ce{2H2 + O2 -> 2H2O}",
                 "1 + 1 = 3"]
        self.assertEqual(statuses(lines), ["unknown", "unknown", "ok", "ok", "failed"])
        # and a bug in the check of one statement only costs that statement
        with mock.patch.object(verify_math, "check_statement", side_effect=RuntimeError):
            self.assertEqual(statuses(["1 + 1 = 2", "\\ce{2H2 + O2 -> 2H2O}"]), ["unknown", "ok"])

    def test_the_checker_never_executes_what_it_reads(self):
        with open(verify_math.__file__, encoding="utf-8") as f:
            source = f.read()
        self.assertIsNone(re.search(r"(?<![\\w.])(eval|exec|compile)\(|__import__|subprocess|os\.system", source))
        for line in ["__import__('os').system('echo hacked')", "P(__import__('os')) = 1", "E[exec('x=1')] = 2"]:
            self.assertEqual(statuses([line]), ["unknown"])

    def test_what_it_cannot_check_stays_unknown(self):
        lines = ["\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}", "\\sin 2x = 2 \\sin x \\cos x",
                 "\\int_0^1 x\\,dx = \\frac12",
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
