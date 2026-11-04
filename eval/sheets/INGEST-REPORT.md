# Ingestion report for the eleven evaluation sheets

What `ingest/ingest.py` produced (state of the repository on 2026-11-03, no code changed) compared with the truth
in the `.tex` sources. Written for whoever fixes ingestion. Block ids (`p1.b7`) and values are quoted from
`demo/local-sheet-<slug>/doc.json`; `exercises[]` = tasks with `parts`. "Truth" is what the PDF prints.

Reproduce one sheet: `bash eval/sheets/build.sh stats-en`, then read `demo/local-sheet-stats-en/doc.json`.

Sections 1 to 4 describe the state before any fix (2026-11-03). Section 5 records what the fixes of 2026-11-04 changed and what is still
wrong, sheet by sheet.

## 1. Summary

| Sheet | Pages | Tasks found / truth | Parts found / truth | Task titles and points | Part points | Figures and tables found / present | Verdict |
|---|---|---|---|---|---|---|---|
| `chem-stoichiometry-en` | 2 | 6 / 6 | 20 / 20 | right (8,10,6,6,8,10; no titles printed) | none printed | 0 / 1 table (ICE) | tasks fine; chemistry text and table garbled |
| `chem-allgemein-de` | 2 | 5 / 5 | 18 / 18 | right (4,5,6,5,4) | none printed | 0 / 1 figure (chemfig) | tasks fine; figure missed (`Abbildung` caption) |
| `physics-mechanics-en` | 2 | 4 / 4 | 14 / 14 | right (8,10,8,8 and all titles) | 2 of 14 wrong (`ex1.d`, `ex3.c` None) | 0 / 2 figures | reading order wrong, part points lost, figures missed |
| `physics-elektro-de` | 1 | 3 / 3 | 9 / 9 | right (8,5,7 and titles) | none printed | 0 / 1 figure (circuitikz) | statement of task 1 precedes its heading; tasks also emitted as sections; figure missed |
| `linalg-de` | 1 | 4 / 4 | 10 / 10 | right (ids `ex6.1`..`ex6.4`, 6,4,6,4, titles) | none printed | n/a (matrices) | tasks fine; matrices garbled (U+FFFD) |
| `calculus-en` | 2 | 5 / 5 | 16 / 17 | right (8,8,6,8,6, titles) | none printed | 0 / 1 figure | part `ex1.d` missing; display math scrambled |
| `stats-en` | 2 | 5 / 5 | 19 / 19 | right (8,6,8,8,6) | none printed | 2 / 3 (2 tables found, tree figure missed) | reading order wrong for 3 tasks; tree missed |
| `bio-genetics-en` | 2 | 4 / 4 | 19 / 19 (incl. 3 nested) | right (6,6,6,8, titles) | none printed | 2 / 3 (2 figures found, blank Punnett table missed) | good |
| `cs-algorithms-en` | 2 | 5 / 5 | 17 / 17 | right (8,10,8,6,8, titles) | right (all 10 stated) | 1 / 2 (graph found, blank trace table missed) | good for structure; code listings flattened |
| `school-math-de` | 2 | 4 / 4 | 15 / 15 | wrong: `points` None, `title` "6 BE".."9 BE" | none printed | 0 / 2 figures | `BE` not understood; figures missed |
| `econ-micro-en` | 2 | 4 / 4 | 14 / 14 | right (10,8,10,6, titles) | right (all 14 stated) | 1 / 1 | perfect |

Totals: 49 / 49 tasks, 171 / 172 parts (only `calculus-en` Problem 1 (d) is missing). Task points are right
on 45 of 49 tasks (the four `BE` tasks are the misses); the 3 sheets with points at the right margin keep every task
points value, but not the reading order. Figures and tables: 6 found (4 figures, 2 tables) out of 17 present
(12 drawings, 5 tables; see sections 2.3 and 2.6).

## 2. Cross-cutting problems, most important first

### 2.1 Points set at the right margin (`\hfill (8 pts)`) break the reading order
Seen in `physics-mechanics-en`, `physics-elektro-de`, `stats-en` (all three use `\hfill` for the points).
- The right-aligned points text is merged into the first line of the following statement paragraph:
  `p1.b8 "(8 pts) A ball is kicked from level ground ..."`, `p1.b6 "(8 Punkte) Die Schaltung in Abbildung 1 ..."`,
  `p1.b7 "[8 marks] Eight students were asked ..."`.
- In some tasks that statement block is then ordered **before** the heading block, so it is not part of the task and
  is attached to the previous task's last part instead:
  - `physics-mechanics-en`: `p1.b17 "(10 pts) A block of mass m = 5.0 kg ..."` comes before `p1.b18 "Exercise 2: Block on a rough incline"`,
    so `ex1.d.blocks = [p1.b15, p1.b16, p1.b17]`; likewise `p2.b5 "(8 pts) On a frictionless air track ..."` before
    `p2.b6 "Exercise 4: ..."`, so `ex3.c.blocks = [p2.b3, p2.b4, p2.b5]`. Tasks 1 and 3 are in the right order
    (`p1.b7` heading then `p1.b8` statement).
  - `physics-elektro-de`: `p1.b6 "(8 Punkte) Die Schaltung ..."` precedes `p1.b7 "1. Aufgabe: Gleichstromkreis"`; `ex1` starts at
    the heading and misses its statement. Tasks 2 and 3 have their points as separate blocks after the heading
    (`p1.b22 "(5 Punkte)"`, `p1.b28 "(7 Punkte)"`).
  - `stats-en`: statements `p1.b7` (Q1), `p1.b16` (Q2) and `p2.b5` (Q5) precede their headings `p1.b8`, `p1.b17`, `p2.b6`.
    `ex1` therefore does not contain its statement, `ex1.d.blocks = [p1.b15, p1.b16]` contains the statement of Q2, and
    `ex4.e.blocks = [p2.b4, p2.b5]` the statement of Q5. Q3 and Q4 are in the right order.
  The task headings were still recognised and the task `points` are right (the right-margin text is found by
  `points_beside`), so only block order and ownership are wrong.
- Per-part points at the right margin (`physics-mechanics-en`, `\hfill[2 pts]` after each part): the points are separate blocks
  (`p1.b10 "[2 pts]"`, `p1.b12`, `p1.b14`, `p1.b16`, ...), part points are recovered for 12 of 14 parts. Two are lost
  (`ex1.d.points = None`, truth 2; `ex3.c.points = None`, truth 3); both parts end with the next task's misplaced statement
  block (`p1.b17`, `p2.b5`), which is probably why their own `[2 pts]` / `[3 pts]` is not found. Two of the points blocks are classified `header_footer`: `p1.b36 "[2 pts]"` (bottom of page 1) and
  `p2.b1 "[3 pts]"` (top of page 2). Probably the running-head rule in `classify_block`
  (`re.sub(r"\d+", "#", t.lower()) in running`, ingest.py around line 1405): the normalised text `[# pts]` repeats on every part.
