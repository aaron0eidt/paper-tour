# Evaluation exercise sheets

Eleven original exercise sheets (LaTeX) for testing Paper Tour's exercise-sheet tours across subjects and
languages. Every sheet is written for this repository; the `.answers.json` next to it is the answer key and is
**not** part of the PDF.

| Sheet | Subject | Lang | Level | Tasks (parts) | Features |
|---|---|---|---|---|---|
| `chem-stoichiometry-en` | General chemistry problem set | en | university | 6 (20) | `Problem N [P points]`; mhchem equations incl. a redox in acid, limiting reagent, ideal gas, pH, ICE table with blanks |
| `chem-allgemein-de` | Allgemeine Chemie, Übungsblatt 5 | de | university | 5 (18) | `Aufgabe N (P Punkte)`; Puffer, chemfig Lewis formulas (NH3, BF3), VSEPR, captioned `Abbildung 1:` |
| `physics-mechanics-en` | Classical mechanics | en | first-year | 4 (14) | `Exercise N: Title` with `(P pts)` at the right margin and `[2 pts]` per part; two tikz figures (incline, ramp and spring) |
| `physics-elektro-de` | Elektrizitätslehre (Gleichstrom, Kondensator) | de | first-year | 3 (9) | number-first `N. Aufgabe: Titel` with `(P Punkte)` at the right margin; circuitikz circuit with Abbildung caption |
| `linalg-de` | Lineare Algebra, Übungsblatt 6 | de | university | 4 (10) | `Aufgabe 6.1 (Titel, P Punkte)`; Gauß-Verfahren, Determinante, Eigenwerte, "Zeigen Sie, dass ..." proofs; matrices |
| `calculus-en` | Calculus I homework | en | university | 5 (17) | run-in heading `Problem N. (Title, P points) ...`; limits, derivatives, substitution, optimisation with tikz sketch, Taylor |
| `stats-en` | Introductory statistics | en | university | 5 (19) | `Question N` with `[P marks]` at the right margin; two data tables with captions, CI, t-test, regression, tikz probability tree |
| `bio-genetics-en` | Genetics and biochemistry | en | university | 4 (19, 3 nested) | `Task N -- Title (P points)`; Punnett squares (blank grid), Hardy-Weinberg, tikz pedigree, pgfplots Michaelis-Menten curve; `(i)`-`(iv)` and nested `(c)(i)` parts |
| `cs-algorithms-en` | Algorithms and data structures | en | university | 5 (17) | `Exercise N: Title [P pts]`, parts `a.` `b.` with `[P pts]`; code listings, blank trace table, tikz weighted graph, Master theorem |
| `school-math-de` | Mathematik Klasse 10 (Gymnasium) Arbeitsblatt | de | school | 4 (15) | `Aufgabe N (P BE)` (Bewertungseinheiten); pq-Formel, Pythagoras with sketch, Prozent/Zins, pgfplots parabola |
| `econ-micro-en` | Principles of microeconomics | en | university | 4 (14) | `Problem N --- Title --- P points`, `(2 points)` per part; pgfplots supply and demand graph, elasticity, tax incidence, surplus |

Totals: 49 tasks, 172 parts (including 3 nested), 20 pages.

## Build

```
bash eval/sheets/build.sh                      # all sheets, one after the other
bash eval/sheets/build.sh stats-en linalg-de   # only these slugs
```

For each `<slug>.tex` the script runs `pdflatex` twice (niced, in `eval/sheets/.build/<slug>/`), copies the PDF to
`demo/local-sheet-<slug>/paper.pdf` and runs `ingest/.venv/bin/python ingest/ingest.py demo/local-sheet-<slug>/paper.pdf --out demo/local-sheet-<slug>`
(`demo/local-*/` is gitignored). Needs TeX Live with tikz, circuitikz, chemfig, pgfplots, mhchem, siunitx. If you
prefer `eval/sheets/build.sh` directly, run `chmod +x` on it first.

## Answer keys

`<slug>.answers.json`: `{"sheet", "language", "subject", "items": [{"task", "part", "answer", "numeric", "unit", "method"}]}`
(169 items in total).
`task` is the heading as printed (`Problem 2`, `1. Aufgabe`, `Aufgabe 6.3`), `part` is the label without brackets
(`a`, `iii`). There is one item per top-level part: the sub-parts of a part are answered together in that part's
item (`Task 3` part `c` in `bio-genetics-en` covers (c)(i) to (c)(iii)). Numbers use a dot as the
decimal separator in `numeric` even on German sheets. Where a graph has to be read (`bio-genetics-en` Task 4 (i)),
the key states the accepted tolerance.

`INGEST-REPORT.md` compares what `ingest/ingest.py` found with the truth for each sheet.
