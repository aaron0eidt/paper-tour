# Status (2026-10-30)

## The generation pipeline now (2026-10-30)

- **How a tour is written** (`server/src/harness/generator.ts`; [HARNESS.md](HARNESS.md) has the detail): for a paper
  the card and the claims are asked in parallel, and the opening step's visual is planned alone from the card, so that
  the first step does not wait for the plan of the whole tour. That plan is one call at medium effort, and code holds
  it to the diversity limits (each board kind once, formula and plot twice, at most 60% of the steps with a board).
  The steps are directed in parallel, each from a schema that lists only the IDs it may point at. Code checks every
  narration, pen mark, example and board; what still fails after two corrections is dropped and recorded (the degrade
  ladder), so one bad board never fails the tour.
- **Time and progress:** every call has a time limit, and a step has 40 s for repairs, a repair after an unusable first
  try included; a slow call is asked again at once, lean when it had a board planned. The finished leading steps are
  announced as partial tours, which the reader plays while the rest is written.
- **Quick checks** (a prediction or recall question after a chapter, practice and never graded) keep tours concise:
  none in a quick tour, one in a standard one, two in a deep one.
- **Changed today:** the visual plan reasons at medium (papers got only 3 to 4 boards at low); the check limits above;
  the repair cap; `minimal` is a member of the `Effort` type, so its casts are gone; the claims and the opening visual
  have readable labels in the generation activity.
- **Checks:** the server type-check passes and all 695 server tests ran (688 passed, 7 database skips). No real model
  call was made for this entry, so the effect of the new check limits and of the medium plan on real tours is not
  measured.

## The richer-visuals branch (2026-10-29, evening)

- **Where it is:** `feat/richer-visuals`, six commits on main from 15:08 to 20:23, not merged. They add:
  - heatmap, scatter and shapes boards, a whole-tour visual plan, direct narration and the paraphrase and repeated-board
    checks ([VISUALS-V2.md](VISUALS-V2.md)); the default preset is `standard` again;
  - a degrade ladder (a step loses a failing board, example or pen marks, not the tour), rejection of weak boards, and
    SAM 3.1 snapping of a learner's selection ([META-MODELS.md](META-MODELS.md));
  - `Tour.doc_type` and `Step.checkpoint` in both contracts, and a tour of its own for each type: claims for papers, a
    deck planner and filmstrip for lecture slides, try-first checkpoints for exercise sheets;
  - real table data and unnumbered equations as targets, and progressive playback in the reader.
- **Evidence:** seven real runs on `muse-spark-1.3`, `standard`, `harness@26`, at about 19:43: four papers, one
  lecture deck, two exercise sheets (English and German). 97 steps, 4,790 words, 105 model calls, about $3.12 at list
  price, 45 to 120 s per tour, all eight board kinds used, no repeated board data, all 313 pointed IDs exist, and none
  of the seven failed. `node scripts/scorecard.mjs <tour folders>` prints the numbers without model calls; its output
  is in the README. Seven documents are not a benchmark.
- **Weak spots the runs show:**
  - Three of eight document boards have numbers the text does not print (two Casimir bars in arbitrary units, one deck
    bar of ratios derived from illustrative counts), and none is declared illustrative.
  - The sheets drew formula boards only (their visual plan fell back), and only 11 of 28 solution lines could be checked
    numerically (1 of 13 on the English sheet).
  - One Casimir figure step lost its pen marks to the degrade ladder.
- **Checks while writing this entry:** the player type-check, the player suites and `validate.py demo/attention`
  pass. The server type-check fails and 6 server tests fail (531 of 544 pass, 7 skipped) in the board registry, the
  direction and plan prompts and the tour schema, while timeline and distribution boards are being added in the same
  checkout; they are not a regression of the commits above. The scorecard test passes
  (`node --test scripts/scorecard.test.mjs`; the root `npm test` does not run it).
- **Needs Aaron:** the README "Provenance and team" section is a marked placeholder (dates, authors, what existed before
  the event, third-party code and documents). There is no LICENSE file yet, and "Paper Tour" is a working name.

## Check after the 10-29 merges (2026-10-29)

- **Checks:** on main after PR #2, the build and every suite pass: player suites, server 276 passed / 7 database
  skips, ingestion 62 passed / 2 skips.
