# Paper Tour

Paper Tour turns any document into a tutor that reads it with you. It points at the exact sentence, outlines the exact
part of a figure, draws checked visuals on a board beside the page, and answers spoken or typed questions the same way:
not with a block of chat text, but with a short tour on the page itself. It works on research papers, lecture slides,
exercise sheets and practical documents such as leases and official letters. Every highlight and outline lands on
something that exists on the page, because the tour is built from the document's own geometry and names elements by ID,
never by coordinates.

## How it works

```
PDF ─▶ ingestion ─▶ doc.json: sentences, blocks, figures, panels, equations, exercise tasks
                    every element has an ID and exact coordinates
                              │
      plan (Muse Spark):      claims of a paper · slide groups of a deck · parts of an exercise sheet
                              │
      visual plan (Spark):    one call decides the board for every step of the whole tour, diversity first
                              │
      direct (Spark):         one small call per step, in parallel, choosing only from the IDs listed for it
                              │
      checks in code ───────▶ repair once, otherwise drop the failing part and keep the step
                              │
                    tour.json: chapters of steps made of IDs and board data
                              │
      reader (pdf.js):        camera, pen and board move with the narration, word by word
```

1. **Ingestion** (`ingest/`, Python and PyMuPDF) turns the PDF into `doc.json`. Every sentence, block, section, figure,
   table, panel and equation gets an ID and exact coordinates, and exercise sheets also get task and part IDs. Before a
   figure is taught, local OCR and OpenCV (`ingest/visual_targets.py`) measure the modules inside it, so a pen mark can
   enclose one part of a diagram instead of guessing a box.
2. **Planning.** One call reads the document and names its type, key figures and chapter titles, and code detects its
   language. The plan then depends on the type. A paper is taught by its claims, the two to four statements the authors
   make in at least two of the abstract, introduction and conclusion, each with its evidence and, where the authors
   state one, its catch. A slide deck skips title, agenda and licence slides and merges trivial neighbours. An exercise
   sheet is taught task by task. A second call then plans the board of the whole tour at once, asked to make the
   visuals differ from each other and to give about half the steps one.
3. **Directing.** Each step is written by its own small call, run in parallel. The output is constrained to a JSON
   schema whose targets are enums of the IDs listed for that step, so the model picks a sentence, a figure or a panel
   but never writes a coordinate. A detail step waits for the overview it builds on and is told not to repeat it.
4. **Checks in code.** Code checks every step:
   - **Grounding.** Every ID exists. Numbers on a document board (bars, scatter, heatmap) must be printed in the
     evidence the model was shown; any other values must be labelled illustrative.
   - **Arithmetic.** Plot, heatmap and formula expressions go through a safe expression grammar, never `eval`. Solution
     lines of an exercise are evaluated numerically (`ok`, `failed` or `unknown`) and a line that cannot be checked is
     marked unverified.
   - **Repetition.** A board that repeats an earlier board's data is dropped. A step that repeats the overview it builds
     on is written again.
   - **Paraphrase.** A step that mostly restates the sentences it highlights is sent back once, to explain why instead.
   - **Degrading.** A board, worked example or set of pen marks that still fails after its repair is dropped and
     recorded, and the step keeps its narration and page cues. A visual that fails costs that step its visual, not the
     tour.
5. **The reader** (`player/`, React and pdf.js) plays the tour. The camera flies between targets, pen marks are drawn
   as the narration reaches them, highlights follow the sentence being spoken, and the board animates a formula built
   term by term, bars, plots, heatmaps and the rest. Narration is the browser's speech synthesis, since Meta's API has
   no text-to-speech. A question pauses the tour; the answer plays as a short tour of its own, then you go back.

## Meta models it uses

| Model | What it does here | What we found |
|---|---|---|
| Muse Spark 1.3 (`muse-spark-1.3`, the default) | Reads the document with its page and figure images, plans, plans the visuals, directs every step and answers questions | Constrained JSON output keeps IDs to the listed enums; a tour took 10 to 20 model calls in the seven runs below |
| SAM 3.1 (`sam-3.1`) | Snaps a learner's loose drag over a figure to the object inside it, drawn as its outline | 42 of 46 snaps were correct in the spike, median 1.2 s. Guards on confidence, overshoot, size and ink keep the learner's rectangle when a snap looks wrong |
| Muse Voice Transcribe 1.0 | Hold-to-talk questions: the transcript appears in the question field, editable, and Ask sends it | 16 kHz mono WAV in, text out; nothing is stored |
| Muse Wonder 1.0 | Listed as a tour-compatible model, but no stage uses it by default | See below |