- Contrast: where the points are inline (`econ-micro-en` "(2 points)", `cs-algorithms-en` "[3 pts]" in the part text,
  `bio-genetics-en`/`chem-*` in the heading) everything is right.

### 2.2 Points unit `BE` is not recognised (`school-math-de`)
`Aufgabe 1 (6 BE)` gives `{"id": "ex1", "number": "1", "title": "6 BE", "points": null}`; same for `7 BE`, `8 BE`, `9 BE`.
"BE" (Bewertungseinheiten) is the usual unit on German school sheets; `_POINTS_UNIT` (ingest.py line 77) has
`Punkte|Punkt|Pkt|Pts|Pt|points|point|marks|mark|BP|P` but not `BE`. The bracket text then becomes the title.

### 2.3 Figures are only found when a `Figure N:` / `Table N:` caption exists
`find_figures` starts from caption blocks (`CAPTION_RE`, ingest.py line 49: `Figure|Fig.|Table|Tab.` only).
- Captions that are German (`Abbildung 1: ...` in `chem-allgemein-de` p1.b33 and `physics-elektro-de` p1.b17, both
  typed `paragraph`) or missing (`physics-mechanics-en` two tikz figures, `calculus-en` sketch, `stats-en` tree,
  `school-math-de` ladder sketch and parabola graph) produce `figures: []`.
- The labels of the drawings then leak into the block list as loose `equation` / `other` / `paragraph` blocks and end up inside
  the task and often inside a part. Examples: `chem-allgemein-de` ex4 has `p1.b25..b32` = "F","H","N","H","B","F","F","H"
  (atom symbols of the chemfig structures; bonds and lone-pair dots are dropped);
  `physics-elektro-de` `p1.b8..b15` = "R1", "I A", "U0", "R2", "R3", "I2", "I3", "R4" (all `equation`) and `p1.b16 "B"`;
  `stats-en` `p2.b7..b18` = "0.02","D","A","0.6","0.98","D","0.05","D","0.4","B","0.95","D" (four "D": the overline of
  `\overline{D}` is lost, so D and not-D cannot be told apart);
  `school-math-de` parabola axes `p2.b4 "y"`, `p2.b5 "6 5 4 3 2 1"`, `p2.b7 "-3 -2 -1 -1 -2 -3 -4 -5"`, `p2.b8..b12 "1".."5"`.
- Some labels are also registered as unnumbered `equations[]`: `physics-mechanics-en` `equ1 "µk = 0.20"`, `equ2 "d = 4.0 m"`;
  `school-math-de` `equ1 "l = 5,0 m"`.
- Where a caption exists the result is good: `bio-genetics-en` fig1 (tikz pedigree) and fig2 (pgfplots), `cs-algorithms-en` fig1
  (tikz graph, caption set as plain text `Figure 1: ...` below), `econ-micro-en` fig1 (pgfplots), `stats-en` tab1 and tab2.
  Their text (axis ticks, node labels) is kept as separate `figure_text` blocks inside the task (`bio` p2.b10..b27,
  `econ` p1.b9..b23, `cs` p1.b19..b33), which is fine.

### 2.4 Display math: matrices, fractions, limits, integrals, roots
Worst in `calculus-en` and `linalg-de`; details in the sheet sections.
- Stretchy delimiters and big operators come out as U+FFFD (`�`): `linalg-de` `p1.b22 "�"`, `p1.b24 "�"`; `calculus-en` `p1.b12 "x→0 2x ��"`,
  `p1.b13 "�"`, `p1.b25 "�"`, `p1.b26 "x ex2 dx � 1 �"`, `p1.b32 "� e 1 x dx"`.
- Square roots lose their sign: `x * sqrt(1+x^2)` -> `p1.b29 "x 1 + x2 dx"`; `sqrt(x^2+x) - x` -> inside `p1.b18 "x2 + x −x ex −1 −x x2"`.
- Fractions are flattened and mixed with limit subscripts: `lim (x^2-4)/(x-2)` -> `p1.b9 "x2 −4 x→2 x −2"`; `V_max[S]/(K_m+[S])` ->
  `bio` `p2.b9 "... v = Vmax[S] Km + [S]."`.
- Matrix rows are cut into different blocks and reordered (see `linalg-de`).
- Superscripts and subscripts are flattened everywhere: "x2 −6x + 8 = 0" (x squared), "f(x) = (3x2 + 1)5", "A−1", "B = PDP −1",
  "Rn×n", "nlogb a", "9.81 m/s2", "Qd = 100 −2P", "Rges", "UAB", "R23". The reader cannot tell `x2` from `x_2`.
- Accents land before their letter: `stats-en` "s/¯x" (x bar), "ˆy = b0 + b1x" (y hat).
- `bio-genetics-en` `p1.b14 "RrY y"` (inserted space inside the italic word `RrYy`).

### 2.5 Chemistry text (`chem-stoichiometry-en`, `chem-allgemein-de`)
- `\ce{A + B -> C}` (long arrow) gives `"−−→"` with no space after it: `p1.b9 "(a) C3H8 + O2 −−→CO2 + H2O"`, `p1.b15 "... Al + HCl −−→AlCl3 + H2"` (de).
- Equilibrium arrow: `p2.b2 "N2O4(g) −−⇀ ↽−−2 NO2(g)"`.
- Ion charges: `p1.b11 "MnO4 – + Fe2+ −−→Mn2+ + Fe3+"`. The anion charge is a detached `–` ("MnO4 –"), the cation charges are plain digits-plus
  ("Fe2+" is ambiguous between Fe^2+ and Fe_2+). Formula subscripts are flattened ("C3H8", "H2SO4"), which is acceptable.
- siunitx thin space: `p1.b19 "R = 0.082 06 L atm/(mol K)"`; the degree sign is separate: `"27 ◦ C"`.

### 2.6 Tables without a caption or with empty cells are not recognised
- Blank grids and fill-in tables are not tables: `chem-stoichiometry-en` ICE table -> blocks `p2.b5 "[N2O4] / M"`, `p2.b6 "[NO2] / M"`,
  `p2.b7 "Initial Change Equilibrium"`, `p2.b8 "0.0500"` (other), `p2.b9 "−x"` (typed `equation`), `p2.b10 "0"` (other); the blank rules
  are dropped. `bio-genetics-en` Punnett grid -> `p1.b9..b12` "T","t","T","t" (`equation`), no table.
  `cs-algorithms-en` trace table -> `p1.b12 "iteration lo hi mid A[mid]"`, `p1.b13 "1 2 3 4"`, `p1.b14 "0 10"`; the blank cells vanish.
