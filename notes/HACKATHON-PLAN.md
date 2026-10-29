# Hackathon plan (2026-10-29)

**The event:** Meta Global AI Developer Hackathon with Cerebral Valley, virtual, $1M.
- Submissions are due **Wed Nov 4, 9 PM ET**, which is Thu Nov 5, 3 AM in Berlin. Plan to submit by Nov 4, 18:00 Berlin.
- Judging runs Nov 5-8, and the top 5 per track demo live at the Nov 9 final.

**Official page:** https://dev.meta.ai/events/global-hackathon (also https://cerebralvalley.ai/e/meta-ai-developer-hackathon).
- **Indie track:** "creativity, technical ambition, and whether it works". This is ours, for students and individual builders.
- **Startup track:** "technical execution and whether it holds up in production".
- **Themes:** "Build for Your World" (a problem you know firsthand) and "Push the Frontier".
- **Models:** "Use the Muse Spark series, Muse Image and SAM 3.1 through Meta Model API", plus open weights and Muse Code.

**The rubric and rules below are not official.** They come from another team's copy of the participant guide (github.com/meta-ai-hackathon/meta-hack, `info/`). Confirm them in the official guide or on Discord.
- **Pass or fail:** fits a theme, and genuinely uses Meta's models.
- **Scoring:** Impact 30%, Meta AI tooling 25% ("creative use, beyond basic integration"), Demo 25% (works live and impresses; the 3-minute video is the main judging artifact), Technical depth 20%.
- **Rules:** new work only (unclear contribution disqualifies), a public repo, at most 4 people, every contributor listed.
- **The official anti-project list** includes "Basic RAG Applications" and simple "AI for Education" chatbots. "Chat-with-your-PDF" is only in that team's own list of things they consider banned in spirit.
- **Bonus awards:**
  - Most Viral, $20K: X engagement through Nov 8.
  - Open Weights, $10K.
  - Community Vote, $10K.
  - Best Agentic Use-Case, $5K.
  - Best Creative Build with Muse Image or Wonder, $5K.

## Decisions for Aaron

1. **Provenance.** The first commit (10-26 17:37 Berlin, 37 minutes after the 12:00 ET kickoff) already holds ingestion, both schemas, the player and a 38-step tour. If any of it predates the kickoff, disclose it. Either way, add a README "Provenance" section: dates, authors, libraries.
2. **Credits and track.** Each person claims their own $150 Meta credits before the deadline (a card is needed). Confirm the Indie track and the theme.
3. **Name.** Pick from NAMES.md (Nib, Penlight, Lupe); "Paper Tour" undersells sheets, slides and manuals.
4. **The story.** The opening needs Aaron's own moment: a paper or sheet that cost him hours, and why a chat did not help.

## Positioning

The product is a visual tutor that points at the real page. It is not a chat.
- **The video:** no chat box in the first 15 seconds. It opens on a moving page, a precise outline and a voice.
- **Words:** say tour, pen, board, measured, checked. Avoid chat, summarize, assistant, advice, grade.
- **The README:** gets a "What this is not" table, one row per banned category.
- **Practical documents** (leases, terms, letters) appear only as short teasers. Never present them as advice.

## Using Meta's models (25%)

"Spark reads, Wonder directs, SAM measures, Voice listens."
1. **SAM 3.1 for parts of figures:**
   - Exact contours for figure parts in tours.
   - A learner's loose region selection snaps to the object they meant.
   - OpenCV stays as the fallback, then the raw rectangle.
   - A spike decides go or no-go: latency and mask quality per figure type.
2. **Muse Wonder** as the whole-tour director: the visual plan. It could also be a critic that flags repeats, paraphrases and a missing core idea. Spark falls back on errors. A/B it against Spark only, measuring repeated data, distinct board kinds and cost.
3. **Muse Voice Transcribe:** add keywords (title terms, symbols, authors) and a language bias.
4. **Open weights:** Spark Open via Baseten as a selectable model, with a parity table. This needs a Baseten key, so it is Aaron's decision.
5. **Muse Image:** only a clearly labelled intuition illustration, and only if it truly helps. Never for data or labels.

## Demo (25%)

**The 3-minute video:**
- **0:00 Hook:** a hard figure page, and the pen traces the part that matters.
- **0:08 Upload:** a fresh paper; the activity shows the models working; the first step points and outlines.
- **0:35 The board:** a formula built term by term, then a new heatmap, scatter or shapes visual.
- **1:05 A spoken question:** a loose drag snaps to the object.
- **1:40 Exercise sheet:** a German sheet explained in English, solved line by line, the lines checked in code.
- **2:05 A manual or slides.**
- **2:25 Under the hood:** the models and the checks, and real numbers.
- **2:45 Close.**

**The live final cannot fail:**
- Cached tours, and static demo copies.
- A preflight check of every model.
- Prefetched answers to the suggested questions.
- The standard preset (quick if a judge uploads).
- A backup video.

## Technical depth (20%) and hardening

- **Highlight:**
  - The model chooses and the code draws: tours hold IDs, never coordinates.
  - Layered validation, and a safe expression grammar.
  - Measured geometry, with a fallback chain.
  - Parallel generation, and recovery.
  - The evaluation numbers.
- **Harden:**
  - The standard default.
  - One bad step must never fail the whole tour.
  - Unusual uploads (scanned, huge, not English).
  - A cost cap and backoff.
  - A secret scan of the public history, plus a LICENSE.
  - A README quickstart that works on a clean clone.

## Evidence to gather

1. A batch of real tours over the 13 test documents: success rate, time, cost, steps.
2. Pointing accuracy: model-guessed regions against measured ones against SAM.
3. If possible, a small pilot (8-10 readers), reported honestly.