- **Two real unedited runs** of *Attention Is All You Need* through `server/run-tour.ts` with the default `deep` preset
  and muse-spark-1.3: after PR #1 (harness@21) 21 steps, 1,653 words, 22 model calls, 72 s; after PR #2 (harness@22)
  21 steps, 1,589 words, 28 model calls, 72 s. Neither had fallback or omitted beats. Steps 1, 8, 11, 13, 20 and 21 of
  the first were watched in the reader at 1440×900.
- **Good:** crisp figure zooms; formula boards build `softmax(QKᵀ/√d_k)V` and the feed-forward network term by term in
  readable colours; worked examples with labelled illustrative values (scores before and after the √d_k scaling, raw
  scores to weights to output, ReLU hidden activations); result bars; the second run adds a plot of cost against
  sequence length.
- **Issues:**
  1. Length: 21 steps and about 10-11 minutes of narration, against 11 steps in the earlier standard run. Chapters
     follow pages, so the Table 2 results sit under "Page 8 · Regularization".
  2. Doubling across steps: in the second run, steps 18, 19 and 20 all chart the same English-German BLEU numbers
     (26.36, 27.3, 28.4), and steps 10, 11 and 13 each work through scores, softmax weights and output. In the first,
     steps 18 and 19 both presented the English-German result, and step 1's scene restated the highlighted abstract
     sentence as two boxes. The insight guards work within a step, not across steps.
  3. A misleading badge: in the first run, the parsing bars marked the Transformer (91.3 F1) "Best", but Table 4 lists
     Dyer et al. at 91.7 in the same WSJ-only setting, and the narration said the Transformer stays below it. The bars
     renderer (`player/src/components/Board.tsx`, from 10-27) badged the highest bar shown, so a model-chosen subset
     could mislead. Fixed on 10-29: no bar is badged or coloured for its size; the bar the narration is on stands out,
     and the unit chip says which way is better (`F1 ↑`).
  4. Plots: the second run uses one, but positional encoding still gets no board, and neither run explains the sine
     and cosine functions.
  5. The floating ask tray covered page text at the bottom of the reader in the first run; the reader layout has not
     changed since.
- **Decisions for Aaron and Nikolas:**
  - The default preset is now `deep` (`server/src/config.ts`, `.env.example`); the plan asked for concise tours.
    (Superseded on the richer-visuals branch: the default is `standard` again.)
  - After two failed corrections, one beat with an invalid scene, worked example or visual grounding now fails the
    whole tour (`server/src/harness/generator.ts`, around line 402); before, the beat fell back and the tour still
    played. The first runs in [VISUAL-EVALUATION.md](VISUAL-EVALUATION.md) failed on two of three papers before fixes.
    (Superseded on the richer-visuals branch: the degrade ladder drops the failing part and the tour plays.)
  - Tesseract and OpenCV are new runtime dependencies; local OCR is one of the open hackathon-rule questions.

## Composable live explanations (2026-10-28)

- Native `scene` boards combine vectors, matrices, text, formulas, shapes and safe function plots. Stable object
  IDs carry geometry and values between spoken example frames. `plotId` binds marks to actual plot-domain
  coordinates using the renderer's exact axis projection, rather than guessed canvas positions.
- All tour beats and follow-up answers may choose these boards. Numerical worked examples declare assumptions,
  inputs, checked calculations and speech-anchored input/transformation/output frames; repeated symbolic formulas
  alone do not satisfy a worked explanation. Required examples receive explicit correction instead of silent
  omission. Source-result charts still require source values, while illustrative values are identified as examples.
- Side visuals use 38% of the reader (with responsive bounds), and the PDF refits its full width. Bars, plots and
  scenes follow narration progress, pause with speech, and render exact authored states when seeking.
- Verification: production build and full player suite pass; server suite has 261 passes / 7 integration skips.
  Browser checked live vector/matrix transitions, parameterized curves, pause, readable approximate values and
  responsive bounds. A real Muse Q&A completed in one call / 31.966 s with two answer steps and three timed boards;
  browser confirmed its live ReLU plot and pause. Evidence: `.data/native-scenes-answer-final.png`.
