# Handoff

Latest visual direction (2026-10-28 evening): use native live scenes, including vectors, matrices and animated
function plots, in both tour generation and answers. The reader board uses 38% of available width. Keep narration
neutral and close to the document's order; illustrate numerical examples through changing input/intermediate/output
states. No Manim videos, paper-specific templates, or silent replacement/omission of invalid required visuals.
Measured source targets and strict scene/example validation now supersede the older arrow/overview fallback rules
below. Read the latest acceptance results in [STATUS.md](STATUS.md); historical checks below are not current evidence.

Air implementation update (2026-10-28): read the current [STATUS.md](STATUS.md) before rebuilding the next-step list
below. Insight guards, plots, language, reader polish, voice and documented local workflows are now implemented and
locally tested; real paid-provider quality checks, naming and hackathon decisions remain open. Local demo/backup
instructions are in [DEMO.md](DEMO.md).

Start here if you are new to the project. This page says what the app does today, how to run it, how the parts fit
together, the rules we work by, and what to build next. Details live in the other notes:
[STATUS.md](STATUS.md) (current state), [PLAN.md](PLAN.md) (product plan), [HARNESS.md](HARNESS.md) (how the Meta
models are driven), [USE-CASES.md](USE-CASES.md) (where it is useful beyond papers) and [NAMES.md](NAMES.md) (name
candidates; "Paper Tour" is a working name).

## What it does today

Any uploaded document becomes a tutor that reads it with you:

- **A short tour of the main parts.** A voice explains while the page moves, highlights the exact sentence, zooms
  into figures and draws on them with hand-drawn arrows and circles. Tours are concise: standard is 10-12 steps,
  never more than 30. Depth comes from questions, not from longer tours.
- **A side board** next to the page with small 3Blue1Brown-style animations: a formula built term by term in colour,
  a flow of boxes and arrows, animated bars of the document's own numbers.
- **Asking at any time.** A question pauses the tour; the answer plays as a short tour of its own that points,
  draws and can use the board; then back to the tour. The tour ends with three suggested questions, and follow-ups
  build on earlier answers.
- **Document types.** The writer recognises a research paper, an exercise sheet, a lecture, a contract, a letter or
  something else, and picks a fitting arc and tone. Exercise sheets are taught task by task and solved line by line on
  the board; each line is checked numerically in code, and unchecked lines are marked.
- **The library app** (by Nikolas): uploads to Supabase storage, analysis in a worker, model selection with prices,
  personal Meta keys under Profile & Settings.

A first unedited real run on *Attention Is All You Need* took 33 s and 12 model calls (about $0.20) and produced 11
steps. Its weak points are listed in [STATUS.md](STATUS.md) and are the first items in the plan below.

## Run it

- **Demo without Supabase:** follow the README quick start, then open http://localhost:5174/?paper=attention. Add
  `&silent=1&rate=4` to test quickly without speech.
- **The full app:** README section "Local library setup". With Colima instead of Docker Desktop, start Supabase with
  `mkdir -p .data/tmp && TMPDIR=$PWD/.data/tmp npm run supabase:start`. Then `npm run dev` runs the web app (5174), the
  API (3001) and the worker. The worker does not reload on changes: restart `npm run dev` after server changes.