Muse Wonder was tried as the director of the whole tour's visuals ([notes/META-MODELS.md](notes/META-MODELS.md)). At its
default effort it ran out of tokens on the plan (73 s, truncated). With a reasoning effort set every call returned a
valid plan in 15 to 28 s for $0.03 to $0.07, but Muse Spark returned equally valid plans in 5.5 s for $0.007, so Spark
stays the planner. Muse Image is not used.

## What it is not

- **Not a chat with a PDF.** There is no chat transcript. An answer is a short tour on the page that points, draws and
  can use the board.
- **Not a basic RAG app.** Tours are not retrieved from chunks. The whole document is planned, every step is tied to
  IDs and geometry, and the model's visuals are checked by code. Questions do retrieve passages from the one open
  document, but what comes back is pointing and drawing, not a paragraph.
- **Not advice.** For leases, terms and letters it explains what the text says, with amounts and dates as written. A
  contract tour says at its start and end that it explains and does not advise, and its narration is instructed never
  to recommend whether to sign.
- **Not a replacement for the document.** The page stays on screen the whole time, and every claim points back to it.

## Document types

| Type | How it is taught |
|---|---|
| Research papers | By claim: what changed, why it works, the evidence with its scope, the catch. Figures are taught on the figure itself; tables become scatter, bars or heatmaps of the paper's own numbers |
| Lecture slides | Slide by slide in a filmstrip, skipping title and agenda slides and connecting the rest into a story |
| Exercise sheets | Per task: the task, a try-first checkpoint with up to three hints, then the solution line by line on the board, each line checked in code where it can be |
| Practical documents (contracts, leases, terms, letters, forms) | Plain words, neutral tone, amounts and dates exactly as written, framed as an explanation and not advice |

The tour is written in the document's dominant language (a German sheet gets German narration). A question can ask for
the answer in another language, with quotes kept in the original. Practical documents use the same pipeline but are not
among the measured runs below.

## Measured results

Ten documents, one run each, on 2026-10-29: four papers (machine translation, a robot fish, quantum field theory,
ant ecology), one lecture deck, two exercise sheets (English probability, German linear algebra), a 63-page UK
tenancy agreement, a terms-of-service document and a German data-protection letter. All with `muse-spark-1.3`, the
`standard` preset and prompt version `paper-tour-harness@29`. This is ten documents, not a benchmark: there is no
baseline, no repeated run and no human rating. The PDFs are not in the repository, and `attention` here is a generated
tour of the same paper as the hand-written demo.

The numbers come from `node scripts/scorecard.mjs`, which reads the finished tours and makes no model calls:

```
tour           type      steps  words   min  chap  calls  tok k   usd   secs  resent  degr      ids  lines
----------------------------------------------------------------------------------------------------------
attention      paper         8    398   2.6     4     12    200  0.35  104.8       1     0    25/25      -
eval-fish      paper        12    645   4.2     4     21    358  0.60   94.9       3     0    40/40      -
eval-casimir   paper        12    656   4.3     5     17    358  0.57   98.4       2     0    36/36      -
eval-ants      paper        12    633   4.2     5     16    309  0.50   87.3       1     0    40/40      -
eval-slides    lecture      10    855   5.6     5     19    301  0.57  125.9       7     1    56/56      -
eval-sheet-en  sheet        20    779   5.2     7     11    119  0.28   63.7       0     0    56/56   7/13
eval-sheet-de  sheet        21    744   4.9     7     12    179  0.40   91.4       0     1    48/48   9/14
eval-lease     contract     10    706   4.6     6     15    548  0.80   87.3       1     0    31/31      -
eval-terms     contract      9    613   4.0     6     13    225  0.38   86.0       0     0    30/30      -
eval-letter    letter        5    296   1.9     4      8     64  0.13   53.0       0     0    16/16      -
----------------------------------------------------------------------------------------------------------
all 10                     119   6325  41.6    53    144   2663  4.58  892.7      15     2  378/378  16/27

tour           type      boards  kinds  doc  in text  illus  other  repeat  dropped  checkpoints
------------------------------------------------------------------------------------------------
attention      paper          6      4    1        0      1      4       0        0            0
eval-fish      paper          8      6    1        1      3      4       0        0            0
eval-casimir   paper          7      5    2        0      1      4       0        0            0
eval-ants      paper          5      5    1        1      2      2       0        0            0
eval-slides    lecture        5      4    1        1      3      1       0        0            0
eval-sheet-en  sheet         10      3    0        0      1      9       0        0            5
eval-sheet-de  sheet         10      2    0        0      0     10       0        0            5
eval-lease     contract       7      6    2        1      3      2       0        0            0
eval-terms     contract       5      4    1        0      3      1       0        0            0
eval-letter    letter         2      2    0        0      1      1       0        0            0
------------------------------------------------------------------------------------------------
all 10                       65     10    9        4     18     38       0        0           10
```