- First full harness@12 attempt failed on an incomplete input frame; it also exposed an overly small numeric
  guard for legitimate operation counts. Both were corrected, along with the provider schema nesting issue.
  Retry `61721d0f-dc8d-4d65-887e-bca2fdf4cf03` later failed after 20/21 beats with `scene_invalid`. The
  latest repair also exposes comma-separated numerical equalities being parsed as one scalar chain. This remains
  an open generation/validation bug; no new acceptance run was started during commit preparation. The current
  code must not be described as having completed a successful full scene tour.
- Failed provider/Q&A calls now log safe reason codes and timing without request bodies, keys or question text.
  Q&A allows a bounded 180 s for a rich visual response and its correction, instead of aborting at 75 s.

## Measured figure annotations (2026-10-28)

- User direction: fix the actual targeting, without hiding bad cues or silently replacing them with overview
  frames. The initial raw-coordinate experiment improved resolution but still cut through raster modules;
  it is not the accepted solution. Legacy tour geometry needs regeneration.
- Figure authoring now receives a local catalog of measured module/container boundaries and OCR labels, in
  addition to native PDF text/panel targets. Synthetic authoring IDs resolve to the existing canonical figure
  ID and exact normalized region; stored document analyses and the tour schema remain unchanged. Related
  components are outlined separately, rather than by a rectangle through unrelated content.
- The reader reserves the actual source and stroke bounds while placing measured, wrapping labels outside
  figures. White stroke casing is removed. Exact boxes have small, neighbour-aware padding. No renderer-level
  conversion of bad arrows/circles into substitute shapes remains.
- Tesseract is a local runtime dependency; OpenCV is pinned in Python requirements and Tesseract is installed
  in the Docker image. Recognition is cached per image and logged as a visual-target analysis event.
- Real model acceptance: generation `30d5ccc7-cb57-4ccd-a584-115aa76e7619`, saved v9 tour
  `cfa5c56b-dcca-448b-8b11-64c5a51a6694`, completed in 80.513 s with 21 steps / 1,165 words / 22 calls.
  No fallback, omitted beat or validation failure. All 13 marks on figures 1 and 2 resolve exactly to measured
  regions (11) or existing native panels (2). Local recognition took 382 ms and 288 ms, cached repeats 1 ms.
  Browser verified the architecture outlines at normal and narrow reader widths, preserving module boundaries.
  Evidence: `.data/measured-tour-acceptance/`, `.data/measured-overlay-final.png`, `.data/measured-overlay-narrow.png`.
- Checks: production build and all player suites passed; server 221 passed / 7 integration skips; ingestion
  61 passed / 1 existing skip. Regression coverage includes image-format parity, exact group members, process
  cancellation/errors and annotation collision layout. This establishes tested geometry, not perfect narration:
  one MatMul cue precedes its explicit mention, and the decoder explanation should distinguish earlier output
  tokens from the current shifted decoder input position.

## Native visuals and neutral narration (2026-10-28, latest user direction)

- The Manim video experiment has been removed at the user's request. Tours and follow-up answers use the existing
  directly animated formula, flow, bar and function-plot boards. No storyboard authoring or render worker remains.
  Legacy video boards are cleared at the reader boundary without interrupting the rest of a saved tour. Existing
  stored experiment rows/media remain archived; they are not rendered or queued again.
- Narration stays neutral and close to the paper's terminology, qualifications and original section/page order.
  Avoid rhetorical questions, imagined story hooks and dramatic transitions. Important mechanisms may receive
  a grounded worked explanation; numerical comparisons use matching metrics/baselines and speech-timed emphasis.
- Preserved reader fixes: ordinary prose uses precise line highlights instead of page dimming; inactive formula
  terms stay legible; the PDF refits its full width when a board opens. Region selection sends both the selected
  crop and full page alongside paper context, using the loaded tour's pinned analysis. Answers support pause,
  continue and stopping inference, without automatically resuming the original tour.
- Decoder corruption (invisible-character, whitespace and repetitive-digit padding), copied internal instructions
  and repeated explanations receive bounded repair instead of being silently published.

