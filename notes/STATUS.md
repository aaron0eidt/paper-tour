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

**Review round on the scaffold, stopped early:** six reviewers each looked at one area, and a skeptic verified every
finding. 37 findings were confirmed and 2 refuted. All of them, with evidence and suggested fixes, are in
[review-2026-10-26.json](review-2026-10-26.json). They predate the library app.
- Confirmed findings by severity: 3 high (all ingestion on unseen papers), 12 medium, 22 low.
- The ingest and player fixers were stopped partway through. Some of their edits are in the code and all checks still
  pass, but which findings they actually fixed is not recorded, so re-check every finding before marking it done.
- Ingest 0.2 (Nikolas) detects roman-numeral (IEEE) headings and matches captions more loosely, which may cover L1-7.
- The README now covers L6-1 (Python 3.10+) and most of L6-3 (testing options, tour tools). The other tour and docs
  findings (L5-*, L6-*) are open.

**Next, in order:**
1. Re-check and fix the high findings L1-1 (tall booktabs tables) and L1-2 (tables crossing the column gutter), and
   confirm L1-7 (roman-numeral headings).
2. Fix the medium findings, then the low ones that are cheap.
3. Real TTS with word timestamps, filling `audio` in each step; browser voices are the fallback.
4. Voice Q&A: pause, answer with the current step as context, emit the same actions, resume.
5. Draw a box on a figure and ask about it.

**Running the static demo:** after the README quick start, `npm run dev` in `player/` (or `npm run dev:demo` from the
root), then open http://localhost:5174/?paper=attention. Add `&silent=1&rate=4` to test quickly without speech.