What the numbers say, and what they do not:

- **Every document got a tour.** All ten completed, including the 63-page lease; writing one took 53 to 126 seconds
  with 8 to 21 model calls, about $0.13 to $0.80 at Muse Spark's list price
  ([server/src/muse/pricing.ts](server/src/muse/pricing.ts)).
- **Size.** Papers, the deck and the practical documents took 5 to 12 steps and 2 to 5.6 minutes of narration. A sheet
  takes an overview, a takeaway and a try-first checkpoint plus solution steps per exercise, so 20 and 21 steps.
- **Diversity.** All ten board kinds appear across the tours; each paper, deck or contract uses 4 to 6 different kinds,
  and no board repeats the data of an earlier one.
- **Document values.** Of 65 boards, 9 present numbers as the document's own and 4 more use values printed in the
  text; 18 are declared illustrative and 38 are equations, flows, functions, timelines or drawings.
- **Grounding.** All 378 IDs the tours point at exist in `doc.json`.
- **Checks at work.** The checks sent back 15 drafts, which were written again; two steps lost a part (a board or pen
  marks) and kept their narration. No tour failed.
- **Exercise lines.** Of 27 solution lines, 16 checked as correct, none as wrong, and 11 could not be checked
  numerically and are marked unverified.

To reproduce a row, write a tour with `server/run-tour.ts` (see the quick start) and run the scorecard on its folder.
It looks up `doc.json` in `demo/<folder name>`; `--docs <dir>` changes that, and `--json` prints the numbers as JSON.

## Quick start

Needs Node.js 22.12+ and Python 3.10+. The reader runs on its own with no keys and no database.

```bash
curl -L -o demo/attention/paper.pdf https://arxiv.org/pdf/1706.03762v7
python3 -m venv ingest/.venv
ingest/.venv/bin/pip install -r ingest/requirements.txt
ingest/.venv/bin/python ingest/ingest.py demo/attention/paper.pdf --debug
ingest/.venv/bin/python ingest/validate.py demo/attention
cd player && npm install && npm run dev
```

Then open http://localhost:5174/?paper=attention. The paper is not in the repo, because its arXiv license does not
allow re-hosting, so the first line downloads it. `validate.py` checks that the download is the exact file the tour was
written for. `demo/attention/tour.json` is a hand-written tour of 38 steps, so the reader works without any key.

**Write a tour for your own PDF.** This makes real Meta API calls, about $0.30 to $0.70 per tour at list price. Install
Tesseract first (`brew install tesseract` on macOS, `apt-get install tesseract-ocr` on Debian or Ubuntu); figure labels
are read locally before a figure step is directed.

```bash
cp .env.example .env            # skip this if you have a .env; then set MODEL_API_KEY in it
mkdir -p demo/mydoc && cp path/to/doc.pdf demo/mydoc/paper.pdf
ingest/.venv/bin/python ingest/ingest.py demo/mydoc/paper.pdf
cd server && npm ci && node --import tsx run-tour.ts standard /tmp/mydoc-tour ../demo/mydoc mydoc
cp /tmp/mydoc-tour/tour.json ../demo/mydoc/tour.json
cd ../player && npm run dev     # open http://localhost:5174/?paper=mydoc
```

