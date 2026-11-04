# Tutor for exercise sheets (v2, 2026-11-03)

Aaron, 2026-11-03: exercise sheets in any subject (maths, chemistry, physics, biology, CS, economics, statistics)
must work properly. The tour investigates and explains like a university or school tutor would, step by step so the
learner can follow, with illustrations and background knowledge. Research on how tutors do this is in
[TUTOR-RESEARCH.md](TUTOR-RESEARCH.md); this note is the design we build.

## Where it stands (baseline)

The pipeline (`server/src/harness/exercise.ts`): one solve call per part (task, method, 1-4 solution lines, answer,
a try-first checkpoint with hints), code checks of the LaTeX and the maths (`ingest/verify_math.py`), at most one
method visual per task, and steps: task → try → method → lines → answer.

The 10-29 tour of MIT 18.05 problem set 2 shows the gaps:

- **Too compressed to follow:** 20 steps for 6 problems; most parts get one or two combined lines.
- **No background:** Bayes' rule, a pmf and indicator variables are used but never introduced.
- **No pictures:** only formula boards, although the problems ask for a tree, an icon array of 100 taxis, a pmf and a
  round table.
- **The working disappears:** each board shows one line, so the derivation is never visible as a whole.
- **"Unchecked" on most lines:** 1 of 13 lines could be verified, and every other line was labelled "unchecked".
- **Other problems:**
  - chapter titles such as "Problem 1: 20:" (points parsed as a title);
  - later parts skipped silently;
  - a maths-only prompt and example;
  - chemistry (`\ce{}`) does not render.

**Measured on 2026-11-03:**

- **Setup:** main at ce3ab80 on all 11 new test sheets: chemistry EN and DE, mechanics EN, circuits DE,
  genetics EN, calculus EN, algorithms EN, linear algebra DE, statistics EN, school maths DE and microeconomics EN.
  Each was a real run with muse-spark-1.3, the standard preset and the app's profile path, scored by
  `scripts/sheet-eval.mjs`.
- **Parts taught: 55 of 168.** Every sheet got 21-22 steps, which covers only the first part of each task.
- **Answers: 36 of 50 scored parts right.** Twelve more were partial: the answer step gave only one of the asked
  values. The algorithms sheet had none fully right.
- **No background steps, and only 11 pictures** in 239 steps.
- **The checker:** it confirmed 43 of 163 solution lines, rejected 1, and could not read the rest because of units,
  chemistry and words.
- **Run times:** 111-232 s per sheet.

**First run of the new tutor (2026-11-04, muse-spark-1.3-contributor, standard):**

- **Completed:** 6 of 11 sheets. The other 5 failed whole, each because of one authored visual: an invalid review
  response or a failed rendering check. That is fixed in round 3.
- **Parts taught: 65 of 98** on the six sheets (it was 33% of the parts before).
- **Answers: 50 of 59 right, 8 partial** (it was 72% right before).
- **The checker:** it confirmed 132 of 260 lines (51%, against 26% before), and 56 board lines carry a ✓.
- **Background steps: 0.** Every tour hit the 48-step budget, so every part was compact. In round 3 the budget rises to
  60 / 100 / 160 steps, so the first part of each task gets the full flow.

## The tutor's moves per part

These are the classic moves of a tutor: understand the problem, recall what is needed, plan, carry out the plan
step by step with reasons, then look back (Polya). They are taught as a worked example with self-explanation and
signalling (Renkl, Chi, Mayer).

| Step | Says | Page | Board |
|---|---|---|---|
| 1. Task | What is given, what is asked, and the kind of answer ("a mass in grams") | givens blue, the question yellow, a figure or formula circled | — |
| 2. Background (when needed) | The concept or law the part rests on: what it is in plain words, why this part needs it, one everyday picture | — | the law term by term (formula board) |
| 3. Try (checkpoint) | What to try first; up to 3 hints, from a nudge to almost the answer, none with the result | the question stays marked | — |
| 4. Plan | The method in order and why it fits | — | the method visual (setup, diagram, tree, grid), else the rule |
| 5. Steps 1..n | One move per step: what we do and why it works | — | the line, built term by term, under the earlier lines of the part |
| 6. Answer and check | The result in words, how we know it is right (substitute back, units, size, special case), the common mistake | the question turns green | the answer line under the working, then the check line; ✓ on lines code verified |

**Forms of a part:**

