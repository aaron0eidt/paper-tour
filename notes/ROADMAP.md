# Roadmap to the Nov 4 submission (written 2026-10-29)

This picks from [IDEAS.md](IDEAS.md) (eight explorations, about 90 proposals) and [HACKATHON-PLAN.md](HACKATHON-PLAN.md)
(rubric, models, demo).

**How items are chosen:**
- Aaron's priorities: visuals that show what the document is trying to show, with diversity first; direct narration of
  only the most important parts; each document type handled in its own way; a polished product.
- The rubric: impact 30, Meta tooling 25, demo 25, depth 20.
- Whether the item helps the 3-minute video and a live final that cannot fail.

**How each wave is built:** Sonnet agents work on separate files, Opus reviews every diff, then all tests run, then real
tours on several documents are watched in the reader before a commit. The work stays on branch `feat/richer-visuals`.

## Wave 0, in progress: visuals and narration, version 2

Design in [VISUALS-V2.md](VISUALS-V2.md):
- heatmap, scatter and shapes boards;
- a whole-tour visual plan, diversity first;
- dropping repeated board data;
- the paraphrase check;
- shorter standard tours.

## Wave 1: safe demo, smarter papers, Meta perception

1. **A tour never fails because of one visual.** A degrade ladder: repair, simpler board, no board, never a failed
   tour. Flags show in Activity. (IDEAS, speed 2)
2. **Equation inventory.** Unnumbered and inline formulas become targets, so positional encoding or multi-head can get
   a board. (papers 5)
3. **Table intelligence.** Tables are read into typed grids, and code derives the views that the new boards need. A
   trade-off becomes a scatter of two table columns; an ablation becomes changes from the base row; a grid of results
   becomes a heatmap. The values are grounded by construction. (papers 3)
4. **Narration moves.** The conclusion first, one "because", numbers with their comparison, never an echo of the
   highlighted text. (papers 2)
5. **SAM 3.1, if the spike says go.** Contour outlines for parts of figures, and a learner's loose selection snapping
   to the object. OpenCV is the fallback. (strategy 1)
6. **Reader polish I:**
   - a safe-area camera and legibility zoom;
   - an ask dock that never covers the text;
   - marks that perform;
   - a seekable timeline and the keyboard. (reader 1, 2, 3, 5)

## Wave 2: every document gets its own tour

1. **Papers.** A claim spine: claims with their evidence, why each works, its scope and the catch. An opening delta
   card and a closing claim ledger. (papers 1, 4, 8)
2. **Slides:**
   - slide-aware ingestion;
   - a deck story planner that skips boilerplate and merges trivial slides;
   - narration that says what the lecturer would say;
   - a deck mode with cuts instead of flights. (slides 1-3, reader 6)
3. **Exercise sheets.** A coach mode: "your turn" pauses, a hint ladder and reveal on tap. Derivation and matrix
   boards whose lines are checked in code. (exercises 1, 3, 5)
4. **Practical documents.** The tour in the reader's language, with quotes kept in the original. A "what this is to
   me" plan, plus timeline and cost boards. Always understanding, never advice. (practical 2, 4; visuals 3)
5. **Muse Wonder as director and critic.** It plans the whole tour's visuals. It flags repeats, paraphrases and a
   missing core idea; only the flagged steps are redone, on Spark. (strategy 2)
6. **No waiting:**
   - Progressive tours: the first step plays while the rest is written.
   - Answers that start speaking early.
   - Prefetched answers to the suggested questions. (speed 1, 5; reader 9)

## Wave 3: diversity and polish, then freeze on Nov 2 at noon

1. **More visual kinds:**
   - plot version 2 (marks computed by code, log axes, data points, a slider for the paper's own parameter);
   - distribution;
   - anatomy of a dense statement;
   - probability (trees, natural frequencies);
   - quantity flow. (visuals 1, 2, 4, 7, 8; papers 6)
2. **Learning:**
   - a start card (goal, level, minutes);
   - "Not clear?" on every step (simpler, example, term, deeper);
   - tap any term for an instant glossary. (learning 1, 2, 8)
3. **Voice.** Recognition keywords from the document, and the learner's language. (strategy 3)
4. **Evidence.** A batch of all test documents (success, time, cost), pointing accuracy, and a scorecard. (papers 12)

## Nov 2 to Nov 4: the submission

- Video, README (positioning, "what this is not", provenance), secret scan, LICENSE.
- Cached demo tours, and a preflight check.
- Submit by Nov 4, 18:00 Berlin.

## Needs Aaron or Nikolas

- Provenance wording, credits, the track, the name and the opening story ([HACKATHON-PLAN.md](HACKATHON-PLAN.md)).
- The video voiceover and the X post.
- A Baseten key for open weights.
- Pilot readers.
- Merging the branch into main.