- Final native acceptance: generation `c3f94f53-1132-4de8-b234-4ab62a1059e9`, saved tour v7
  `b55a51d0-addb-4421-aace-c51be51c20f0`: 82.323 s, 22 steps, 1,292 words, 23 calls, no fallback,
  omitted steps or validation failures. Boards: 3 formulas, 1 plot and 5 bar charts; 19 speech-timed board cues,
  no video and forward camera page order. Live Q&A produced a native comparison board in one call (17.8 s).
  Browser verified legacy-video skipping, the selected v7 formula, full page width, readable terms and pause.
  Evidence: `.data/native-tour-acceptance/`, `.data/native-neutral-final.png`.
- Checks: production build and 267 server/integration tests passed; player suites passed; ingestion 54 tests
  passed with one pre-existing skip. The initial native check had one obsolete prompt-wording test, since removed.
- Qualitative review remains evidence-bounded: the tour repeats some EN-DE comparison information across its
  table detail and result paragraph. The source itself reports EN-FR 41.8 in the abstract/table but 41.0 in prose;
  v7 uses the table value while highlighting that prose. A warmup explanation also attributes a general stability
  rationale to the authors beyond the cited schedule text. These are narration/grounding follow-ups, not renderer
  regressions, and are not claimed resolved by technical validation.

## Guided generation and reader feedback (2026-10-28 evening)

- The default is the staged Harness with the deep preset. The persistent conversation agent remains opt-in.
  The final real Attention Is All You Need app run completed in 79.7 seconds: 22 steps, 1,004 spoken words,
  23 model calls, no fallback beats or validation failures (saved tour v4). An earlier pass took 96.6 seconds.
  This is a different generation strategy, not a controlled speedup
  comparison with the cancelled conversation-agent run (which kept repairing its chapters after ten minutes).
- Deep paper tours follow source-page order, keep overview/detail adjacent, and retain the final camera for the
  recap. Narration explains mechanisms and assumptions; extra boards should add an example or consequence rather
  than redraw the printed figure. Generation still needs qualitative review: valid targets alone do not prove
  pedagogical quality or eliminate model overstatement.
- The floating input has an accessible bounded language menu and an expandable task checklist. Planned beats and
  their outcomes come from persisted events; retries reset attempt state. Activity presents public narration and
  actions, with timing, repeated work and raw payloads under technical details.
- Startup detects interrupted Harness jobs using the same document advisory lock as the worker. Only unlocked
  orphan runs fail with an explicit retry action; live workers are left alone, and unknown paid calls are not
  replayed automatically. Parallel failures abort and drain sibling work before returning.
- An acceptance run was initially orphaned by a development-worker restart. It was recovered explicitly and
  retried. Do not restart a worker during a real provider acceptance run. Temporary manifest refresh failures keep
  the reader available and retry promptly.
- Formula terms, animated function plots and table comparisons are native reader boards. Manim video rendering
  was tried and then removed per user preference (see latest direction above). Table marks use unlabelled grounded outlines, including in old
  tours; arrows, circles and guessed fractional regions are removed so values remain readable. The screenshot's
  table pointers had correct extracted row targets but their tips fell outside the row due to arrow spacing.
- Verification: production build, all player suites, 244 server/integration checks with no skips, and 53 ingestion
  checks (one pre-existing skip) passed. Browser checked live checklist, language selection by keyboard, 388px input
  layout, formula term timing and table comparisons. Local outputs: `.data/attention-app-final/` (v4),
  `.data/attention-app-acceptance/` (earlier v3).

## Chapter-save reliability (2026-10-28)

- Live failures reproduced: provider double-encoded the nested chapter and used timing phrases absent from
  narration, repeatedly rejecting otherwise usable chapters. Nested chapter JSON is now decoded before the same
  schema validation. Agent timing cues without a unique narration match fall back to word zero with a recorded
  warning; document references and visual grounding remain validated. Other generators retain strict timing.
- Build passed; regression tests cover decoding, malformed payload rejection, invalid source rejection and cue
  fallback. The original live document was deleted through the UI during verification; its final publication
  could not be verified. Worker restarted with the changes before the replacement upload.

## Readable live assistant and repeated-work guard (2026-10-28)

- Activity opens on a readable live timeline: waveform orb, streamed assistant messages in speech bubbles,
  named tool actions, outcomes and duration. Long completed messages can be expanded. Raw payloads and usage remain
  in Technical details. Messages come from actual output, not invented thoughts or provider-private reasoning.