- Captioned tables are found: `stats-en` `tab1` `bbox [170.5, 186.5, 424.5, 227.5]`, `tab2`, with `caption_block`, `image`, `referenced_by`.

### 2.7 Code listings are flattened (`cs-algorithms-en`)
No code block type; indentation and line structure are lost and statements are joined: `p2.b4 "for i in range(n): for j in range(i):"`,
`p2.b8 "for j in range(n): work() i = 2 * i"`, `p2.b19 "def mystery(a): s = 0 for x in a:"`, `p2.b20 "if x % 2 == 0: s += x else:"`,
`p2.b24 "return 1 return f(n - 1) + f(n - 2)"`. Blocks break where the wrapped frame breaks, not at statements.

### 2.8 Header block of a sheet
On every sheet except `school-math-de` the "Due / Abgabe / Total" lines under the title are typed `authors` (e.g. `p1.b4 "Due: Friday, 14 November 2026, 5:00 pm"`,
`p1.b5 "Total: 48 points"`, `p1.b6 "Use g = 9.81 m/s2 and neglect air resistance. Explain every step."` in `physics-mechanics-en`).
The course line in the margin is `header_footer` and the title is `title`, both right. `school-math-de` scrambles the fill-in line:
`p1.b4 "Datum: Taschenrechner ist erlaubt. Schreibe deinen Lösungsweg vollständig auf."`, `p1.b5 "Name:"`, `p1.b6 "Gesamt: 30 BE"`.

### 2.9 Number-first headings also become sections (`physics-elektro-de`)
`1. Aufgabe: Gleichstromkreis` is typed `heading` and listed in `sections`: `{"id": "sec-1", "number": "1", "title": "Aufgabe: Gleichstromkreis", "level": 1, "block": "p1.b7"}`
(`sec-2` "Aufgabe: Leistung", `sec-3` "Aufgabe: Kondensator"). The tasks themselves are right (`ex1` title "Gleichstromkreis", points 8), but the sections list
duplicates them with the keyword inside the title. No other sheet has sections.

### 2.10 A paragraph is cut at an inline fraction and the hyphen is not rejoined (`bio-genetics-en`)
`p2.b8 "The initial rate v of an enzyme-catalysed reaction was measured at different substrate concentra-"` and
`p2.b9 "tions [S] (Figure 2). The curve follows the Michaelis–Menten equation v = Vmax[S] Km + [S]."`: one sentence in two blocks, with
"concentra-" / "tions" unjoined.

### 2.11 What works
Heading styles recognised: `Problem N [P points]` (bold own line), `Aufgabe N (P Punkte)`, `Exercise N: Title` + right margin, `N. Aufgabe: Title`,
`Aufgabe 6.1 (Title, P Punkte)`, run-in `**Problem N.** (Title, P points) statement`, `Question N`, `Task N – Title (P points)` (en dash kept in the title),
`Exercise N: Title [P pts]`, `Problem N — Title — P points`. Parts `a)`, `(a)`, `a.`, `(i)`..`(iv)` at top level, and nested `(c)(i)` (ids `ex3.c.i`..`ex3.c.iii`),
parts that run over a page break (`chem-allgemein-de` ex4, `cs-algorithms-en` ex3.a spans `p1.b40`, `p2.b1`, `p2.b2`), `Aufgabe 6.1` numbering (id `ex6.1`),
en dash and ß in titles ("Hardy–Weinberg equilibrium", "Gauß-Verfahren"). Page numbers and the margin running head are `header_footer`.

## 3. Per sheet

For each: truth, then what `doc.json` has. "Right" = equal to truth.

### chem-stoichiometry-en (2 pages)
Truth: 6 problems, 20 parts, heading `Problem N [P points]`, points 8,10,6,6,8,10, no part points, no titles.
- `exercises`: `ex1`..`ex6`, `number` "1".."6", `points` 8,10,6,6,8,10, no `title`; parts `ex1.a-c`, `ex2.a-d`, `ex3.a-c`, `ex4.a-c`, `ex5.a-c`, `ex6.a-d`; all part `points` absent. Right.
- Heading blocks are `paragraph` (`p1.b7 "Problem 1 [8 points]"`), no sections.
- `ex6.b.blocks = [p2.b4 ... p2.b10]`: the ICE table cells (see 2.6) belong to part (b), as they should.
- Garbled: arrows `"−−→"`, equilibrium arrow `"−−⇀ ↽−−"`, `"MnO4 –"` (2.5); `p2.b9 "−x"` typed `equation` but `equations` is empty; no figures or tables.
- Title `p1.b3` right; `p1.b4`, `p1.b5` ("Due ...", "Total: 48 points") typed `authors`.

### chem-allgemein-de (2 pages)
Truth: 5 Aufgaben (4,5,6,5,4), parts 3,3,4,4,4, `Aufgabe N (P Punkte)`, one chemfig figure with `Abbildung 1:` caption.
- `exercises`: `ex1`..`ex5` with `points` 4,5,6,5,4, no `title`, parts 18/18 (a-c, a-c, a-d, a-d, a-d). Right.
- `ex4.a` is on page 1 (`p1.b34`) and `ex4.b-d` on page 2 (`p2.b1-b3`): right across the page break.
- `figures: []`: the NH3/BF3 drawing is missing; atom labels `p1.b25..b32` ("F","H","N","H","B","F","F","H") sit in ex4; the caption `p1.b33`
  "Abbildung 1: Lewis-Formeln von NH3 (links) und BF3 (rechts)." is a `paragraph` (2.3).
- `p1.b15 "... Al + HCl −−→AlCl3 + H2"` (2.5).
- `p1.b4 "Ausgabe: 5. November 2026"`, `p1.b5 "Abgabe: Mittwoch, 12. November 2026, 12:00 Uhr"` typed `authors`.

### physics-mechanics-en (2 pages)
Truth: 4 exercises, 14 parts, `Exercise N: Title` bold + `(8 pts)` right margin, part points 2,2,2,2 / 2,3,3,2 / 2,3,3 / 3,3,2, two tikz figures without captions.
- Tasks: `ex1` "Projectile motion" 8, `ex2` "Block on a rough incline" 10, `ex3` "Energy and a spring" 8, `ex4` "One-dimensional collision" 8. Right.
- Parts 14/14 found. Part points right for 12; `ex1.d.points = null` (truth 2), `ex3.c.points = null` (truth 3).
- Reading order / ownership errors, margin points merged into the statement, `[n pts]` blocks, two `header_footer` points blocks: see 2.1.
- Figures: none found. Labels `p1.b19 "µk = 0.20"` (paragraph), `p1.b20 "m"`, `p1.b21 "d = 4.0 m"`, `p1.b22 "θ"` (equation); ex3 figure `p1.b32 "m"`, `p1.b33 "h"`, `p1.b34 "k"`.
  `equations`: `equ1 "µk = 0.20"` (block p1.b19), `equ2 "d = 4.0 m"` (block p1.b21).
