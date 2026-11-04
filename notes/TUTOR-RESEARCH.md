# How tutors walk through exercises: research and design for Paper Tour

Research note, 2026-11-03, for the exercise-sheet tour in [TUTOR.md](TUTOR.md).

Source tags (section 5): **read** = I opened the page or PDF text. **cited** = citation confirmed in search results or
in a source I read; full text not opened. "(not verified)" marks a claim I could not check. Gaps: I found no Stanford,
TU Berlin, RWTH or KIT tutor guide, and the Berkeley GSI guide chapter on sections did not open. The German evidence
is from Bielefeld, TUM, FAU, Paderborn and Hamburg.

## 1. The tutor's moves in order

1. **Orient.** Say what the sheet covers and which ideas come back.
2. **Read the task.** Say it in plain words. Mark the givens, the question and the kind of answer. Sketch.
3. **Recall the idea.** Name the law or method in one breath, only if it is new.
4. **Let the learner try.** One small question about the first move, then wait.
5. **Hint in steps.** Nudge, then name the tool, then show the setup. Never the result.
6. **Show the plan.** Say why this method fits and how one finds it.
7. **Carry it out in small moves.** One move and its reason per step. Keep earlier lines in view.
8. **Say the result in words,** with unit and meaning.
9. **Look back.** Check by substitution, units, size or a special case. Name one common slip.
10. **Bridge and fade.** Say what changes next. Do a little less for the learner each time.

## 2. Evidence table

Full references, URLs and tags are in section 5.

| Move | What it does for learning | Sources |
|---|---|---|
| Orient | A map lets learners place each step. Paderborn tutors rarely put a task in context. | TUM 2018; Collins et al. 1991; Mayer 2017; Püschl 2013 |
| Read the task | Students jump to equations without analysis. Diagrams make relations easy to find. | Pólya 1945; Heller & Heller 2010; Larkin & Simon 1987 |
| Recall the idea | Experts skip steps novices need. Pre-training helps beginners, but fades and can reverse with experience. | CMU Eberly principle 5; Mayer 2017; Kalyuga et al. 2003 |
| Try | Self-explanation predicts learning. Tries before instruction raised conceptual learning. Beginners still learn faster from examples, so keep the try small. | Chi et al. 1989; Chi 1996; Kapur 2014; Sweller & Cooper 1985; Renkl & Atkinson 2003 |
| Hint ladder | Small hints keep the learner thinking. Hints on request beat pushed ones. Students click through to the last hint. | MIT TLL; Lepper & Woolverton 2002; Razzaq & Heffernan 2010; Aleven et al. |
| Plan | Makes expert thinking visible: how does one get the idea? | Collins et al. 1991; Blunck & Hodel 2019 |
| Small moves with reasons | Worked examples cut load. Explaining why a step is allowed predicts learning. Small steps, then practice. | Sweller & Cooper 1985; Atkinson et al. 2000; Chi et al. 1989; Rosenshine 2012 |
| Show and tell | Speech plus one picture, cues, no duplicate text, no extras. | Mayer 2017; Mayer & Moreno 2003; Harp & Mayer 1998 |
| Result, look back | In statistics, interpreting is the goal. Experts check; novices rarely do. | GAISE 2016; Pólya; Heller & Heller; Smith & Good 1984 |
| Common slips | Contrasting wrong examples builds concepts. Tutors rarely diagnose misconceptions. | Booth et al. 2013; Chi 1996; McDermott & Shaffer (PhysPort) |
| Fade | Move from example to problem in stages. Faded prompts beat constant ones. | Renkl & Atkinson 2003; Collins et al.; Rosenshine; McNeill et al. 2006; Pearson & Gallagher 1983 |
| Step-level grain | Step-based tutoring d = 0.76, human tutoring d = 0.79, both above answer-only. | VanLehn 2011 |
| Tutoring frame | Question, attempt, feedback, scaffold, check. "Do you understand?" is nearly useless. | Chi 1996, after Graesser et al. 1995 |
| Hard parts first | Four of six tutors skipped the hard setup parts and spent the time on calculations most students had right. | Püschl 2013; Kenner 2025 |

