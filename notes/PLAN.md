# Plan

Paper Tour turns a document into a tutor that reads it with you. A voice explains while the page moves: it lights
up the sentence that matters, zooms into the figure and draws on it, works through the formula on a board next to the
page, and stops whenever you ask something. It starts with research papers and grows to exercise sheets, lecture
slides, contracts and anything else people struggle to read alone.

This file is the product plan. [HARNESS.md](HARNESS.md) specifies how the Meta models are driven, and
[STATUS.md](STATUS.md) tracks what is built.

## The idea

NotebookLM made documents something you can listen to. Paper Tour makes them something you are taught.

Chat assistants answer questions about a document, but the answer lives in another window and the reader has to find
where it comes from. A tour keeps the document as the canvas and puts the pen in the tutor's hand: every explanation
points at the exact sentence, symbol or part of a figure it is about. The primitive has four verbs:

- **Narrate** the main ideas, briefly.
- **Point** at exact elements: sentences, figures, panels, equations, exercise parts. IDs, never pixels.
- **Draw**: arrows, circles and labels on figures; formulas, derivations and small animations on a side board.
- **Listen**: stop for a question at any moment, answer by pointing and drawing too, then carry on.

If this works on the hardest things people read alone, papers and exercise sheets, it is a general way of reading
with a tutor. The two contracts (doc.json and tour.json) are open, so a tour is a shareable object: a lecturer
publishes a tour of the exercise sheet, an author puts a tour of the paper on the project page.

## Principles

1. **Main ideas first.** Tours are short by default. Depth comes on demand: a deep dive or a question.
2. **Help where it is hard.** Formulas, mechanisms and figures get the most help: symbol by symbol, step by step, with
   visuals.
3. **Point, don't paraphrase.** Every spoken claim is tied to evidence on the page.
4. **Always interruptible.** Ask by voice or text at any time, and the tour ends by inviting questions.
5. **The model chooses, the code draws.** Models pick IDs, labels and templates from lists; the code computes geometry,
   timing and animation.
6. **Never fail on the model.** Everything is validated. A bad step is repaired once or dropped, and the tour still
   plays.

## What the user gets

| Mode | For | What happens |
|---|---|---|
| Overview tour | papers, chapters, slides, reports | 6–14 short steps along the story: problem, key idea, how it works, evidence, limits, takeaway. Ends with "ask me anything" and three suggested questions. |
| Deep dive | one formula, figure or section | A focused mini-tour. The formula is built term by term on the board, the figure is dissected with annotations, the mechanism is animated. Offered inside the tour ("go deeper?") and on demand. |
| Ask | anything, at any time | Push-to-talk or text. The answer is a micro-tour that speaks, highlights, annotates and can use the board, then hands back to the tour. Drawing a box on the page asks about that spot. |
| Tutor | exercise sheets, past exams | For each task: read it, mark what is given and what is asked, plan, solve step by step on the board, check, sum up. "Your turn" pauses with a hint ladder and answer checking. |
| Quiz | the end of any tour | Three questions, answered by voice; the feedback points at the evidence. |

Presets: **Quick** (about 2 minutes, 6 steps), **Standard** (about 5 minutes, 10–12 steps) and **Deep** (about 10
minutes, up to 24 steps, deep dives inline). Today's automatic tours walk every content page and run 50–90 steps; that
is the main thing to change.

## Features

### Short tours of the main ideas

The tour follows the paper's argument, not its pages. A beat plan replaces page coverage: the problem, the key idea,
how the method works (one to three beats), the central formula or figure, the main result with its numbers, one
limitation and the takeaway. Not every page appears. Steps speak 25–45 words and mark at most two sentences. The last
step summarises and offers three questions generated with the tour, so the natural end of a tour is a conversation.

### Formulas, explained the way a tutor would

For each central equation:

- **Read it aloud** in words, then build it on the board term by term. Each term keeps one colour everywhere: on the
  board, in the narration's emphasis and as a box around the same symbols on the PDF page.
- **Say what each symbol is**, its shape or units, and its role (input, weight, normaliser and so on).
- **Give the intuition:** what happens when a term grows or vanishes ("why divide by √d_k?").
- **Work a tiny example** with real numbers. The arithmetic is checked by a computer algebra system before it is
  shown.

The model transcribes the equation into LaTeX from the crop and the extracted text. The server rejects LaTeX that does
not parse and terms that are not substrings of it.

### Annotating figures and images

New pen actions next to highlight, box, spotlight and note: **arrow** with a short label, **circle**, **underline**,
**numbered markers** for a sequence, and **connect** (a line from a phrase in the text to the part of the figure it
names). They are drawn like a tutor's pen, slightly hand-drawn and animated as they appear.

Weak models are bad at coordinates, so they never give any:

- **Set-of-marks.** The server renders each figure crop with a labelled grid (A1 … F6) and its detected panels and
  legend entries. The model picks labels from an enum, and the server turns them into regions.