- Three repeats of an unchanged action (or repeated rejected arguments for the same tool) pause the agent with
  saved work. New evidence or changed tour artifacts reset the guard; explicit Resume grants a fresh attempt.
  The next-turn prompt highlights missing work and discourages rereading evidence to repair invalid arguments.
- Build and all 212 server/integration tests passed, including streaming text, tool labels, loop pausing and resume.
  Browser checked against the saved real run; no additional paid inference was started. Live-provider efficiency
  improvement still needs measurement on a subsequent generation.

## Local agent context recovery fix (2026-10-28)

- Explicit missing-provider-history errors now switch the run to a persistent local-history mode instead of
  clearing visual context and repeatedly rebuilding the source root. Committed assistant messages, tool calls and
  tool results are replayed from the local journal; stored images are hash-checked before reuse. Saved observations
  and chapters remain intact. Provider-private reasoning is omitted.
- A missing result for an already dispatched inference pauses with an explicit unknown-outcome message; it never
  automatically creates a duplicate paid inference. Missing observation descriptions get a concise repair request;
  descriptions are not fabricated and the validator still rejects incomplete observations.
- Build and 204 local server/integration tests passed, including missing history at token-count and create time,
  preserved image evidence, exactly-once publication and missing dispatched-result recovery. No additional live
  provider inference was started to test this fix; real-provider behavior remains to be verified on continuation.

## Air implementation and verification (2026-10-28)

The expanded local implementation task is implemented; external quality checks below remain explicit. No commits,
pushes, deployments or paid model/speech calls were made. The transferred mobile navigation changes were preserved
and tested; its breakpoint now also covers the previously inaccessible 581–860 px range.

- **Insight guards:** redundant printed pen labels are stripped while marks remain; flows repeating the visible
  figure are dropped together with their focus cues. Method/figure beats no longer receive a flow automatically.
  Near-verbatim long narration gets one repair; copied final fallbacks are dropped. If nothing useful survives,
  generation fails clearly. Guards use extracted text, not a semantic guarantee for unreadable raster labels.
- **Plots:** shared bounded expression parser/evaluator, no eval or executable model code. Formula beats and Q&A
  can return validated `plot` boards, with axes, KaTeX labels, curve draw-in, moving point and optional parameter
  sweep. Invalid domains/poles are segmented; reduced motion shows the final state.
- **Language:** dominant document prose determines new tour narration and voice metadata. Q&A defaults to the
  tour/document language; an explicit Answer language selection supports bilingual reading while quotes stay original.
- **Reader:** the full Ask tray occupies its own lane, camera flights preserve continuity/deadline during board
  resizing, and phone landscape controls are compact. Back to the tour remains reachable while drafting. Answer
  camera movement and intermediate return flights cannot replace the main reading checkpoint.
- **Exercise IDs:** tasks and nested parts resolve to their original blocks, including multiple pages, and are
  projected into the element index using the existing block contract.
- **Voice:** hold-to-talk interrupts playback, encodes bounded mono PCM16 WAV, uses the existing user's Meta
  connection and documented Muse Voice Transcribe endpoint. Transcripts are reviewed before sending a question.
  Permission failure/cancellation releases recording resources and restores the tour. See [VOICE.md](VOICE.md).
- **Development tools:** audited Vite 5/esbuild advisories were removed by updating Vite to 6.4.5, the React plugin
  to 4.7.0 and esbuild to 0.25.12. Player audit and server production audit report zero vulnerabilities; build and
  browser regression pass again. Runtime React and PDF dependencies are unchanged.
- **Further workflows:** local course PDF packs with source hashes/page maps, escaped literal version comparisons
  and photo-to-searchable-PDF OCR. Original pages are retained; no model calls. These are working preparation tools,
  not automatic exam alignment, a two-document reader or reliable personal-data redaction. See
  [LOCAL-WORKFLOWS.md](LOCAL-WORKFLOWS.md).
- **Demo:** reproducible CC0 synthetic documents and explicitly authored offline renderer fixtures, local instructions,
  pitch rehearsal script and a labelled 22-second silent backup video. These are not unedited real model outputs or
  evidence of writer quality. See [DEMO.md](DEMO.md). Name candidates remain Nib, Penlight and Lupe; no name selected.

