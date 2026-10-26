# Status (2026-10-26)

**Working:** ingestion, both schemas, the player, and a 38-step hand-written tour of *Attention Is All You Need*.
`validate.py` reports 0 errors, `npm run build` has 0 TypeScript errors, and `npm test` passes 18 tests. The tour was played
end to end in the browser.

**Review round, stopped early:** six reviewers each looked at one area and a skeptic verified every finding. 37 findings were
confirmed and 2 refuted. All of them, with evidence and suggested fixes, are in
[review-2026-10-26.json](review-2026-10-26.json).
- Confirmed findings by severity: 3 high (all ingestion on unseen papers), 12 medium, 22 low.
- The ingest and player fixers were stopped partway through. Some of their edits are in this commit, and all checks still
  pass. Which findings they actually fixed is not recorded, so re-check every finding before marking it done.
- The tour and docs fixes (L5-*, L6-*) were not started.

**Next, in order:**
1. Re-check and fix the high findings: L1-1 (tall booktabs tables), L1-2 (tables crossing the column gutter), L1-7
   (roman-numeral headings).
2. Fix the medium findings, then the low ones that are cheap.
3. Replace browser speech with real TTS that returns word timestamps, filling `audio` in each step.
4. Write the LLM tour writer: `outline.py` output, figure crops and citing sentences in; `tour.json` out; `validate.py` as the
   guardrail.
5. Voice Q&A and "draw a box and ask".

**Running the player:** after the README quick start, `cd player && npx vite`, then open
http://localhost:5173/?paper=attention. Add `&silent=1&rate=4` to test quickly without speech.