`run-tour.ts <preset> <out> [folder] [document id] [language]` writes `tour.json`, `metadata.json` (model calls, tokens,
degraded steps, checked exercise lines) and `events.json` (what every stage did, and when) into `<out>`. Presets are
`quick` (about 6 steps), `standard` (10 to 12 for papers and decks) and `deep` (up to 22); a tour never has more than
30. `demo/*/doc.json`, figures and PDFs are gitignored; commit a `tour.json` only when it is meant as a demo.

Checks:

```bash
npm run build                                   # type-checks the server and the player and builds the player
npm test                                        # player, server and ingestion suites
ingest/.venv/bin/python ingest/validate.py demo/attention
node --test scripts/scorecard.test.mjs
```

## Layout

| Path | What |
|---|---|
| `ingest/` | Python: PDF to `doc.json`, figure crops, local figure measurement, math checks, validation, ID outline for authors |
| `schema/` | `doc.schema.json` and `tour.schema.json`, the two contracts |
| `shared/` | TypeScript types and checks used by the server and the player: the contracts, board kinds, expressions |
| `server/` | Fastify API, the worker, the tour writer in `src/harness/`, question answering, SAM snapping, voice, Nikolas's opt-in paper agent |
| `player/` | Vite, React and TypeScript reader: camera, pen, board, asking, library |
| `scripts/` | Local setup, smoke and integration tests, `scorecard.mjs` |
| `demo/attention/` | Demo paper: `tour.json` is committed; `paper.pdf` is downloaded and `doc.json` and `figures/` are generated by the quick start |
| `notes/` | Plan, status, harness design, Meta model findings, use cases. Start with [notes/HANDOFF.md](notes/HANDOFF.md) |

Tools in `ingest/`:

- `ingest.py <pdf> [--out DIR] [--debug]` writes `doc.json` and `figures/` next to the PDF (or into `--out`). `--debug`
  also renders every page with all detected elements and their IDs drawn on top, into `_debug/page-NN.png`.
- `validate.py <folder>` checks `doc.json` and `tour.json` against the schemas, and that every ID the tour uses exists
  in `doc.json`.
- `outline.py <folder>` prints sections, figures and every sentence with its ID. Use it when writing a tour by hand.
- `check_tour.py <folder>/tour.json <out-dir>` renders every step's targets the way the player frames them, one PNG per
  camera move, and prints the word each timed action fires on.
- `demo/attention/build_tour.py` is the source of the hand-written demo tour; it turns anchor words into `at_word`
  indexes.

Player keys: `Space` or `K` play and pause, `←` and `→` previous and next step, `Shift` with an arrow previous and
next sentence, `[` and `]` previous and next chapter, `Home` and `End` first and last step, `R` replay the sentence,
`M` mute, `H` a hint when you are asked to try, `/` ask a question, `?` the list. `D` shows element IDs; click any
element in that mode to copy its ID. URL options for the demo: `?paper=<folder>`, `?silent=1` for timed narration
without speech, `?rate=4` to run faster while testing. `npm test` in `player/` runs the engine tests.

## The contracts

**The tour never contains coordinates.** It names elements by ID and the player looks up their coordinates in
`doc.json`. This is what makes model-written tours reliable: models pick IDs well and bounding boxes badly. To point
inside a figure without a panel ID, a tour gives a `region` normalised to the target's bbox (`[0, 0, 0.5, 1]` is the
left half).

Coordinates in `doc.json` are PDF points with the origin at the top-left of the page and y growing downward (PyMuPDF's
convention). A bbox is `[x0, y0, x1, y1]`.

| ID | Example | Points at |
|---|---|---|
| block | `p3.b2` | Text block 2 on page 3 (reading order) |
| sentence | `p3.s12` | Sentence 12 on page 3; `rects` has one rect per line fragment |
| section | `sec-3.2`, `sec-abstract` | The section's heading block |
| figure / table | `fig1`, `tab2` | The graphic or table body, by printed number, without the caption |
| panel | `fig2.a` | A sub-figure, in reading order |
| equation | `eq1`, `equ2` | A numbered or unnumbered display equation |
| page | `page4` | A whole page |