**Verified on the Air:** build passes; all player suites pass; server 142 pass / 6 database-only skips in the ordinary
run, and 194/194 pass with isolated local Supabase (zero skips). Ingestion 53/53 passes with local Tesseract language
data. Seven synthetic document types, a two-column paper with a detected figure, a course pack and a version bundle
went through real authenticated upload/storage/worker processing; a photo-OCR PDF also passed the browser's resumable
upload. Signed range access, cross-account isolation, search, stored progress and missing-key errors were checked.
Chromium automation covers 1440×900, 390×844, 760×900 and 844×390, Q&A pause/back/cancel/late reply/error, plot/pen,
navigation/search, library restoration and microphone permission/cancellation. No uncaught browser errors in the main
run. API answers/transcription in those playback tests are fake transports. Reports and exact logs are gitignored
under `.data/air-goal-report.md`, `.data/air-test-report.md` and `.data/air-test/logs/`.

**Remaining external checks/decisions:** a separately authorised real Meta writer/transcription run and listening on
the actual microphone/browser voices; licensed representative real-world documents and difficult camera photos;
name/trademark decision and unknown hackathon rules. Manim is optional. The broader P1/P2 product modes in PLAN and
USE-CASES remain a roadmap, not a claim that every listed future product is built. Never infer permission to publish
or spend from this local verification.

## Earlier project history

The product plan is in [PLAN.md](PLAN.md).

**Working:**
- **Scaffold (Aaron, 10-26):** ingestion, both schemas, the player, and a 38-step hand-written tour of *Attention Is All
  You Need*. `validate.py` reports 0 errors and the tour was played end to end in the browser. The README quick start
  works from a fresh clone. It downloads the paper, because papers and their generated `doc.json` and `figures/` are
  not committed.
- **Library app (Nikolas, 10-27):**
  - PDF uploads with Supabase storage and a library.
  - Automatic tours from Meta's Muse model: a visual pass over pages and figures, then the tour, saved per document.
  - Model selection with API prices, and personal Meta keys under Profile & Settings.
  - Browser voice selection.
  - Local setup scripts, smoke and integration tests, and a Dockerfile and compose file for deployment.
  - Setup is in the README's "Local library setup" section; the app runs at http://localhost:5174/.

**Tour authoring (hand-written tours):** edit `demo/attention/build_tour.py` and run it to regenerate `tour.json`; it
reproduces the committed file byte for byte. Then run `validate.py`, and look at the `check_tour.py` renders of the
steps you changed.

**Review round on the scaffold:** six reviewers each looked at one area, and a skeptic verified every finding. 37
findings were confirmed and 2 refuted. All of them, with evidence and suggested fixes, are in
[review-2026-10-26.json](review-2026-10-26.json), which also records each finding's current `status`.
- Confirmed findings by severity: 3 high (all ingestion on unseen papers), 12 medium, 22 low.
- Re-checked against the current code on 10-27, except the player findings (L3-\*, L4-\*, L6-4), which are still
  `unchecked`: 3 fixed, 7 partial, 16 open.
- The three high findings are fixed. L1-1 (tall booktabs tables) already was; L1-2 (tables beside each other or above
  a plot) and L1-7 (IEEE headings, run-in abstract, "TABLE I" captions) were fixed on 10-27, with regression tests in
  `ingest/test_ingest_layout.py`.
- Partly fixed: L1-3, L1-4, L6-1 and L6-3, and on the upload path only L1-5, L1-6 and L1-8 (`process.py` handles
  rotated pages, bad files and scans; the `ingest.py` command line does not).