- **Settings in the root `.env`** (see `.env.example`): `MODEL_API_KEY` for a shared Meta key (or add your own in
  Profile & Settings), `TOUR_PRESET` (`quick`, `standard` or `deep`; the default is `standard`) and
  `PAPER_AGENT_ENABLED=false` (Nikolas's agent, which walks every page). The earlier page-by-page writer and its
  `TOUR_WRITER` setting are retired.
- **A tour without the app:** ingest a PDF, then write the tour with the same generator the worker uses (real API
  calls, so it needs `MODEL_API_KEY`):

  ```bash
  mkdir -p demo/mydoc && cp path/to/doc.pdf demo/mydoc/paper.pdf
  ingest/.venv/bin/python ingest/ingest.py demo/mydoc/paper.pdf
  cd server && node --import tsx run-tour.ts standard /tmp/mydoc-tour ../demo/mydoc mydoc
  cp /tmp/mydoc-tour/tour.json ../demo/mydoc/tour.json
  ```

  Then open http://localhost:5174/?paper=mydoc. Do not commit the PDF, doc.json or figures (gitignored), and commit a
  tour.json only when it is meant as a demo.
- **Tests:** `npm test` at the root runs the player, server and ingest suites; `npm run build` type-checks.
  `ingest/.venv/bin/python ingest/validate.py demo/<paper>` checks a doc.json and its tour against the schemas.

## How it fits together

| Path | What |
|---|---|
| `ingest/` | Python (PyMuPDF): `ingest.py` turns a PDF into doc.json (IDs and coordinates for sentences, blocks, sections, figures, panels, equations, exercise tasks); `process.py` runs it for uploads; `tour_assets.py` renders page and figure images; `verify_math.py` checks solution lines; `validate.py`, `outline.py`, `check_tour.py` are tools |
| `schema/`, `shared/paper.ts` | The two contracts: doc.json and tour.json. A tour names elements by ID and never contains coordinates |
| `server/src/harness/` | The short-tour writer. `generator.ts` runs the stages: understand the document (`card.ts`, `doctype.ts`), plan beats in code (`beats.ts`, `arcs.ts`, `exercise.ts`), direct every beat in parallel with small calls whose targets are limited to that beat (`direct.ts`, `prompts.ts`), assemble and validate in code (`assemble.ts`, `board.ts`). `ask.ts` answers questions |
| `server/src/` | API routes (`app.ts`, `service.ts`; asking is `POST /api/documents/:id/ask`, plus `POST /api/demo/:paper/ask` in local development only), the worker, model calls through the Vercel AI SDK (`ai/`, `generation/`, `muse/client.ts`) and Nikolas's agent (`agent/`) |
| `player/src/` | The reader: `Reader.tsx`, the tour engine (`engine.ts`, with a board channel), target resolution and checks (`resolve.ts`), pen marks (`scene.ts`, `components/PageView.tsx`, `ScreenLayer.tsx`), the side board (`components/Board.tsx`, `board.ts`), asking (`ask/`), the library (`library/`) |
| `notes/` | Plan, harness, status, use cases, names, and the review of the scaffold |

## Rules we work by

1. **The model chooses, the code draws.** Models pick IDs, labels and templates from lists; code computes
   geometry, timing and animation, and validates everything. A bad step is repaired once or dropped, and the tour
   still plays.
2. **Generic, never tuned.** Prompts and code never mention one document. A demo tour is the unedited output of the
   pipeline, exactly as an upload would get it. Judge every change on several different documents.
3. **Concise.** Main parts only; at most 30 steps; depth through questions.
4. **Never point out the obvious, never double.** A pen label says what a part does or why it matters, never the name
   printed next to it. The board never redraws what is on screen: it shows a worked example, a plot of a function or
   the intuition. Equations are unpacked (their parts, how they behave), not read out again.
5. **Clean visuals.** State of the art, calm, consistent with the dark palette, smooth easing, crisp at every zoom,
   and respectful of reduced motion.
6. **Repository hygiene.** The repo is public: never commit papers, doc.json, figures, `.env` files, keys or
   credentials. Pull with `--rebase` before pushing, never force-push, keep commits small.

## Next steps

In order; the first three come straight from a review of the real Attention run.

1. **Insight and no doubling, enforced in code.** Drop pen labels that repeat the figure's printed text or caption;
   drop a flow on the board when its boxes repeat the labels of the figure on screen; use a flow only when it adds
   something (today every method step gets one); keep narration from reading the page aloud. Add tests with fake
   transports, then re-run real documents.
2. **Function plots on the board.** A new `plot` board kind: axes and curves that draw in, a point that moves along a
   curve, KaTeX labels, driven by a safe expression grammar shared by the server (validation) and the player
   (evaluation), no `eval`. The writer then unpacks an equation: its parts plus plots of the functions it uses (for
   example how a curve changes as a parameter grows). Optionally prototype Manim clips (3Blue1Brown's library) from
   our own scene templates with validated parameters, behind a flag.
3. **Narrate in the document's language** (a German sheet gets German narration).
4. **Reader polish.** The open ask panel covers the bottom of the page; the camera restarts its flight when the board
   slides in (retarget it instead); landscape phones leave the stage too little height.
5. **Test on real uploads** through the app: CC BY arXiv papers in different layouts, maths exercise sheets, lecture
   slides, a lease, terms of service, an official letter or form. Fix general causes, never one document's output.
6. **Voice.** Push-to-talk with Muse Voice Transcribe, then interruption while the tour speaks.
7. **Beyond papers** ([USE-CASES.md](USE-CASES.md)): course packs (slides, scripts, past exams), contracts and leases
   with "what changed", life admin from a phone photo in the reader's language.
8. **Name and demo.** Pick a name ([NAMES.md](NAMES.md)), cache demo tours, record a backup video, rehearse the pitch.

Known smaller issues: lexical retrieval can miss the sentence a pronoun follow-up refers to; exercise IDs (`ex1.a`)
are not yet targets the player can point at; long formulas only break at operators; asking on library documents is
covered by tests but has not been clicked through in a browser.

Open questions for the hackathon: its length and judging criteria, which Meta models are required, and whether
non-Meta services (a text-to-speech with word timings, a local OCR library) are allowed.

## Working together

Aaron sometimes has an AI assistant working on the repository too, so agree on who takes which part: two people (or
agents) should never edit the same files at the same time. Say in STATUS.md what you changed.