- `p1.b29` contains `... stay at rest? [2 pts]` with the points after a line break ("[2" / "pts]") and is parsed correctly (`ex2.d.points = 2`).
- `p1.b6 "Use g = 9.81 m/s2 ..."` typed `authors` (2.8); "30◦" degree glyph.

### physics-elektro-de (1 page)
Truth: 3 Aufgaben (8,5,7), parts 3,3,3, `N. Aufgabe: Titel` + `(P Punkte)` right margin, circuitikz figure with `Abbildung 1:` caption.
- `exercises`: `ex1` "Gleichstromkreis" 8, `ex2` "Leistung" 5, `ex3` "Kondensator" 7; parts a-c each; part `points` none (none printed). Right.
- `sections` has three entries for the same headings (2.9); heading blocks `p1.b7`, `p1.b21`, `p1.b27` typed `heading`.
- Statement of Aufgabe 1 before its heading (2.1): `p1.b6 "(8 Punkte) Die Schaltung in Abbildung 1 wird von einer Gleichspannungsquelle mit U0 = 12 V gespeist. ..."`;
  `ex1` has 14 blocks (`p1.b7`..`p1.b20`).
- Circuit not found (2.3): `p1.b8..b15` labels as `equation` ("I A" is two labels merged), `p1.b16 "B"` (other), caption `p1.b17` is a `paragraph`; `figures: []`, `equations: []`.
- Subscripts flattened ("Rges", "UAB", "R23").

### linalg-de (1 page)
Truth: 4 Aufgaben `Aufgabe 6.1 (Gauß-Verfahren, 6 Punkte)` ..., parts 3,2,3,2.
- `exercises`: `ex6.1` "Gauß-Verfahren" 6, `ex6.2` "Determinante" 4, `ex6.3` "Eigenwerte und Eigenvektoren" 6, `ex6.4` "Beweisaufgabe" 4; parts `ex6.1.a-c`, `ex6.2.a-b`, `ex6.3.a-c`, `ex6.4.a-b`. Right. Heading blocks are `paragraph`.
- The LGS (aligned) is one clean equation: `equ1 "x + y + z = 4, 2x − y + 3z = 14, x + 2y − z = −3."` (`p1.b8`).
- Matrix A (6.2): `p1.b14 equation "  A =  1 3 2 ."`, `p1.b15 other "2 0 1"`, `p1.b16 equation " "`, `p1.b17 other "0 −1 4"`: three rows in three blocks and in the order row 2, row 1, row 3.
- Matrix B (6.3): `p1.b22 equation "�"`, `p1.b23 other "4 1 2 3"`, `p1.b24 equation "�"`, `p1.b25 "B ="`, `p1.b26 "∈R2×2."`: the left side "B =" and "∈ R^{2x2}" are in different blocks from the entries, brackets are U+FFFD.
- Only `equations` has 1 entry; the matrices are not equations. "A2 = A", "det(A−1)", "B = PDP −1", "λ−1" (superscripts flattened), `Rn×n`.
- `p1.b4 "Abgabe: Montag ..."`, `p1.b5 "Gesamtpunktzahl: 20"` typed `authors`.

### calculus-en (2 pages)
Truth: 5 problems, run-in `Problem 1. (Limits, 8 points) Evaluate ...`, parts 4,4,3,3,3.
- Tasks right: "Limits" 8, "Derivatives" 8, "Substitution" 6, "Optimisation" 8, "Taylor polynomial" 6; heading and statement share one `paragraph` block
  (`p1.b7 "Problem 1. (Limits, 8 points) Evaluate the following limits, or explain why they do not exist."`).
- Parts 16 / 17. **`ex1` has `a`, `b`, `c` and no `d`**: the block `p1.b14 "(d) lim"` is ordered before `p1.b15 "(c) lim"`, so label d does not follow c.
  Contents are scrambled: `ex1.a.blocks = [p1.b8 "(a) lim", p1.b9 "x2 −4 x→2 x −2", p1.b10 "sin(3x)"]` (the numerator of (b) is in (a)),
  `ex1.b.blocks = [p1.b11, p1.b12 "x→0 2x ��", p1.b13 "�", p1.b14 "(d) lim"]`, `ex1.c.blocks = [p1.b15, p1.b16 "x→∞", p1.b17 "x→0", p1.b18 "x2 + x −x ex −1 −x x2"]`
  ((c) and (d) are fused in one block, the root is lost).
- Problem 3: `ex3.a.blocks = ["p1.b27"]` is the label "(a)" alone; its integral is `p1.b26 equation "x ex2 dx � 1 �"` placed before the label (merged with the top limit of (b)).
  `ex3.b = [p1.b28 "(b)", p1.b29 "x 1 + x2 dx", p1.b30 "0"]`, `ex3.c = [p1.b31 "(c)", p1.b32 "� e 1 x dx", p1.b33 "ln x"]`.
- Problem 2 (inline math) is fine apart from flattened exponents: "f(x) = (3x2 + 1)5", "g(x) = x2e−x".
- Problem 4 tikz sketch: not found; labels `p1.b35 "y"`, `p1.b36 "x"` (equation), `p1.b37 "pen 1"`, `p1.b38 "pen 2"`, `p1.b39 "river"`. `equations`: one entry (`equ1 "x2 −4 x→2 x −2"`).

### stats-en (2 pages)
Truth: 5 questions, `Question N` + `[P marks]` right margin, parts 4,3,4,5,3, two captioned booktabs tables, one tikz tree (no caption).
- Tasks right (8,6,8,8,6, no titles), parts 19/19, no part points (none printed).
- Reading order: statements of Q1, Q2 and Q5 before the heading (2.1). `p1.b28 "[8 marks]"` (Q4) is a separate paragraph before its statement `p1.b29`.
- Tables found: `tab1` (`caption_block p1.b11`, `referenced_by ["p1.s7"]`) and `tab2` (`p1.b32`), crops `figures/tab1.png`, `figures/tab2.png`; the cell rows are also kept as `table_text` blocks (`p1.b9 "Student 1 2 3 4 5 6 7 8"`, `p1.b10 "Hours per week 8 10 12 9 11 13 7 10"`).
- Probability tree not found (2.3), `D` and `D` with overline indistinguishable.
- "s/¯x", "¯x and ¯y", "ˆy = b0 + b1x", "z0.005 = 2.576" (2.4).