**Tutor build (10-27 evening, Aaron's direction; see PLAN.md, HARNESS.md and USE-CASES.md):**
- **Short tours (done):** `server/src/harness/` replaces the page-by-page writer: a paper card, a beat plan by preset
  (quick about 6 steps, standard 10-12, deep up to 22, never more than 30), parallel beat direction, assembly and
  validation in code. Default via `TOUR_WRITER=harness`; `PAPER_AGENT_ENABLED` now defaults to false. A real standard
  tour of the demo paper: 23 s, 11 steps, about $0.20. Run it locally with `server/run-tour.ts` and view it at
  `?paper=attention-short` (a local folder, set up as described below).
- **Contract (done):** pen actions `arrow` and `circle`, and a side board (`board` with formula, flow or bars,
  `board_focus`, `board_clear`), in schema/tour.schema.json and shared/paper.ts; the engine tracks the board.
- **Pen and board (done, 10-28):** hand-drawn arrows and circles on the page; a side board with a KaTeX formula
  built term by term, flows and bars, beside the page (below it on narrow screens). Test tours: `?paper=pen-test`
  and `?paper=board-test` (git-excluded folders).
- **Asking (done, 10-28):** the ask bar under the page; a question pauses the tour, the answer plays as a short
  second tour on the same narrator, camera, pen and board, then "Back to the tour" or "Ask another"; suggested
  questions at the end and follow-ups that use the history. Demo papers use `POST /api/demo/:paper/ask`, which
  exists only in local development and answers only loopback requests.
- **Document types (done, 10-28):** the card classifies the document (paper, exercise sheet, lecture, contract,
  letter, other) and each type gets its own arc and tone. Exercise sheets are solved part by part, each line checked
  numerically by `ingest/verify_math.py`, and unchecked lines are marked. Writer test runs: German sheet 19 steps,
  lease 10, slides 6, calculus sheet 18.
- **Checks:** player tsc and `npm test` (all suites), server tsc and tests (124 pass, 6 database tests skipped),
  ingest unittest, validate.py, and the re-ingested demo doc.json byte-identical.
- **First unedited Attention run (10-28 09:57, real Meta API, the same generator as uploads):** 11 steps in 33 s,
  12 model calls, no fallback beats. Watch it at http://localhost:5174/?paper=attention-short, a git-excluded folder
  that links to the paper.pdf, doc.json and figures/ of `demo/attention/`. To regenerate it, run
  `cd server && node --import tsx run-tour.ts standard <out> ../demo/attention attention-short` and copy
  `<out>/tour.json` into `demo/attention-short/`. Good: concise steps, highlights everywhere, the formula built term
  by term with each term lit, results as bars, three good questions. Weak: pen labels repeat names the figure
  already shows ("Encoder stack"), both figure steps redraw their figure as a flow on the board, every method step
  uses a flow, no function plots yet, and the open ask panel covers the bottom of the page.
- **Test documents (local only, never commit):** 13 PDFs with a manifest in the session scratchpad
  (`.../scratchpad/night/docs/MANIFEST.md`): three CC BY arXiv papers (IEEE robotics, physics, biology), three maths
  sheets, MIT slides, two UK tenancy agreements, two versions of Google's terms, a German data-protection letter and
  the IRS W-9.
- **Names:** notes/NAMES.md proposes Nib, Penlight and Lupe to replace "Paper Tour" (Aaron to choose).

**Historical next-step list (Aaron's direction, before the Air work; current state above):**
1. Insight and no doubling: a pen label never repeats words printed at the mark (say what the part does or why it
   matters); the board never redraws the figure on screen (show a worked example, a plot of the function, the
   intuition); a flow only when it adds something. Enforce with code checks, not only prompts.
2. Unpack equations: their parts plus small x/y plots of the functions used, through a new `plot` board kind with a
   safe expression grammar shared by server and player; a Manim prototype for the rare clip that needs more.
3. Narrate in the document's language.
4. Upload the test documents through the app and fix general causes; never tune to one document.
5. The ask panel must not cover the page; retarget the camera during the board slide instead of restarting it; a
   usable landscape phone layout.
6. Push to GitHub (ask Aaron; main is ahead of origin, pull --rebase first).
7. Later: push-to-talk with Muse Voice Transcribe, course packs, contracts with "what changed", life admin.

**Running the static demo:** after the README quick start, `npm run dev` in `player/` (or `npm run dev:demo` from the
root), then open http://localhost:5174/?paper=attention. Add `&silent=1&rate=4` to test quickly without speech.

**Local Supabase with Colima:** `npm run supabase:start` fails with "bind source path does not exist: /var/folders/…",
because the experimental stack mounts a temp folder that Colima's VM cannot see (it shares only your home folder).
Give it a temp folder inside the repo instead: `mkdir -p .data/tmp && TMPDIR=$PWD/.data/tmp npm run supabase:start`.

## Commit preparation (2026-10-28)

- Removed false numeric provenance errors for digits embedded in model names (for example ConvS2S).
- Progressive comparisons may begin with one bar. Numerical calculation checks allow floating-point evaluation
  tolerance while still rejecting wrong results. Comma/LaTeX-separated equalities received an initial correction;
  the unresolved plain-comma case above still needs attention.
- Production build passes; 10 focused example tests pass. No additional provider acceptance was started.

## Validation repair follow-up (2026-10-28)

- Fixed top-level comma-separated equations while preserving commas inside functions/tuples. The latest saved
  failed example now passes replay validation. Corrections replace the previous direction instead of retaining
  an older invalid scene. Every validation problem is sent in the same correction turn; up to two corrections
  are allowed, without silently dropping required examples.
- Tool schema descriptions now explicitly prohibit placeholder/unused boards and describe required scene
  text/matrix content. Harness prompt version is @13.
- Retry progress and model-call counters use only the latest run; drafted-step counts use completed beats,
  not every draft/repair response. Server build and 21 focused checks passed. Full provider completion remains
  unverified; an unrelated active generation was left undisturbed during this fix.

## Successful tour and source-first visual quality (2026-10-28)

- Full real Muse generation `4e3d7883-faa2-4b22-8c74-e69897e3ad5e` completed: 22 steps,
  1,735 words, 196.309 seconds, 29 model calls. The agent corrected intermediate rejected drafts and published
  a valid tour. All 22 steps were exercised in the reader without crash/non-finite SVG paths.
- The user rejected colored-prose boards and a three-box numerical flow. Authored scenes now require quantitative
  objects or a spatial relationship. Plans explicitly choose a tool from the learning difficulty, favor actual PDF
  elements/cues, and reserve a copied formula for active term work. Function behavior should be plotted rather
  than squeezed into labels. The same source-first preference applies to Q&A. Harness version is @14.
- Saved v3 `1434e25a-c580-4a6d-8cb5-dcb4c7454239` preserves the original versions and replaces the
  feed-forward detail with a checked ReLU plot, removes the table-overview prose panel, and clears the trivial
  recap conversion panel. These are targeted corrections to the current user-flagged steps; production rules are
  generic and contain no paper IDs, paper-specific formulas or coordinates.
- Displayed vector/matrix LaTeX no longer enters the scalar expression parser. Explicit numerical calculations
  and visible-value provenance remain checked. Scalar wrong-result regression still fails as expected.
- Production build passed. Full suite: all player checks, server 266 pass / 7 existing skips; ingestion
  61 pass / 1 existing skip. Publication checks for v3 report no problems. Evidence: `.data/harness13-current-tour/`.

- Final browser verification of v3: all 22 steps load without crash/non-finite SVG geometry; ReLU playback follows
  the original PDF equation, sample-marker centers were corrected to their intended data points, and pause works.
  Plain axis descriptions render as readable text. The tested v3 has no publication validation problems. Final
  automated run again passed all player suites, 266 server checks (7 existing skips), 61 ingestion checks (1 skip),
  and production build. Source-first tutoring and useful-visual selection apply to future tours and Q&A; quality
  remains a model judgement rather than a promise that every future explanation is perfect.

## Multi-paper visual evaluation (2026-10-29)

- Evaluated Attention, Sticky Routing and Geometry-Aware Multi-Objective Optimization through multiple real Muse runs and targeted repairs. Successful final samples contain 21, 21 and 22 steps with no canonical publication problems. See [VISUAL-EVALUATION.md](VISUAL-EVALUATION.md) for failed attempts, runtimes, reuse accounting and rendered evidence.
- Harness @20 shares long-paper evidence enums, budgets reasoning plus structured output for complex directions, and checks rounded arithmetic, scientific notation, signed values and component labels without the observed false positives.
- Stronger visual-selection rules reject prose slides disguised with arrows and isolated scalar matrices as worked visual explanations. Source axes, tradeoffs, stable visual quantities and narration/frame consistency are explicit authoring requirements.
- Browser review confirmed source component boxes, plot annotations and signed live intermediate values beside the original PDF. These are sampled quality checks; generated pedagogy remains model-dependent and the new reasoning settings are not a demonstrated latency improvement.
- Final checks: all player suites passed; server 274 passed / 7 existing skips; ingestion 61 passed / 1 existing skip; production build and whitespace checks passed.