Exercise sheets also have task and part IDs in `doc.json` (`ex1`, `ex1.a`) that the planner uses. Steps point at the
blocks and sentences they cover.

**A tour** has a `title`, the `paper` folder it belongs to, the `doc_sha256` of the `doc.json` it was written against,
an optional `level`, `voices`, the `preset` it was written for and `suggested_questions`, and `chapters` of steps.
`doc_type` is `research_paper`, `exercise_sheet`, `lecture`, `contract`, `letter` or `other`; the reader uses it to pick
its mode, so a lecture plays slide by slide.

**A step** has `say` (the narration), `actions`, an optional `hold_ms` pause, optional pre-rendered `audio` and an
optional `checkpoint`: `{ prompt, hints }` with up to three hints, from a nudge to almost the answer. A step with a
checkpoint pauses after its narration so the learner can try first, and the next step reveals the answer.

Actions fire at the start of the step, or at word `at_word` of the narration. Overlays disappear when the step ends
unless `persist` is set; `clear` removes persistent ones.

| Action | Effect |
|---|---|
| `focus` | Scroll the target into view at reading zoom |
| `zoom` | Fit the target (or a `region` of it) to the viewport |
| `highlight` | Marker or underline on the text lines of each target |
| `box` | Outline with an optional label |
| `spotlight` | Dim everything except the target |
| `note` | Callout card next to the anchor |
| `arrow`, `circle` | Hand-drawn pen mark pointing at, or around, the target or a region of it |
| `clear` | Remove persistent overlays |
| `board` | Show a board item beside the page; it stays across steps until another item or `board_clear` |
| `board_focus` | Light up one part of the board item by index |
| `board_clear` | Remove the board item |

**Board kinds.** The model fills a template with semantic data; code checks it, lays it out and animates it.

| Kind | Shows | `board_focus` part |
|---|---|---|
| `formula` | An equation built term by term, each term a coloured substring of the LaTeX | term |
| `flow` | Boxes and arrows of a pipeline or dependency, revealed in order | node |
| `bars` | Numbers the document reports, as animated bars | bar |
| `plot` | Function curves from a safe expression, with an optional parameter sweep, log axes, marks computed by code (roots, extrema, intersections) and data points from the document | curve |
| `scene` | Positioned vectors, matrices, text, shapes and plots, changing state frame by frame for a worked example | object |
| `heatmap` | A grid with labelled rows and columns: weights, masks, correlations, ablations. Can show a row-wise softmax, a causal mask or curves between tokens. Its `source` is `document`, `illustrative` or `formula` (the server computes the values) | row |
| `scatter` | Points on two measured axes, with log axes and a shaded "better" corner, for trade-offs | point |
| `shapes` | Matrix dimensions through an operation; the code checks that inner dimensions match | matrix |
| `timeline` | Dated or ordered events, spans and deadlines on one axis; the code resolves relative dates such as "14 days after the notice" and checks span lengths | event, span |
| `distribution` | One or two distributions from parameters or document counts, morphing from one to the other; the probability of a shaded region is computed by code | dist, region |

Narration uses the browser's speech synthesis unless a step has pre-rendered `audio` (with optional per-word timings).

## Local library setup

The library app adds private uploads, analysis in a worker, model selection with prices and personal Meta keys under
**Profile & Settings**. It needs Node.js 22.12+ and Python 3.12. Install Tesseract as above. Python requirements include
OpenCV for measuring diagram components, which runs locally before figure cues are authored.

```sh
npm ci
npm --prefix server ci
npm --prefix player ci
python3.12 -m venv ingest/.venv
ingest/.venv/bin/pip install -r ingest/requirements.txt
npm run supabase:start
npm run setup:local
```

Optionally set `MODEL_API_KEY` in the root `.env` for shared app access. Users can instead save their own Meta key in
**Profile & Settings**. Start the app:

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:5174/. Automatic tours send the document's text and rendered page and figure images to Meta.
`npm run test:integration` needs the local Supabase stack.

`Dockerfile` and `compose.yaml` provide an optional deployment setup; environment variables are listed in
`.env.example`. With Colima instead of Docker Desktop, see [notes/HANDOFF.md](notes/HANDOFF.md).