### bio-genetics-en (2 pages)
Truth: 4 tasks (`Task N – Title (P points)`: 6,6,6,8), parts 4,4,(a,b,c with c.i-c.iii,d),(i)-(iv), pedigree and pgfplots curve with `Figure N:` captions, blank 2x2 Punnett grid.
- Tasks: `ex1` "Punnett squares", `ex2` "Hardy–Weinberg equilibrium", `ex3` "Pedigree analysis", `ex4` "Michaelis–Menten kinetics", points 6,6,6,8. Right.
- Parts: `ex1.a-d`, `ex2.a-d`, `ex3.a`, `ex3.b`, `ex3.c` with `ex3.c.i`, `ex3.c.ii`, `ex3.c.iii`, `ex3.d`, `ex4.i`, `ex4.ii`, `ex4.iii`, `ex4.iv`. Right (nested and roman parts work).
- `fig1` bbox `[197.5, 617.5, 398.0, 732.5]`, caption `p1.b32`, `referenced_by ["p1.s24"]`; `fig2` bbox `[117.5, 258.5, 477.0, 421.47]`, caption `p2.b28`. Right. Pedigree labels and axis ticks are `figure_text` blocks.
- Punnett grid: not a table (2.6); its cells `p1.b9..b12` are inside `ex1.a`.
- Paragraph split with hyphen (2.10); `p1.b14 "RrY y"` (2.4).

### cs-algorithms-en (2 pages)
Truth: 5 exercises (`Exercise N: Title [P pts]`: 8,10,8,6,8), parts 3,3,4,3,4 labelled `a.`, part points `[3 pts]` for ex1, ex2, ex5, listings, blank trace table, tikz graph with plain-text caption.
- Tasks and titles right. Parts 17/17. Part points right: ex1 3,3,2; ex2 5,2,3; ex5 2,2,2,2; ex3 and ex4 have none printed and none found.
- `ex3.a.blocks = [p1.b40 "a. Snippet 1:", p2.b1, p2.b2]`: a part spanning the page break is handled.
- Graph: `fig1` bbox `[163.5, 498.0, 432.0, 614.0]`, `caption_block p1.b34` ("Figure 1: Weighted graph with six nodes."), `referenced_by ["p1.s20"]`. Found although the caption is plain text and not a float caption.
- Code flattened (2.7); trace table not found (2.6): `p1.b12 "iteration lo hi mid A[mid]"`, `p1.b13 "1 2 3 4"`, `p1.b14 "0 10"`.
- `equ1 "A = [3, 8, 14, 21, 27, 35, 42, 56, 63, 71, 88]"` right. "mid = ⌊(lo +hi)/2⌋" (a space lost), "nlogb a", "n2".

### school-math-de (2 pages)
Truth: 4 Aufgaben `Aufgabe N (P BE)` with 6,7,8,9 BE, parts 4,3,4,4, tikz ladder sketch and pgfplots parabola (neither with an `Abbildung N:` caption).
- `exercises`: `ex1` `{"number": "1", "title": "6 BE", "points": null}`, `ex2` title "7 BE", `ex3` "8 BE", `ex4` "9 BE": points lost, title wrong (2.2). Parts 15/15 right (`ex1.a-d`, `ex2.a-c`, `ex3.a-d`, `ex4.a-d`); `ex3.d` is on page 2 (`p2.b1`).
- Part lines are `paragraph` blocks with flattened exponents: `p1.b9 "a) x2 −6x + 8 = 0"`.
- Figures: none found (2.3). Ladder labels `p1.b15 "l = 5,0 m"` (also `equ1`), `p1.b16 "h"`, `p1.b17 "α"`, `p1.b18 "1,4 m"`, `p1.b19 "Skizze (nicht maßstabsgetreu)"`; parabola axis labels `p2.b4..b12` (2.3).
- Header scrambled (2.8).

### econ-micro-en (2 pages)
Truth: 4 problems `Problem N — Title — P points` (10,8,10,6), parts 4,3,4,3 with `(n points)` inline, captioned pgfplots graph.
- Everything right: titles "Market equilibrium", "Price elasticity of demand", "A per-unit tax", "Consumer surplus"; points 10,8,10,6; part points
  `ex1` 2,3,3,2, `ex2` 3,3,2, `ex3` 4,2,2,2, `ex4` 2,2,2; 14/14 parts.
- `fig1` bbox `[134.5, 204.5, 460.5, 372.5]`, caption `p1.b24` ("Figure 1: Demand (D) and supply (S) in the market."), `referenced_by ["p1.s8", "p1.s10"]`.
- Only cosmetic: "Qd = 100 −2P", "P = 50 −Q/2" (subscripts flattened, minus spacing).

## 4. Where to look in ingest.py (hypotheses, not verified by changing code)
- `_POINTS_UNIT` (line 77): add `BE`.
- `CAPTION_RE` (line 49) and `find_figures` (line 1120): `Abbildung`, `Abb.`, `Tabelle`; figures without any caption are never searched.
- `classify_block` running-head rule (around line 1405): `[# pts]` repeated per part is treated as a running head.
- Ordering of the right-margin points row relative to the heading: `points_beside` (line 2134) finds the points, but the row ends up as the first row of
  the following statement block, and that block then sorts before the heading in `order_page` (line 1529) in some tasks and not in others (likely a
  baseline/top difference between the bold heading and the normal-weight points on the same line).
- `place_label` (line 2277) used by `cut_exercises` (line 2332): a part label that arrives out of order ("(d)" before "(c)") is not accepted; the reading order has to be fixed first.
- Display math and code: not exercised by any test in `ingest/` for these shapes (matrices, `\lim` fractions, integrals, `lstlisting`).

## 5. After the fixes (2026-11-04)

All numbers and quotes are from `demo/local-sheet-<slug>/doc.json` after `bash eval/sheets/build.sh` with the fixed `ingest/ingest.py`.

What changes outside exercise sheets: the caption words (`Abbildung`, `Abb.`, `Bild`, `Tabelle` in `CAPTION_RE`, and the same words in `FIG_REF_RE`) apply to **every** document, not only to
sheets. German papers and documents with `Abbildung N` / `Tabelle N` captions now gain those figures and tables, and the sentences that cite them are linked. Example:
`demo/local-doc-recipe-de` (2 pages, no exercises) now has `fig1` ("Abbildung 1. Zeitplan für 50 Minuten. Das Blech ist von Minute 10 bis 45 im Ofen", page 2), and 40 of its 74 blocks
change (27 blocks are `figure_text` now, 12 were `other`); that is wanted, its `expect.json` lists the figure. Only the detection of figures and tables without a caption, the
text clean-up (arrows, U+FFFD), the margin-points handling, the part order and the skip of task headings as sections are sheet-only: they run where a task heading was found.
Checked by ingesting the 31 non-sheet PDFs under `demo/` with the `ingest.py` of `HEAD` and with the fixed one: 29 of them (`attention`, `attention-short`, `board-test`, `pen-test`, `_fixture`, the `eval-*` folders except `eval-sheet-de`, the
`mode-*` folders, the `local-doc-*` folders except `recipe-de`; two of them, `eval-sheet-en` and `mode-coach`, are exercise sheets) give identical `doc.json` files; `eval-sheet-de` (an exercise sheet) changes only in the
text of 19 blocks that lose U+FFFD, and `local-doc-recipe-de` as described. The 11 sheets of `eval/sheets` and `demo/attention` validate (`validate.py`).