- **SAM 3.1** for exact shapes. The model names the part ("the red curve", "the encoder stack"), SAM returns its box
  and mask, and the server stores the outline. Results are cached per figure.

### Side visuals ("3Blue1Brown on the side")

A board panel next to the page shows short animations synced to the narration. The model fills parameters of a fixed
template set and the player animates it; models never write animation code (unsafe and unreliable). Templates, in
order of usefulness:

1. **Formula**: term-by-term build with colours and labels.
2. **Derivation**: line-by-line steps with justifications (also the tutor's whiteboard).
3. **Flow**: boxes and arrows of a pipeline or architecture, lighting up in order.
4. **Compare**: bars or a small table animating the paper's own numbers (each number must appear in the evidence).
5. **Vectors and matrices**: dot products, projections, matrix products, attention grids.
6. **Function plot**: whitelisted functions (softmax, ReLU, sigmoid, log, exp, polynomials) with a moving point.
7. **Distribution and number line**: probabilities, thresholds, intervals.
8. **Timeline**: training schedules, events, protocol steps.

The look is consistent: dark board, one colour per symbol shared with the page, smooth easing. Muse Image may later
draw illustrative stills for analogies, never data.

### Ask, at any time and at the end

- Push-to-talk records the question and sends it to Muse Voice Transcribe; text input works too.
- The answer is a micro-tour of one to three steps. Its actions can only target the passages retrieved for the
  question (an enum), and it may use the board. Then "back to the tour" or "ask another".
- Context: the current step, the tour so far, the retrieved passages and the figure on screen when the question is
  about "this".
- **Draw a box and ask:** the drawn rectangle is hit-tested against doc.json to find the sentences and figure parts
  under it, and its crop goes to the vision model with the question.

### Voice

Meta's API has speech-to-text (Muse Voice Transcribe, with turn-level timing) but no text-to-speech. Narration keeps
using browser voices, with word-boundary events for sync and timed narration as the fallback. A third-party TTS with
word timestamps is an option only if the hackathon allows non-Meta services.

## Beyond papers

The engine only needs a document with stable IDs. [USE-CASES.md](USE-CASES.md) ranks 22 use cases with market
context; it recommends course packs, then contracts and leases ("what changed"), then life admin from phone photos in
the reader's language. Use cases, roughly in order of value for us:

| Use case | What the tour does | New work | Priority |
|---|---|---|---|
| Research papers | Overview, deep dives, ask, quiz | Short-tour harness, board, pen actions | P0 |
| Exercise sheets (Übungsblätter) | Tutors each task: givens, plan, step-by-step solution on the board, "your turn" with hints, answer checking | Exercise and sub-part IDs in ingestion, derivation board, maths verification, solution-sheet alignment | P0 |
| Lecture slides and scripts | Narrated lecture, "explain slide 14 again", exam summary | Slides as pages; images without captions as targets | P1 |
| Past exams | Timed drill with hints, graded against the official solution | Reuses tutor mode | P1 |
| Contracts, leases, terms of service | "What am I signing": obligations, costs, deadlines, risks, then Q&A | Clause IDs (§ and numbered clauses), a clear not-legal-advice framing | P1 |
| Textbook chapters | Concept tours with checkpoints and visuals | Longer documents: chapter selection | P2 |
| Forms and bureaucracy | Field-by-field guide to what goes where and why | PDF form fields as IDs | P2 |
| Manuals, datasheets, standards, RFCs | Onboarding tours, "where is X configured?" | Tables and lists as targets | P2 |
| Annual and financial reports | The few numbers that matter, annotated charts, trends on the board | Chart parts through SAM | P2 |
| Code and pull requests | Guided code tours with diagrams on the board | Files and lines as IDs (different ingestion) | P2 |
| Thesis defence and peer review | "Examine me": the tutor questions you about your own document | Reuses quiz and ask | P2 |
| Accessibility and language learning | Structured narration, bilingual tours | Tour language already exists | P2 |
| Patents | Claims mapped onto the drawings' reference numerals | Numeral detection in drawings | P3 |
| Medical letters, lab results, insurance | Plain-language walkthrough with strong safety framing | Careful prompts and disclaimers | P3 |
| Posters, art, maps | Image-first tours | SAM-driven targets | P3 |

The biggest audience is students: exercise sheets, slides and past exams. The broadest is everyone facing a contract
or a form. Researchers are where we start because papers are the hardest test of pointing and explaining.

## The demo (2–3 minutes)

1. **Upload a paper.** The progress view shows the stages; the first step plays after about 30 seconds while the rest
   is still being written.
2. **Quick tour.** The problem sentence lights up. Figure 1 gets arrows on the encoder and decoder. The attention
   formula is built term by term on the board while the same symbols are boxed on the page. The results table becomes
   animated bars.
3. **Ask at the end, by voice:** "why divide by the square root of d_k?" The answer highlights the footnote that
   explains it and the board shows the variance of a dot product growing with d_k.
4. **Exercise sheet.** The tutor reads task 1a of a linear algebra sheet, boxes what is given, and asks "what would you
   try first?" The student answers by voice; the tutor confirms and does the row operations on the board, each line
   checked by SymPy, then verifies the result.
5. **Teaser:** a rental contract, "three things to know before you sign", each one highlighted.

Cached tours and a recorded backup video cover a failing network.

## Architecture

```
upload ─▶ ingest (PyMuPDF): doc.json, crops, set-of-marks crops, equation glyphs, exercise parts
            │
            ▼
      harness (Meta models, see HARNESS.md)
        understand ─▶ plan beats ─▶ direct beats (parallel) ─▶ enrich: formulas, SAM, visuals
                                                  ─▶ verify ─▶ assemble + validate ─▶ tour.json + boards
            │                                                        (streamed beat by beat)
            ▼
      player: pdf.js + pen overlay + board + narration + ask
            ▲ ▼
      runtime: ask (retrieve ─▶ answer micro-tour ─▶ validate), tutor checkpoints (check answer ─▶ feedback)
```

Built today: ingestion, the player, the library app (uploads, Supabase, worker, model selection, personal keys) and a
one-shot Muse tour writer with a visual inspection pass. The harness replaces the one-shot writer.

## Contract changes (tour@0.2)

Backwards compatible: v0.1 tours keep playing.

- **Pen actions:** `arrow`, `circle`, `underline`, `mark` (numbered marker) and `connect`, each with a target, an
  optional region and label, and a colour from the palette.
- **Board:** `boards` lists the tour's board items (`formula`, `derivation`, `flow`, `compare`, `vectors`, `matrix`,
  `plot`, `distribution`, `timeline`) with template data. Actions `board` (show an item), `board_focus` (light up a term
  or line) and `board_clear`.
