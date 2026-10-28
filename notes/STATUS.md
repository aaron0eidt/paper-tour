# Status (2026-10-27)

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
  tour of the demo paper: 23 s, 11 steps, about $0.20. Run it locally with `server/scripts-local-run-harness.ts`
  (git-excluded) and view it at `?paper=attention-short` (git-excluded folder).
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
  12 model calls, no fallback beats. Watch it at http://localhost:5174/?paper=attention-short (git-excluded folder;
  regenerate with `cd server && node --import tsx scripts-local-run-harness.ts standard <out> ../demo/attention
  attention-short`, then copy `<out>/tour.json` into `demo/attention-short/`). Good: concise steps, highlights
  everywhere, the formula built term by term with each term lit, results as bars, three good questions. Weak: pen
  labels repeat names the figure already shows ("Encoder stack"), both figure steps redraw their figure as a flow
  on the board, every method step uses a flow, no function plots yet, and the open ask panel covers the bottom of
  the page.
- **Test documents (local only, never commit):** 13 PDFs with a manifest in the session scratchpad
  (`.../scratchpad/night/docs/MANIFEST.md`): three CC BY arXiv papers (IEEE robotics, physics, biology), three maths
  sheets, MIT slides, two UK tenancy agreements, two versions of Google's terms, a German data-protection letter and
  the IRS W-9.
- **Names:** notes/NAMES.md proposes Nib, Penlight and Lupe to replace "Paper Tour" (Aaron to choose).

**Next, in order (Aaron's direction, 10-28):**
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
