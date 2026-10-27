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
- **Built by five parallel agents, stopped before their reviews to save usage** (all type checks, server tests,
  ingest tests and the demo identity check pass; one player test fails):
  - Pen: arrows and circles drawn on the page (scene.ts, PageView.tsx, ScreenLayer.tsx, pen.css, test/pen.test.ts,
    not yet in `npm test`). Test tour: `?paper=pen-test` (git-excluded folder).
  - Board: KaTeX formula built term by term, flow and bars (components/Board.tsx, board.ts, board.css), placed by
    Reader.tsx. `player/test/board.test.ts` fails on "a bar has a rounded tip away from zero and a square base on it",
    which also stops the later player tests in the chain. Test tour: `?paper=board-test`.
  - Writer: formula, flow and bars boards and pen cues in the harness (server/src/harness/board.ts and others,
    test/harness-board.test.ts). Not yet run against the real API.
  - Ask: `server/src/harness/ask.ts`, a route in app.ts/service.ts, test/ask.test.ts, and `player/src/ask/`
    (AskPanel, api). Not yet wired into Reader.tsx.
  - Exercises: exercise-sheet structure in doc.json (ingest.py, validate.py, outline.py, doc schema, shared/paper.ts,
    test_exercises.py); papers ingest exactly as before.
- None of the agents' work has been reviewed. Review each stream's diff before building on it.

**Next, in order:**
1. Fix the failing board test, add the pen test to `npm test`, and review the five streams' diffs.
2. Wire AskPanel into Reader.tsx: pause the tour, play the answer as a short second tour on the same narrator,
   camera, pen and board, then "back to the tour" or "ask another"; suggested questions at the end.
3. Run a real tour on the demo paper with the board and pen, and look at it in the player.
4. Push: main is ahead of origin with local commits (pull --rebase first).
5. Then: push-to-talk with Muse Voice Transcribe, the formula deep dive on demand, exercise-sheet tutor mode, and the
   use cases in USE-CASES.md (course packs, contracts, life admin).

**Running the static demo:** after the README quick start, `npm run dev` in `player/` (or `npm run dev:demo` from the
root), then open http://localhost:5174/?paper=attention. Add `&silent=1&rate=4` to test quickly without speech.

**Local Supabase with Colima:** `npm run supabase:start` fails with "bind source path does not exist: /var/folders/…",
because the experimental stack mounts a temp folder that Colima's VM cannot see (it shares only your home folder).
Give it a temp folder inside the repo instead: `mkdir -p .data/tmp && TMPDIR=$PWD/.data/tmp npm run supabase:start`.
