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

**After round 3 (2026-11-04, same model and preset, all 11 sheets):**

- **Completed:** 11 of 11.
- **Parts taught: 169 of 169.**
- **Answers: 126 of 146 scored parts right**, 17 partial (the answer step stated only some of the asked values).
- **Background steps: 44, pictures: 37.**
- **The checker:** it confirmed 354 of 707 lines; 302 board lines carry a ✓, and 2 lines still failed after the repair
  (they ask the learner to check them).
- **Length:** tours of 73-102 steps (13-26 minutes of narration).

## The tutor's moves per part

These are the classic moves of a tutor: understand the problem, recall what is needed, plan, carry out the plan
step by step with reasons, then look back (Polya). They are taught as a worked example with self-explanation and
signalling (Renkl, Chi, Mayer). The model chooses which moves a part needs; the table lists what each one does.

| Step | Says | Page | Board |
|---|---|---|---|
| 1. Task | The situation and what we are after, in the tutor's own words, and the kind of answer ("a mass in grams") | givens blue, the question yellow, a figure or formula circled | — |
| 2. Toolkit (the first part of a task) | The formulas, definitions or laws the task needs: what each does, how it works intuitively (a tiny example or an everyday picture) and how it will answer the task's questions | — | the law term by term (formula board) |
| 3. Try (checkpoint, only with a real first move) | What to try first; up to 3 hints, from a nudge to almost the answer, none with the result | the question stays marked | — |
| 4. Plan (only when the steps do not say it) | The method in order and why it fits | — | the method visual (setup, diagram, tree, grid), else the rule |
| 5. Steps 1..n | One move per step: what we do and why it works | — | the line, built term by term, under the earlier lines of the part |
| 6. Answer and check | The result in words, how we know it is right (substitute back, units, size, special case), the common mistake | the question turns green | the answer line under the working, then the check line; ✓ on lines code verified |

**Forms of a part:**

- **Full:** all the moves. This is the first part of a task in a standard tour, and every part in a deep tour.
- **Follow-on:** a later part of a task. Its toolkit is mostly given with the first part (which sees the later parts'
  text for that), so it has a tool only for an idea the parts before did not need; the method is short.
- **Compact:** for a quick tour or a long sheet. Its tool and its method are said inside the task step, then the try, at
  most 3 lines, and the last line also carries the answer and a short check.

**A tool is given once per tour.** Code compares each tool by its name (normalised) and by its formula, so that two
parts that name one law differently still share it. A later part that needs a tool the tour has given recalls it in one
sentence of its task step (the model writes that "recall" with the tool), with the law back on the board, and has no tool
step. The decision is made in tour order, so that partial tours and the final tour agree.

**Lengths:**

| Preset | Most steps in a tour | Most solution lines per part |
|---|---|---|
| quick | 60 | 3 |
| standard | 100 | 5 |
| deep | 160 | 7 |

Parts that do not fit are named in the takeaway as "not covered", and every task keeps at least its first part. A
sheet is a working session, not an overview: chapters are tasks, and the learner jumps between them.

## Flow (2026-11-04)

Aaron watched a sheet tour and said it needed "a general flow": the task number is not said before every part, "1 is the
question" is not the opening of every task, the tour goes over what is given (the formulas, what they do, how they work
intuitively and how they answer the questions), and it is not templated. The cause was in the solve call: its fields fixed
the read-out ("what is given, what is asked"), the background came only when a student "may not have it ready", every
part had a checkpoint and a method, the steps were always task, try, steps, and the worked examples opened with "We are
given ...", which the model copies. Of the 25 tasks of the German test sheet, each opened "Gegeben sind ..., gesucht
ist ...", then "Versuche zuerst ...", then two "Wir ..." steps.

- **Toolkit.** `background` is now `tools` (up to two for a full part, one otherwise): each has a name, the plain words
  (what it does, an intuition and how it answers the question), a one-sentence recall and the law on the board. The first
  part of a task is shown the later parts it teaches (`Unit.ahead`) so that its toolkit covers the task; later parts add a
  tool only for an idea the earlier parts did not give. The compact form says its tool inside the task step.
- **Free moves.** The checkpoint (empty prompt), the method (empty say), the check and the pitfall are all optional; the
  model picks them per part and the step count within the preset's cap. A method visual whose part has no method step
  gets its narration from the visual call, so the picture still has a host.
- **Examples.** Six examples that differ in shape: one to two tools, with and without checkpoint and method, two to four
  lines, none opening with "Given" or "We are given", each step opening differently, and a follow-on part (the second
  example for a part that goes on from an earlier one).
- **Code checks** (`exercise-voice.ts`): a narration that opens with a templated opening ("Given", "We are given",
  "Gegeben ist", "Gesucht ist", and the equivalents in French, Spanish, Italian, Portuguese, Dutch, Russian, Chinese,
  Japanese, Korean and Arabic) or with a task label ("In exercise 3", "Aufgabe 4.2 b", "Part b asks"), and a later part
  that names its own task or part, are sent back with the words they opened with, once, with the other repairs. The
  first part of a task may name it once. A part that is still templated after its repair is taught all the same.

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

- **Tutor flow** (exercise.ts, exercise-examples.ts, exercise-voice.ts, card.ts, the sheet parts of generator.ts,
  visual-plan.ts sheet help, doctype.ts tone):
  - the solve schema v3, the moves and three forms, the toolkit and its dedupe;
  - lengths, the adaptive fallback, and the subject.
- **Board** (shared/paper.ts and tour.schema.json done; player Board.tsx and board.css, server board.ts):
  - the working kept above the current line (`before`), the ✓ (`verified`);
  - mhchem in the player and the server.
- **Checks** (ingest/verify_math.py and its tests): units, chemistry, the check line.
- **Ingestion** (ingest/ingest.py and test_exercises.py): the problems of INGEST-REPORT.md, after the test sheets are
  built.