- **Checkpoints:** a step can pause for the learner: prompt, expected answer, hint ladder, check method (`sympy`,
  `exact`, `judge`).
- **Tour metadata:** `mode` (overview, deep, tutor, answer), `preset`, `suggested_questions`.
- **doc.json:** glyph boxes for equation parts; exercise structure (`ex1`, `ex1.a`) with statement blocks and points;
  captionless image regions for slides.
- **Authoring:** models give an anchor phrase from the narration instead of `at_word`; the server resolves it to the
  word index before saving.

## Roadmap

Scale to the hackathon's real length. Each tier ends in something demoable.

**P0, the demo:**
1. The beat harness for overview tours with presets and suggested questions, replacing the page-coverage writer.
   Stream finished beats to the player.
2. Ask at the end and during the tour: text first, then push-to-talk through Muse Voice Transcribe.
3. Formula deep dive: board panel with KaTeX, term colours, matching boxes on the page.
4. Pen actions (arrow, circle, label) with set-of-marks region picking.
5. Tutor v1 for one subject done well (linear algebra), with SymPy checks and one "your turn" checkpoint.
6. Evaluation suite with fixture documents; cached demo tours; backup video.

**P1:** SAM regions, the flow, compare, vectors and plot templates, voice barge-in, slides and contracts, quiz, a
length and depth control in the UI.

**P2:** the other use cases, sharing and embedding tours, two-voice podcast mode, multilingual tours, code tours.

**Team split (to confirm):** Aaron owns the harness, the ingestion additions and the evaluations; Nikolas owns the app:
board, ask UI, voice, the library and deployment. Demo content and the pitch are shared.

## Risks

| Risk | Mitigation |
|---|---|
| The model invents facts or IDs | Enum-constrained IDs (enforced by Meta's constrained decoding), evidence per step, an independent faithfulness check, drop instead of show |
| Wrong maths in tutor mode | SymPy checks of each step and the final answer, solution sheets as ground truth, two independent solves with Muse Wonder deciding disagreements, "let's check this together" when unsure |
| Slow generation (many calls) | Parallel beats, one shared cached prefix, Spark by default, streaming beats to the player |
| Cost | Prompt caching, per-stage caches keyed by content hash, Wonder only where it pays off; about half a dollar per Standard tour (estimate in HARNESS.md) |
| Messy layouts on new document types | Test ingestion early on real exercise sheets, slides and contracts; page IDs and set-of-marks as fallbacks |
| Browser voices vary | Pick good voices per platform; timed narration fallback |
| Wi-Fi or an API fails live | Cached tours and a recorded backup video |
| Rights to demo documents | Openly licensed papers (arXiv CC-BY), our own exercise sheets; uploads stay private |

## Open questions

- The hackathon's length, judging criteria, required Meta models, team size and demo format (live or video).
- Are non-Meta services allowed, for example a TTS with word timestamps?
- Which exercise sheets for the demo (subject, language), and do we have their solutions?
- The teaser after the exercise sheet: contracts or slides?