Cautions:

- A replication of Wood, Bruner & Ross's 1978 follow-up reportedly found no support for contingent help (secondary
  report, not verified). Treat "adapt help to the learner" as a principle, not a proven mechanism.
- Worked examples and trying first pull apart. Expertise reversal settles it: examples for beginners, tries for
  learners who know the basics.

## 3. Subject adaptations

### Maths (calculation, derivation, proof)

- **Calculation:** unknown, givens and formula first. Then the algebra, naming each operation.
- **Derivation:** goal line first. A reason at every equals sign. Mark the one key trick.
- **Proof:** keep scratch work (backward from the goal, forward from the hypotheses) apart from the clean proof. This is
  Velleman's *How to Prove It* method (catalog descriptions only). Name the strategy and why it fits ("how does one
  get the idea?", Blunck & Hodel 2019).
- **Checks:** a small case (n = 1, 2), a special value, sign and size.

### Physics

- **Sketch first:** givens labelled, axes and signs chosen. For forces, a free-body diagram: one object, labelled arrows.
- **Heller's five steps:** recognize, describe, plan, execute, evaluate. Students otherwise plug into equations.
- **Symbols first:** solve in symbols, check the units, then substitute.
- **Evaluate:** units, size against experience (their example: about ten car lengths to stop), limiting cases.
- **GUESS and GRASS** recipes: no source opened (not verified). Heller's steps are the documented version.

### Chemistry

- **Dimensional analysis:** each conversion is a fraction equal to 1; the unwanted units cancel.
- **Mole map:** grams to moles, the ratio from the balanced equation, back to grams.
- **Balancing:** count atoms and charge in a small table.
- **ICE table:** initial, change (coefficient times x), equilibrium. Balanced? Solids left out? Discard negative
  roots. Test the "x is small" shortcut.
- **Rounding and size:** state the sheet's rounding rule. Bound the answer ("under 6 mol, since the sample is under
  two moles").

### Statistics

- **Follow the cycle:** question, data, analysis, interpretation (GAISE).
- **Hypotheses first,** in words and symbols. Name the test. Check conditions before computing.
- **End with a sentence in context.** Keep significance and causation apart.
- **Checks:** probabilities lie in 0 to 1 and add up.

### Computer science

- **Trace a tiny example by hand first:** one row per step, one column per variable. Novices trace badly (Lister et al. 2004).
- **Invariants:** state what stays true; check it before the loop, after one pass and at the end.
- **Complexity:** count steps for n = 1, 2, 4, then generalise.
- **Algorithms:** edge cases (empty, one item, duplicates). Recursion: draw the call tree.
- **Code answers:** idea in words, then code, then a run on a tiny input.

### Biology and genetics

- **Define symbols first:** alleles, dominance, parent genotypes. Dominant does not mean common.
- **Punnett square:** gametes on the edges, offspring in the cells, then count.
- **Pedigree:** test every inheritance hypothesis. Skipping some is a known error (Smith 1988, secondary, not verified).
- **Checks:** ratios add up; genotype and phenotype are not mixed; the pedigree fits.

### Economics

- **Draw first:** labelled axes and curves, the starting equilibrium.
- **Ask "what changed?"** Own price: move along the curve. Any other cause: shift (Roberts).
- **Chain:** cause, curve, direction, new equilibrium, effect on price and quantity. One curve at a time, D1 to D2.
- **Calculations:** demand equals supply, then substitute back.
- **Slips:** a price change called a shift; supply and demand mixed up.

### Conceptual and essay questions

- **Claim, evidence, reasoning** (McNeill et al. 2006, who faded the prompts over time).
- **Board:** a three-line skeleton filled step by step. A model answer stays under about 60 words.
- **Checks:** does the claim answer the question? Is every piece of evidence used?
- **Slip:** retelling the lecture without using it to answer the question asked.