### 5.1 What changed in `ingest.py`

| Report item | Change |
|---|---|
| 2.1 points at the right margin | `split_heading_points` (called first in `find_exercises`) gives the points row that sits right of a task heading a block of its own, so the statement no longer starts on the heading's line and cannot sort ahead of it. `classify_block` no longer takes a points-only block (`[2 pts]`, `(8 pts)`) for a running head or a venue line on a sheet. |
| 2.2 `BE` | `_POINTS_UNIT` knows `BE` and `Bewertungseinheit(en)` (`P.`, `Pkt.`, `Punkte`, `pts`, `points`, `marks` were already there). |
| 2.3 figures without a caption | `CAPTION_RE` knows `Abbildung`, `Abb.`, `Bild`, `Tabelle` (`Fig.` was already there); `FIG_REF_RE` reads the same words in running text. **These caption words apply to every document**, not only to sheets: a German paper or any document with `Abbildung N` / `Tabelle N` captions gains those figures (`demo/local-doc-recipe-de` gains `fig1`, 40 of its 74 blocks change; see the intro of this section). New `find_loose_figures` (see 5.2), which runs on sheets only. |
| 2.5 chemistry arrows | `tidy_sheet_text`: `−−→CO2` becomes `→ CO2`, `−−⇀ ↽−−2` becomes `⇌ 2`. Sheets only. |
| 2.4 U+FFFD | `tidy_sheet_text` drops U+FFFD from the text of blocks and equations. Sheets only. Which bracket it was cannot be told (see 5.4). |
| 2.9 task headings as sections | `build_sections` skips a heading block that starts a task. The block stays a `heading`. |
| calculus `ex1.d` | `restore_part_order` (end of `order_page`, sheets only) puts blocks that start a part in label order when the layout order disagrees with the baselines. It only touches a run whose labels are one list: distinct, and either all single letters or all roman numerals (`label_rank` returns `None` otherwise). Nested sub-parts at one indent (`(a)(i)(ii)(b)(i)(ii)`, or `a)`, `b)`, then `(i)`, `(ii)`) are left alone; an earlier version crashed on them with `TypeError: ord() expected a character` (review, 2026-11-04). |
| type area of a two-page document | `estimate_text_area` (every document, not only sheets) took the median of two pages, i.e. their mean; for one or two pages it now takes the extremes. Without this a caption-bearing figure low on a long first page next to a short second page was dropped as margin clutter (the chemfig molecules of `chem-allgemein-de`). |

### 5.2 Figures and tables without a caption (`find_loose_figures`)

Runs only where `mark_task_heads` found a task (so only exercise sheets), after the captioned figures and tables, before classification.
- Graphics (images, vector paths, rules) not already in a region form groups; each group takes the short label rows next to it (within 0.8 body sizes,
  not a part label, a points statement or a heading) and joins groups that close; so the pieces of a tree, a dimension arrow and its sketch, and the labels in between become one drawing.