New tours use the guided harness (`TOUR_PRESET=standard`). The first steps can be played while the rest is still being
written. Activity shows readable narration, concurrent work and timing diagnostics; the floating question bubble also
shows progress.

Set `PAPER_AGENT_ENABLED=true` for new tours to use the persistent paper agent instead. Existing jobs keep their
original engine. The agent uses Meta Responses, saved paper sessions and seven scoped paper tools; its instructions and
tool schemas are in `server/src/agent/tools.ts`. Runs and tool results are private server-side records. **Activity**
shows model and tool inputs, results and token usage, with Pause, Resume and Cancel controls. Limits in `.env.example`
pause work at a checkpoint; resuming grants another budget segment. An uncertain provider dispatch requires explicit
resume. Provider prompt caching is measured separately from local image and observation reuse.

All model generation and streaming run through Vercel AI SDK 7. Structured tours and questions use `Output.object`; the
persistent agent uses `ToolLoopAgent` with a single model step per durable job. Postgres and pg-boss own checkpoints and
tool writes, so reconnecting does not replay writes. Meta's count and retrieve endpoints remain explicit provider
capabilities, and its nonstandard voice endpoint implements the SDK transcription contract. See
[the migration plan](notes/VERCEL-MIGRATION.md) for decisions and verification.

Generation queue handling is centralized in `server/src/generation/runtime.ts`; the guided generator is bound in
`generation/generator.ts`. Paper tools are grouped under `agent/tools/` by source reads, visual inspection and tour
editing. Registering a tool supplies its schema, execution, progress stage and concurrency classification together. See
[the architecture audit](notes/GENERATION-ARCHITECTURE.md) for real-provider results.

For local SDK timing and token diagnostics, set `AI_SDK_DEVTOOLS=true` and run `npm --prefix server exec -- devtools`.
Development dependencies are required. Traces contain only metadata: prompts, tool arguments, generated text, raw
requests and replies and image bytes are omitted. This integration stays disabled in production.

Run `npm run test:smoke:muse` for an explicit live test with the configured local test account. It uploads a small
diagram PDF and checks saved tours, source links and the agent journal when enabled; it uses the profile's selected
model and consumes API tokens.

### Questions

A question pauses the tour. Type it, or hold the microphone button beside the field, speak and release: Muse Voice
Transcribe puts the text in the field, and **Ask** sends it. The answer is a short tour of its own, in the document's
language or one chosen under **Answer language**; **Back to the tour** returns to where you were.

Use the region-selection button beside the question field to ask about an area of a PDF, with or without a tour. The
reader asks SAM 3.1 to snap your drag to the object inside it and shows the object's outline; if the snap is slow,
unsure or finds nothing, your rectangle is used and asking never waits. The server sends the crop and the full page from
the original PDF, alongside document text and conversation context. Pause and continue keep the current narration
position; stopping a pending question aborts it.

## Provenance and team

> **TO FILL IN (Aaron): only you can state this. Replace this note with the facts.**
>
> - **Dates.** When the project started, the event kickoff, and the submission. The git history starts on 2026-10-26.
> - **What existed before the event.** Code, designs, data or experiments, and what is new work.
> - **Authors and roles.** Everyone who contributed, with what each built. The git history lists Aaron Louis Eidt and
>   Nikolas Rauscher.
> - **Third-party code, data and documents.** Libraries (pdf.js, PyMuPDF, OpenCV, Tesseract, KaTeX, Vercel AI SDK,
>   Supabase), and the source and licence of every document used in the demo and the results above.
> - **Anything else the rules ask you to disclose.**
> - **Licence and name.** There is no LICENSE file yet, and "Paper Tour" is a working name.

## Notes

The plan, the current status and the review findings are in `notes/`: [HANDOFF.md](notes/HANDOFF.md) (start here),
[STATUS.md](notes/STATUS.md), [ROADMAP.md](notes/ROADMAP.md), [VISUALS-V2.md](notes/VISUALS-V2.md),
[META-MODELS.md](notes/META-MODELS.md), [HARNESS.md](notes/HARNESS.md), [HACKATHON-PLAN.md](notes/HACKATHON-PLAN.md).