## 4. Design for Paper Tour

### 4.1 Per-task step template (full form)

**First step of the tour, once: overview** (20-40 words). "This sheet has 5 tasks. Tasks 1 and 2 use Bayes' rule, task 3
a tree. You can jump to any task." The board lists the tasks with their key idea.

**Per task, in this order:**

| # | Step | Says (words) | Page | Board |
|---|---|---|---|---|
| 1 | Task | "Task 2 asks for [kind of answer]. We know [givens]. We want [unknown]." (15-35) | Givens blue, question yellow, circle one key word ("at least") | Nothing, or a sketch if the task is a situation, graph or structure, with the sheet's labels |
| 2 | Background, if needed | "[Name] says [plain words]. We need it because [link to this task]." (25-45) | Usually nothing | The law, term by term, each term named. One picture at most |
| 3 | Try (checkpoint) | One question about the first move: "Before I show it: which law connects what we know to what we want?" (15-30) | Question stays marked | Nothing new |
| 4 | Plan | "The way in is [first move], because [reason]. Then [second], then [third]." Add a cue to spot: "'at least' means use the complement." (20-40) | Highlight the cue word | The method visual (setup, mole map, tree) or the rule |
| 5 | Moves (1-5 steps) | "[Move], because [reason]." (15-40 each) | Highlight the number just used | One new line under the earlier lines, term by term |
| 6 | Answer and check | "So [result in words, unit, context]. Check: [one check]. A common slip: [wrong move and why it fails]." (30-50) | Question turns green | Answer line, then check line |
| 7 | Bridge, optional | "Part b keeps [what stays], but [what changes]." (up to 20) | Mark moves to part b | Keep old lines if reused |

Why this order:

- **Try before plan.** The learner knows the question and the idea in play, but not the way in. This is the quiet
  five minutes of an Übung (Bielefeld) and the prompt-then-explain pattern of tutoring (Chi 1996).
- **Plan before moves.** Tutors show how one finds the method, not only that it works (Collins et al.).
- **Check inside the answer step.** Pólya's last phase and Heller's step 5 both end there.

### 4.2 Forms, compression and what a tutor skips

Code, not the model, should pick the form from the position in the sheet, the tour length and what was taught.