- A **figure** needs at least two pieces (or an image or a plotted curve), a piece that is not a rule, a size of its own (three body sizes long, one wide), and at least one piece inside
  the box (the sides of a frame around text are no drawing). Nothing that holds a heading or body text, nothing wholly in the top 12 % or bottom 7 % of the page.
  Three more rules keep page furniture and boxes out (review, 2026-11-04):
  - *Logos.* A graphic wholly above the first task heading of the sheet is the head of the sheet, not a drawing of a task (a logo set in the page body beside the course line ends below the
    12 % band: ink box `[453.5, 56.0, 531.0, 103.0]`, course line at 101 pt, was `fig1` "Figure on page 1"). A page that goes on from an earlier page with a task has no such part, so a drawing
    at its top is kept. An image at the same place in the top or bottom fifth of two pages or more (a logo in the running head or foot) is skipped wherever it sits. A footer logo on a
    one-page sheet that starts above 93 % of the page and is not repeated is still taken for a figure.
  - *Boxes around text.* A shape that is one closed path of axis-parallel sides with at most rounded corners (`_is_box`: tcolorbox's outline and its smaller fill, a word-processor box) and
    covers 80 % or more of the candidate is set aside. If no image, no other shape and fewer than two rules across the inside are left, the candidate is a box around text and no figure
    (`Hinweis: Nutzen Sie die pq-Formel.` stays a `paragraph` with its sentence, as before). A circuit in a filled panel, or a box with a cross of lines in it, is still a figure.
    The threshold is 80 %, not 90 %, because tcolorbox's fill covers only 0.896 of the outline on a one-line box.
- A **table** is a skeleton of rules (`table_skeletons`, shared with `find_tables`) that forms a grid (two horizontal and two vertical rules, not a frame) or the booktabs
  rules (three of one extent, five body sizes wide or more) with at least two text rows between them. Its cells become `table_text` blocks. No `grid` is read: these are fill-in forms.
- IDs go on from the highest printed number of the kind: `fig1`, `tab1`, `fig3` when `fig1` and `fig2` have captions. `number` is that number as a string.
  `caption` is the name of the task the drawing sits in: `"Figure in Exercise 2"`, `"Table in Task 1"`, `"Abbildung in Aufgabe 4"` (German task words give German names), `"Figure on page 1"` above the first task.
  There is no `caption_block`, `panels` is empty, and no sentence is linked to the figure by `referenced_by`, since no printed number can cite it.
- The label rows become `figure_text` (`table_text`) blocks and are listed in the blocks of the task.

### 5.3 Before and after, per sheet

Tasks / parts / task points found / part points found / figures + tables found (truth: 17 = 12 drawings + 5 tables).

| Sheet | Tasks | Parts | Task points | Part points | Figures + tables found / present | Sections | Verdict |
|---|---|---|---|---|---|---|---|
| `chem-stoichiometry-en` | 6 / 6 | 20 / 20 | 6 / 6 | none printed | 0 → **1** / 1 (ICE table) | 0 | arrows fixed, table found |
| `chem-allgemein-de` | 5 / 5 | 18 / 18 | 5 / 5 | none printed | 0 → **1** / 1 | 0 | caption word and clutter fixed |
| `physics-mechanics-en` | 4 / 4 | 14 / 14 | 4 / 4 | 12 → **14** / 14 | 0 → **2** / 2 | 0 | reading order, part points, figures fixed |
| `physics-elektro-de` | 3 / 3 | 9 / 9 | 3 / 3 | none printed | 0 → **1** / 1 | 3 → **0** | statement order, sections, figure fixed |
| `linalg-de` | 4 / 4 | 10 / 10 | 4 / 4 | none printed | n/a | 0 | brackets cleaned, matrices still broken |
| `calculus-en` | 5 / 5 | 16 → **17** / 17 | 5 / 5 | none printed | 0 → **1** / 1 | 0 | `ex1.d` back, sketch found, display math still broken |
| `stats-en` | 5 / 5 | 19 / 19 | 5 / 5 | none printed | 2 → **3** / 3 | 0 | reading order and tree fixed |
| `bio-genetics-en` | 4 / 4 | 19 / 19 | 4 / 4 | none printed | 2 → **3** / 3 | 0 | Punnett grid found |
| `cs-algorithms-en` | 5 / 5 | 17 / 17 | 5 / 5 | 10 / 10 | 1 → **2** / 2 | 0 | trace table found; code still flattened |
| `school-math-de` | 4 / 4 | 15 / 15 | 0 → **4** / 4 | none printed | 0 → **2** / 2 | 0 | `BE` and figures fixed |
| `econ-micro-en` | 4 / 4 | 14 / 14 | 4 / 4 | 14 / 14 | 1 / 1 | 0 | unchanged, perfect |

Totals: 49 / 49 tasks, **172 / 172** parts, task points right on **49 / 49** (was 45), part points right wherever printed (was 12 of 14 on the mechanics sheet), figures and tables
found **17 / 17** (was 6 / 17: figures 4 → 12 of 12, tables 2 → 5 of 5).

Review follow-up (2026-11-04: nested sub-parts, logos in the page body, boxes around text, the caption words): rebuilding the eleven sheets with these four fixes gives the same
`doc.json` as before for every sheet, apart from the PDF hash in `source`; the counts above, the block IDs and the quotes in 5.4 stand. The fixes are covered by synthetic sheets in
`ingest/test_exercises.py` (`test_nested_sub_parts_do_not_break_the_part_order`, `test_a_logo_in_the_page_body_is_no_figure`, `test_a_box_around_a_short_text_is_no_figure`) and by the PDFs the reviewer built with pdflatex
(`boxes.tex`: no `fig1` for the logo, the tcolorbox hint stays `paragraph` with its sentence; `nested.tex`: `ex1.a.i`, `ex1.a.ii`, `ex1.b.i`, `ex1.b.ii`).

### 5.4 Per sheet: fixed, and what is still wrong

#### chem-stoichiometry-en
- Fixed: arrows. `p1.b9 "(a) C3H8 + O2 → CO2 + H2O"`, `p1.b10 "(b) Al + H2SO4 → Al2(SO4)3 + H2"`, `p2.b2 "... N2O4(g) ⇌ 2 NO2(g) has Kc = 1.00 × 10^−2 ..."`.
  The ICE table is `tab1` (`caption` "Table in Problem 6", `bbox [182.5, 151.5, 412.5, 219.0]`, page 2, no `caption_block`); its cells are `table_text`
  blocks `p2.b5 "[N2O4] / M [NO2] / M"`, `p2.b6 "Initial 0.0500 0"`, `p2.b7 "Change −x"`, `p2.b8 "Equilibrium"`, all inside `ex6.b`.
- Still wrong: the anion charge `p1.b11 "... MnO4 – + Fe2+ → Mn2+ + Fe3+"` (detached `–`, "Fe2+" ambiguous); `R = 0.082 06` and `27 ◦ C`; the blank cells of the ICE table are not text, so the grid has no
  empty cells to point at (the table crop shows them). No `grid` is read for tables without a caption.

#### chem-allgemein-de
- Fixed: `Abbildung 1:` is a caption. `fig1` `bbox [215.5, 643.5, 382.5, 707.0]` (both molecules), `caption_block p1.b33`; the atom symbols `p1.b25..b32` ("F","H","N","H","B","F","F","H") are `figure_text` of the figure.
  `p1.b15 "... Gleichen Sie die Gleichung aus: Al + HCl → AlCl3 + H2"`.
- Still wrong: bonds and lone pairs are drawings only (no text); `fig1.referenced_by` is empty because no sentence cites "Abbildung 1"; `p1.b4`/`p1.b5` ("Ausgabe", "Abgabe") are still typed `authors` (2.8).

#### physics-mechanics-en
- Fixed: every task starts with its heading, then the points block, then its statement, in reading order: `ex2.blocks = [p1.b18 "Exercise 2: Block on a rough incline", p1.b19 "(10 pts)", p1.b20 "A block of mass m = 5.0 kg ..."]`,
  `ex4.blocks = [p2.b5, p2.b6 "(8 pts)", p2.b7 "On a frictionless air track ..."]`. No statement is in a part of the task before. All 14 part points are read (2,2,2,2 / 2,3,3,2 / 2,3,3 / 3,3,2),
  among them `ex1.d` (blocks `p1.b16 "d) A fence ...", p1.b17 "[2 pts]"`) and `ex3.c` (`p2.b3 "c) Now a rough stretch ...", p2.b4 "[3 pts]"`). `p1.b39 "[2 pts]"` (bottom of page 1) and `p2.b2 "[3 pts]"` are `paragraph`, not `header_footer`.
  `fig1` ("Figure in Exercise 2", `bbox [222.69, 355.0, 378.56, 472.13]`) and `fig2` ("Figure in Exercise 3", `bbox [199.5, 679.0, 400.0, 750.17]`); their labels are `figure_text` (`p1.b21 "µk = 0.20"`, `p1.b22 "m"`, `p1.b23 "d = 4.0 m"`, `p1.b24 "θ"`; `p1.b35 "m"`, `p1.b36 "h"`, `p1.b37 "k"`),
  and `equations` is empty (was `equ1 "µk = 0.20"`, `equ2 "d = 4.0 m"`).
- Still wrong: the points are blocks of their own after the heading (`p1.b8 "(8 pts)"`), as on the other sheets with points at the margin, not part of the heading block; `p1.b6` (the "Use g = ..." line) is `authors`; `30◦`, `m/s2` flattened.

#### physics-elektro-de
- Fixed: `ex1.blocks = [p1.b6 "1. Aufgabe: Gleichstromkreis", p1.b7 "(8 Punkte)", p1.b8 "Die Schaltung in Abbildung 1 wird ...", ...]`: heading, points, statement. `sections` is `[]` (was three entries); the three headings are still `heading` blocks and tasks.
  `fig1` is the circuit (`bbox [199.86, 187.5, 398.5, 310.5]`, `caption_block p1.b18 "Abbildung 1: Gleichstromkreis mit vier Widerständen."`, `referenced_by ["p1.s6"]`); the labels `p1.b9..b17` ("R1", "I A", "U0", ...) are `figure_text`.
- Still wrong: "I A" is two labels in one block; `Rges`, `UAB`, `R23` flattened.

#### linalg-de
- Fixed (cosmetic): U+FFFD is gone, `p1.b22` and `p1.b24` (the brackets of B) have empty text; `p1.b25 "B ="`, `p1.b23 "4 1 2 3"`.
- Still wrong, skipped (needs new machinery): matrices. `p1.b14` still holds `\uf8eb \uf8ec A = \uf8ed 1 3 2 \uf8f8.` with the Symbol-font bracket pieces U+F8EB.. in it (private-use characters, left as they are), rows of A in three blocks and in the order row 2, row 1, row 3, the left side of B in a different block from its entries.
  Superscripts still flattened (`A2 = A`, `det(A−1)`, `Rn×n`).

#### calculus-en
- Fixed: `ex1` has `a`, `b`, `c`, `d` (17 / 17 parts). The label blocks were `(a) p1.b8, (b) p1.b11, (d) p1.b14, (c) p1.b15`; they are now in label order, `ex1.c.blocks = [p1.b14 "(c) lim"]`, `ex1.d.blocks = [p1.b15 "(d) lim", p1.b16, p1.b17, p1.b18]`.
  `fig1` ("Figure in Problem 4", `bbox [187.5, 606.5, 405.0, 694.5]`) takes the two dimension arrows and the labels `p1.b35 "y"`, `p1.b36 "x"`, `p1.b37 "pen 1"`, `p1.b38 "pen 2"`, `p1.b39 "river"`.
  U+FFFD is gone from the text: `ex3` reads `"x ex2 dx 1"`, `"e 1 x dx"`.
- Still wrong: the formula blocks are not assigned to the part they belong to: `ex1.c` has only its label, the numerator `x→∞` and the fused `x2 + x −x ex −1 −x x2` sit in `ex1.d`; `ex1.a` still holds the numerator of (b) (`p1.b10 "sin(3x)"`).
  The unmapped glyphs (integral signs, radical, big parentheses) leave empty blocks (`p1.b13`, `p1.b25` have text `""`) and holes in the text (`"x 1 + x2 dx"` has no root sign). `equ1 "x2 −4 x→2 x −2"` is a fragment of two limits. Superscripts flattened.

#### stats-en
- Fixed: `ex1.blocks = [p1.b7 "Question 1", p1.b8 "[8 marks]", p1.b9 "Eight students were asked ...", ...]`, likewise `ex2` (`p1.b17`, `p1.b18`, `p1.b19`) and `ex5` (`p2.b5`, `p2.b6`, `p2.b7`). No part holds the statement of the next question (`ex1.d.blocks` is `[p1.b16]` only).
  The tree is `fig1` ("Figure in Question 5", page 2, `bbox [202.0, 226.5, 397.0, 337.5]`); `p2.b8..b19` ("D", "0.02", "A", "0.6", ...) are its `figure_text`. `tab1` and `tab2` as before.
- Still wrong: `D` and `D` with overline are the same text; `"s/¯x"`, `"ˆy = b0 + b1x"` (accents before the letter); flattened `z0.005`.

#### bio-genetics-en
- Fixed: the blank Punnett grid is `tab1` (`caption` "Table in Task 1", `bbox [252.5, 227.5, 349.0, 301.5]`); its labels `p1.b9 "T t"`, `p1.b10 "T"`, `p1.b11 "t"` are `table_text` and inside `ex1.a`. `fig1` and `fig2` as before.
- Still wrong: the paragraph cut at the inline fraction (2.10) is unchanged: `p2.b8 "... substrate concentra-"` / `p2.b9 "tions [S] (Figure 2). ..."`; `"RrY y"`.

#### cs-algorithms-en
- Fixed: the blank trace table is `tab1` (`caption` "Table in Exercise 1", `bbox [211.0, 275.0, 384.0, 366.0]`), its cells `p1.b12 "iteration lo hi mid A[mid]"`, `p1.b13 "1 0 10"`, `p1.b14 "2"`, ... are `table_text` inside `ex1.a`.
  The four code frames on page 2 and the frame around the listing of Exercise 5 are *not* taken for tables or figures (all their pieces lie on the edge). `fig1` as before.
- Still wrong (skipped): code listings are flattened (2.7); the table's blank cells are not text.

#### school-math-de
- Fixed: `BE`: `ex1` `{"number": "1", "points": 6}` without a `title` (likewise 7, 8, 9; was `"title": "6 BE"`, `points` null). `fig1` ("Abbildung in Aufgabe 2", `bbox [226.0, 356.5, 368.5, 530.84]`) is the ladder with `h`, `α`, `l = 5,0 m`, the `1,4 m` dimension arrow and the note `p1.b19 "Skizze (nicht maßstabsgetreu)"`;
  `fig2` ("Abbildung in Aufgabe 4", page 2, `bbox [192.5, 144.0, 403.0, 314.0]`) is the parabola with its axes. `equ1 "l = 5,0 m"` is gone (it is a figure label now).
- Still wrong: exponents flattened (`p1.b9 "a) x2 −6x + 8 = 0"`); the header line is still scrambled (2.8); the axis ticks of `fig2` are several `figure_text` blocks (`p2.b4 "y 6 5"`, `p2.b10 "−3 −2 −1 −1 −2 −3 −4 −5"`, ...) in no useful order.

#### econ-micro-en
- Unchanged and still perfect: 4 / 4 tasks, 14 / 14 parts with all part points, `fig1`.

### 5.5 Not done, and why
- Matrices, display fractions, limits, integrals and roots (2.4): the glyphs MuPDF cannot map carry no character, so the text cannot be rebuilt from the extraction; rebuilding them would need glyph IDs or rendering and OCR of the formula.
  The Symbol-font bracket pieces (U+F8EB..U+F8FB, `eval-sheet-de` and `linalg-de` matrix A) were left as they are.
- Code listings (2.7), the paragraph cut at an inline fraction (2.10), the header lines typed `authors` (2.8), flattened superscripts and subscripts, accents before their letter, ion charges: not in the list of fixes, each needs its own work.
- Assigning formula blocks that sit around a part label to the right part (calculus `ex1.c`/`ex1.d`): only the label order is restored.
- A table without a caption gets no typed `grid`: the sheets' tables are blanks to fill in, and a grid read from a half-empty table misses rows (the ICE table loses its "Equilibrium" row, the trace table merges the header cells).

