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

**Next, in order:**
1. Re-check the player findings, then fix the medium findings and the low ones that are cheap.
2. Real TTS with word timestamps, filling `audio` in each step; browser voices are the fallback.
3. Voice Q&A: pause, answer with the current step as context, emit the same actions, resume.
4. Draw a box on a figure and ask about it.

**Running the static demo:** after the README quick start, `npm run dev` in `player/` (or `npm run dev:demo` from the
root), then open http://localhost:5174/?paper=attention. Add `&silent=1&rate=4` to test quickly without speech.

**Local Supabase with Colima:** `npm run supabase:start` fails with "bind source path does not exist: /var/folders/…",
because the experimental stack mounts a temp folder that Colima's VM cannot see (it shares only your home folder).
Give it a temp folder inside the repo instead: `mkdir -p .data/tmp && TMPDIR=$PWD/.data/tmp npm run supabase:start`.