- **Full:** all steps. The first part of a task that brings in a method; every part in a deep tour.
- **Follow-on:** a later part, or a later task with a known method. The task line says "same method as 1a, but ..."
  (up to 20 words). No background, no plan step. The try moves to the first new decision. Only changed lines.
  This is fading: the learner does more each time (Renkl & Atkinson; Rosenshine's completion problems).
- **Compact:** task and plan share a step, one try, at most three lines, the last carrying answer and check.

| A tutor skips | Shortens | Never skips |
|---|---|---|
| Restating the printed task | Background already taught: one recall line | The givens and the question |
| Re-deriving a lecture law: name it | The plan, when the method repeats | The setup: drawing, assumptions, units |
| Routine algebra: show before and after | Common slip: once per task | The key decision |
| A repeated method: setup, result, check | Checks: one per part | The result in words |

Why: Paderborn tutors did the opposite and skipped setup and graphs where students were weak (Püschl 2013). FAU tutors
report sheets so long that teaching room is small (Kenner 2025). Routine steps waste time for learners who know them
(Kalyuga et al.). When the step budget runs out, drop whole later parts and name them in the takeaway ("not
covered"). Keep full form for tasks with a new concept.

### 4.3 How fine the steps are

- **One idea per step:** one board line, one reason, 15-40 words. Only background and the answer step may reach 50.
- **Split what feels like one step.** An expert's step is usually two for a beginner.
- **Merge arithmetic, never decisions.** Two routine operations may share a step. A method choice, an assumption or a
  sign convention gets its own.
- **Name each symbol when it first appears.** Speech says why and what it means; the board shows what.
- **The board line appears when its sentence starts,** and the page mark sits on what is being discussed.

### 4.4 Background knowledge: when, how much, no repeats

**A background step only if all three hold:** the solution uses a named law, definition or technique the sheet does not
state; the tour has not taught it yet (code keeps the list); and it is not basic for the level.

**Size:** 25-45 words: what it is in plain words, the formula term by term on the board, why this task needs it. One
everyday picture only if it carries the structure (100 taxis for Bayes). Teach only the part this task uses.

**Where:** right before the try. The overview step names the sheet's two to four concepts up front (pre-training,
Mayer; the "picture of the whole", Collins et al.).

**No repeats:** a later task with the same concept gets a recall line: the formula on the board and at most 12 words
("Bayes' rule again, as in task 1."). The learner can jump to any task, so the line says where the idea was taught.
If the task is to state or explain the concept, skip the background.

### 4.5 Checkpoints and hints

- **Where:** one checkpoint per part at most. Full form: after the background, before the plan, about the first move.
  Follow-on: at the first new decision. Once per task a prediction also works: "Bigger or smaller than 10?"
- **Never** at the final answer, at bare arithmetic, or on a step just explained.
- **Question rules (FAU):** open, short, one thing, hard but possible. Ask for a decision, a sign or a size. Never
  "Do you understand?" or "Any questions?" Students cannot tell whether they understand (Chi 1996).

**Hint ladder** (up to three, each at most 20 words, only when asked):

| Hint | Does | Example ("at least one") |
|---|---|---|
| 1 Nudge | Says where to look or what kind of problem. Highlights a place on the page. | "Look at 'at least one'. Which cases count?" |
| 2 Tool | Names the idea, not how to arrange it. | "Counting the opposite case is often easier." |
| 3 Setup | Writes the first move up to the unknown; the result stays blank. | "Write P(none) first: three misses, so multiply three chances." |

**Hint rules** (the first can be checked in code):

- No hint holds the final answer or a number that decides it. Each is more specific than the last, and no longer.
- Hints come on request only. On-demand hints beat pushed ones (Razzaq & Heffernan 2010). Software users often click
  to the last hint (Aleven et al.), so the last must stop one move before the result.
- Never grade the try; the tour cannot see it. Use an indirect cue: "If your first line differs, compare the sign
  in ..." (MIT TLL).
- The first reveal step starts "Compare with your idea" and reuses the hint's words. The common-slip sentence turns
  a wrong try into a useful contrast (Booth et al. 2013).

### 4.6 Showing uncertainty

Tutors say "let me check that" and send the fix later (Bielefeld). Use three states:

| State | Board | Speech |
|---|---|---|
| Code verified the line | Small tick | Normal, no hedge |
| Not verifiable (sketch, explanation, unreadable units) | No tag | Normal; the answer step shows the learner a check: "Put x = 2 back in." |
| Check failed after repair | Neutral warning mark; dependent lines say "builds on the step above" | "I could not confirm this step. Check it by [substituting back]." |

- **Hedge only the failed line.** "Unchecked" on most lines reads as distrust (TUTOR.md).
- **Say what is missing:** a figure that did not come through goes in the task's first step.
- **Model checking:** weak learners monitor themselves poorly (Chi et al. 1989), so every answer step shows one check.

### 4.7 Illustrations: what helps, what is decoration

A picture earns its place if it shows a relation words can only state (Larkin & Simon: less search, easier pattern
spotting), is named in the same step, is built in the order spoken, and uses the sheet's labels.

| Subject | Helps | Decoration to avoid |
|---|---|---|
| Maths | Graph with marked points, number line, tree, case-split diagram | A plot nobody asked about |
| Physics | Sketch with axes, free-body diagram, motion graph, vector triangle, circuit | Clip-art cars; unlabelled arrows |
| Chemistry | Mole map, atom-count table, ICE table, titration or rate curve | Lab-glass icons |
| Statistics | Data plot with a shaded tail, tree, icon array, 2 by 2 table | Pie charts; a chart of two numbers |
| CS | Trace table, call tree, array with pointers, state diagram | Code windows for show |
| Biology | Punnett grid, pedigree, pathway flow, labelled structure | Stock photos |
| Economics | Supply and demand with D1 to D2 and both equilibria | The same graph redrawn per cause |
| Conceptual | Claim, evidence, reasoning skeleton | Bullet walls; an icon per bullet |

Animate only a change that matters (a curve shifting, a tail being shaded): one per step, never looping. Off-topic
extras hurt learning (Harp & Mayer 1998).

### 4.8 Never do

1. **Read the solution aloud,** or a formula symbol by symbol. Say what it means.
2. **Restate what is printed.** Say the kind of answer and the givens.
3. **Build a wall of formulas.** One new line per step. Clear the board between tasks.
4. **Explain the obvious** for this level. Equally, never skip the non-obvious.
5. **Put the answer in a hint** or in the try question.
6. **Ask "Do you understand?", "Is that clear?" or "Any questions?"**
7. **Say "simply", "obviously", "as you can see", "easy to see", "just".** Nobody is put on display (Bielefeld).
8. **Praise in general terms.** Praise the process, rarely (MIT TLL).
9. **Spend the steps on arithmetic and skip the setup** (Püschl 2013).
10. **Use a symbol or trick without naming it,** or change the sheet's notation.
11. **Teach the same background twice.** Use a recall line.
12. **Add a picture without structure,** or two pictures in one step.
13. **Mark the page without saying why.** Mark and words must match.
14. **State a number without its unit,** or present an unverified line as sure.
15. **Talk longer than 60 words in a step.** Long explanations after an error lack evidence (Chi 1996).

Code can enforce items 5, 6, 7, 14 and 15, the word ranges of 4.1, one board line per step, one checkpoint per part
and background only if not yet taught. That keeps a weak model on the template.

### 4.9 What this adds to TUTOR.md

- An **overview step** at the start of a tour, a **bridge step** between parts, and a **common slip** once per task.
- A **try about the first move only;** follow-on parts try at the first new decision.
- A **recall line** for concepts taught before, and **hint rules** with a code check that no hint holds the answer.
- **Steps go to setup and interpretation,** not arithmetic.

## 5. Sources

Tags: **read** = text opened; **cited** = citation confirmed, full text not opened.

**Tutor guides and studies of exercise sessions**

- Bielefeld slides (2020, no author in the file). *Tutorenschulung TechFak - Best Of.* https://www.math.uni-bielefeld.de/~frettloe/teach/tutorenschul/tutorentipps.pdf (read)
- Hafner, Bayer, Starmans & Strasser (2018). *Wie halte ich ein gelungenes Tutorium?* TUM ProLehre. https://www.prolehre.tum.de/fileadmin/w00btq/www/Angebote_Broschueren_Handreichungen/Hochschuldidaktische_Handreichung_gelungenes_Tutorium.pdf (read)
- Kenner (2025). *Leitfaden Tutorien erfolgreich meistern.* FAU. https://www.lehre.fau.de/files/2025/10/FAU-Kompetenzzentrum-Lehre_Leitfaden-Tutoren_Tutorien-erfolgreich-meistern.pdf (read, parts)
- Püschl (2013). *Wie besprechen Tutoren Hausaufgaben?* Paderborn; likely Beiträge zum Mathematikunterricht 2013 (not verified). https://eldorado.tu-dortmund.de/bitstreams/9ef41a46-51d9-4900-806d-00743e193a84/download (read)
- Blunck & Hodel (2019). *Tutorenschulung in der Mathematik.* Uni Hamburg Lehrlabor. https://www-archiv.fdm.uni-hamburg.de/uk/www.universitaetskolleg.uni-hamburg.de/publikationen/praxisberichte-lehrlabor/lehrlabor-pb-min-tutorenschulung-mathe-blunck.pdf_%3b%20filename_%3dUTF-8%27%27lehrlabor-pb-min-tutorenschulung-mathe-blunck.pdf (read, abstract to methods)
- MIT Teaching + Learning Lab. *Facilitate Office Hours.* https://tll.mit.edu/teaching-resources/how-to-teach/facilitate-office-hours (read)
- CMU Eberly Center. *Teaching Principles.* https://www.cmu.edu/teaching/principles/teaching.html (read)

**Learning science and tutoring research**

- Pólya (1945). *How to Solve It.* Phases as summarised at https://people.math.harvard.edu/~knill/teaching/math21b2001/polya/index.html (read)
- Rosenshine (2012). Principles of instruction. *American Educator* 36(1). https://www.aft.org/sites/default/files/periodicals/Rosenshine.pdf (read)
- Collins, Brown & Holum (1991). Cognitive apprenticeship: making thinking visible. *American Educator.* https://www.isls-naples.psy.uni-muenchen.de/intro/all-webinars/collins/cognitive-apprenticeship.pdf (read; the 1989 Collins, Brown & Newman chapter is cited there)
- VanLehn (2011). The relative effectiveness of human tutoring, intelligent tutoring systems, and other tutoring systems. *Educational Psychologist* 46(4), 197-221. https://eric.ed.gov/?id=EJ946764 (read, abstract)
- Chi (1996). Constructing self-explanations and scaffolded explanations in tutoring. *Applied Cognitive Psychology* 10, S33-S49. https://education.asu.edu/sites/default/files/lcl/selfex96_3.pdf (read). Graesser, Person & Magliano (1995) is cited there; original not read.
- Chi, Bassok, Lewis, Reimann & Glaser (1989). Self-explanations. *Cognitive Science* 13, 145-182. https://education.asu.edu/lcl/publications/chi-m-t-h-bassok-m-lewis-m-reimann-p-glaser-r-1989-self-explanations-how-students (cited; PDF is a scan)
- Lepper & Woolverton (2002). The wisdom of practice: lessons learned from the study of highly effective tutors (INSPIRE). https://stafforini.com/works/lepper-2002-wisdom-practice-lessons/ (read, abstract)
- Wood, Bruner & Ross (1976). The role of tutoring in problem solving. *J Child Psychol Psychiatry* 17(2), 89-100. https://pubmed.ncbi.nlm.nih.gov/932126/ (cited). Replication doubt: https://carlhendrick.substack.com/p/we-need-to-talk-about-scaffolding (secondary, not verified)
- Razzaq & Heffernan (2010). Hints: is it better to give or wait to be asked? https://web.cs.wpi.edu/~nth/pubs_and_grants/papers/2010/ITS/Razzaq%20Hints%20Is%20It%20Better%20to%20Give%20or%20Wait.pdf (read). It reports Aleven et al. (2006) on help-seeking. Click-through to the last hint: https://learnlab.org/research/wiki/index.php/Help_abuse (cited; page did not open)
- Sweller & Cooper (1985). Worked examples as a substitute for problem solving in algebra. *Cognition and Instruction* 2, 59-89. https://en.wikipedia.org/wiki/Worked-example_effect (cited, secondary)
- Renkl & Atkinson (2003). Structuring the transition from example study to problem solving. *Educational Psychologist* 38, 15-22. https://asu.elsevierpure.com/en/publications/structuring-the-transition-from-example-study-to-problem-solving--2 (cited)
- Atkinson, Derry, Renkl & Wortham (2000). Learning from examples. *Review of Educational Research* 70(2), 181-214. https://doi.org/10.3102/00346543070002181 (cited)
- Kalyuga, Ayres, Chandler & Sweller (2003). The expertise reversal effect. *Educational Psychologist* 38(1), 23-31. https://ro.uow.edu.au/edupapers/136 (cited)
- Kapur (2014). Productive failure in learning math. *Cognitive Science* 38(5), 1008-1022. https://dblp1.uni-trier.de/rec/journals/cogsci/Kapur14.html (cited)
- Mayer (2017). Using multimedia for e-learning. *J Computer Assisted Learning* 33(5), 403-423. https://doi.org/10.1111/jcal.12197 (cited; effect sizes not verified, so none are used)
- Mayer & Moreno (2003). Nine ways to reduce cognitive load in multimedia learning. *Educational Psychologist* 38(1), 43-52. https://www.uky.edu/~gmswan3/575/9_ways_to_reduce_CL.pdf (cited; copy would not open)
- Harp & Mayer (1998). How seductive details do their damage. *J Educational Psychology* 90. https://www.cambridge.org/core/books/abs/multimedia-learning/coherence-principle/4E80B70CB76E2166B76E5653EBDE7D3E (cited)
- Larkin & Simon (1987). Why a diagram is (sometimes) worth ten thousand words. *Cognitive Science* 11, 65-99. https://www.jimdavies.org/summaries/larkin1987.html (read, summary)
- Booth, Lange, Koedinger & Newton (2013). Using example problems to improve student learning in algebra. *Learning and Instruction* 25, 24-34. https://serpinstitute.org/algebra-by-example/research (cited)
- McNeill, Lizotte, Krajcik & Marx (2006). Supporting students' construction of scientific explanations by fading scaffolds. *J Learning Sciences* 15(2), 153-191. https://experts.arizona.edu/en/publications/supporting-students-construction-of-scientific-explanations-by-fa/ (cited)
- Pearson & Gallagher (1983). The gradual release of responsibility model. *Educational Leadership* 41(3), 75-77. https://en.wikipedia.org/wiki/Gradual_release_of_responsibility (cited, secondary)

**Subjects**

- Heller & Heller (2010). *Cooperative Problem Solving in Physics: A User's Manual.* https://www.aapt.org/Conferences/newfaculty/upload/Coop-Problem-Solving-Book.pdf (read). Why the steps exist: https://groups.spa.umn.edu/physed/Research/CGPS/CGPSintro.htm (read)
- PhysPort. *Tutorials in Introductory Physics* (McDermott, Shaffer & UW PEG). https://physport.org/methods/Tutorials_in_Introductory_Physics (read)
- Smith & Good (1984). Problem solving and classical genetics. *J Research in Science Teaching* 21(9), 895-912. https://zendy.io/title/10.1002/tea.3660210905 (cited). Smith (1988), pedigrees: https://scilit.com/publications/2cc49b1942443bab2759af1a51a7a280 (cited, secondary)
- LibreTexts, Brevard College. *Dimensional Analysis.* https://chem.libretexts.org/Courses/Brevard_College/LNC_216_CHE/02%3A_The_Mathematics_of_Chemistry/2.02%3A_Dimensional_Analysis (read)
- LibreTexts. *Ice Tables.* https://chem.libretexts.org/Bookshelves/Physical_and_Theoretical_Chemistry_Textbook_Maps/Supplemental_Modules_(Physical_and_Theoretical_Chemistry)/Equilibria/Le_Chatelier%27s_Principle/Ice_Tables (read)
- LibreTexts, Madera College. *Mole Road Map.* https://chem.libretexts.org/Courses/Madera_Community_College/MacArthur_Chemistry_3A_v_1.2/04:_The_Mole_Concept/4.10:_Mole_Road_Map (cited; the "under 6 mol" example may be on a neighbouring page of that course)
- Carver et al. (2016). *GAISE College Report.* https://amstat.org/asa/files/pdfs/GAISE/GAISECollege_Full.pdf (read)
- Roberts. *Common Mistakes Using Supply and Demand.* https://russroberts.info/classroom-resources/common-mistakes-using-supply-and-demand/ (read)
- Lister et al. (2004). A multi-national study of reading and tracing skills in novice programmers. *SIGCSE Bulletin* 36(4), 119-150. https://dblp.dagstuhl.de/rec/journals/sigcse/ListerAFFHLMMSSST04.html (cited). Sorva (2013), *Notional machines and introductory programming education,* ACM TOCE 13(2): seen only as a citation in search results (URL not verified).
- Velleman, *How to Prove It* (Cambridge UP). Catalog description: https://link.library.eui.eu/resource/3BsxZkZn2X8 (cited)