- **Full:** all six steps. This is the first part of a task in a standard tour, and every part in a deep tour.
- **Follow-on:** a later part of a task. It has no background, since it was given in part a; the method is short.
- **Compact:** for a quick tour or a long sheet. Task and method share a step, then the try, at most 3 lines, and the
  last line also carries the answer and a short check.

**Background is given once per concept in a tour.** Code normalises the concept name. A later part that needs the
same concept drops its background step, which is decided in tour order so that partial tours and the final tour agree.

**Lengths:**

| Preset | Most steps in a tour | Most solution lines per part |
|---|---|---|
| quick | 24 | 3 |
| standard | 48 | 5 |
| deep | 72 | 7 |

Parts that do not fit are named in the takeaway as "not covered", and every task keeps at least its first part. A
sheet is a working session, not an overview: chapters are tasks, and the learner jumps between them.

## Subjects

- **The card says the subject** (a new `subject` field). It chooses the worked example the solve call copies, since a
  weak model copies the format and depth of its example:
  - maths, statistics and economics: a calculation;
  - chemistry: stoichiometry with `\ce{}` and units;
  - physics and engineering: kinematics with units;
  - computer science: a trace.
- **Explanation-type parts get a second, shorter example.**
- **The solve call names the part's answer kind:** calculation, derivation, proof, explanation, chemical equation,
  choice, sketch or trace.
  - For an explanation or a proof, a board line may be a short statement in `\text{}` (8 words at most), so the
    board grows into the argument.
- **Chemistry is written with `\ce{}`.** KaTeX's mhchem extension renders it on the server (the LaTeX check) and in
  the player. Units are written as `\,\mathrm{g/mol}`, never with siunitx macros, which KaTeX does not have.
- **The sheet's visual plan describes the kinds for every subject:**
  - program: free-body diagrams, circuits, molecules, pedigrees, trace tables;
  - heatmap: Punnett squares, contingency and DP tables;
  - plotly and plot: titration curves, Michaelis-Menten, supply and demand, motion graphs;
  - flow: mole maps, algorithms, probability trees;
  - scene: forces and vectors.

## Checks

`verify_math.py` gains three checks:

- **Units:** a value with a unit converts to SI. Both sides of a relation must agree in dimension and value, so
  `0.5\,\mathrm{L} = 500\,\mathrm{mL}` holds. A line whose units cannot be read is unknown, never failed.
- **Chemistry:** a reaction in `\ce{}` must balance atoms and charge, and `M(\ce{H2O}) = 18.02\,\mathrm{g/mol}` is
  checked against standard atomic weights.
- **The check line:** the line of the answer step goes to the verifier with the solution lines.

On the board, a verified line gets a ✓. Unknown lines get no tag; "unchecked" on most lines read as distrust rather
than honesty. A line that failed after the repair keeps the spoken "please check this step".

## Robustness

Every tour in the app has a profile, so it runs in adaptive mode. There, one slow or unavailable part used to fail
the whole tour. A part now gets one more try and then falls back to pointing at its task text, recorded as left out.
The tour never fails because of one part.

## Evaluation

- **Test sheets:** `eval/sheets/` holds 11 sheets of our own in 7 subjects, in English and German, each with an answer
  key. `eval/sheets/build.sh` compiles them into `demo/local-sheet-*` and ingests them.
- **Ingestion:** `INGEST-REPORT.md` says what ingestion got wrong.
- **Scoring:** a scoring script compares each taught part's answer with the key. It also counts:
  - background steps, visuals, and verified and failed lines;
  - steps and words.
- **Runs:** `server/run-tour.ts` with the default profile, so the runs take the app's adaptive path.

## Work split (2026-11-03)

- **Tutor flow** (exercise.ts, exercise-examples.ts, card.ts, the sheet parts of generator.ts, visual-plan.ts sheet
  help, doctype.ts tone):
  - the solve schema v2, the six steps and three forms, background dedupe;
  - lengths, the adaptive fallback, and the subject.
- **Board** (shared/paper.ts and tour.schema.json done; player Board.tsx and board.css, server board.ts):
  - the working kept above the current line (`before`), the ✓ (`verified`);
  - mhchem in the player and the server.
- **Checks** (ingest/verify_math.py and its tests): units, chemistry, the check line.
- **Ingestion** (ingest/ingest.py and test_exercises.py): the problems of INGEST-REPORT.md, after the test sheets are
  built.
