# Paper reading and source order

The reader has two independent playback modes. Guided tours retain their existing agent, saved scripts and questions. **Read aloud** is a detailed, source-faithful paper reading without a question box, suggested questions or learner checks. Its options live in the player's Audio menu.

## Source contract

- The model prepares prose from the actual PDF analysis. Layout whitespace, soft hyphens and recognized citation markers are cleaned first. Every original word, number, operator and negation must survive in the same order. Case, punctuation and broken-word hyphens may change; timed source cues retain their word positions.
- A changed draft receives one explicit correction request. An unresolved failure pauses reading; it does not silently publish a summary or speak OCR garbage.
- Consecutive section/subsection headings and the following paragraph form one natural reading unit and one model request. Their individual PDF targets remain separately highlighted. The same shared unit builder drives model context, playback, page navigation and search jumps, including units spanning pages.
- Author/affiliation blocks, page headers/footers, figure labels and footnotes are excluded from spoken reading. Footnotes remain available as source context for explanations. Bibliography and citation-marker settings are explicit. Captions linked to a figure/table are incorporated into that visual explanation; they are not a second literal reading. Unmatched or ambiguous captions remain source text.
- Formulae, tables and figures use the existing explanation/visual-authoring workflow with the original PDF selection and full-page context. Their spoken explanation may differ from literal symbols/cells. PDF annotations and useful live visualizations remain available. These explanation steps are joined with their original word-relative action timing, rather than replaced by static prose.

## Playback and persistence

The engine waits for cancellable lazy speech preparation before speaking. Prepared captions, word timing and visual actions are adopted together; a subsequent resume keeps the current sentence. Ordinary prose clears an earlier visual board. Guided-tour checkpoints are not overwritten with synthetic reading IDs.

`reading_speech` permanently stores validated speech and visual actions under an owner/document/analysis/source/model/provider/language/cleanup/prompt-version key. Migration: `202611020002_reading_speech.sql`. Deleting a document/analysis cascades to this cache. Direct client access is revoked; the authenticated service checks document ownership before every lookup. Concurrent requests in one API process share in-flight generation; failed/cancelled outputs are not stored. Live cache versions intentionally invalidate when the reading contract changes.

The first uncached unit can still wait for its model request. Entering Read aloud starts background preparation from the restored reading position, without waiting for Play or a spoken word. Browser TTS synthesizes the saved text with the chosen voice; audio files are not cached. Native mathematical pronunciation and OCR quality remain dependent on the source/browser. Object explanation quality is still a model judgement; passing unit tests is not evidence that every paper explanation is pedagogically excellent.

## Tour order

Evidence is presented to the direction writer in ingestion reading order (including columns), and the prompt asks for premises before conclusions and signalled returns. A prose step's initial camera target follows its first valid spoken cue. Cues are never independently sorted away from their narration. Saved older tour narration is not silently rewritten; regenerate it to receive the new planning instructions.

## Verification

Player suite and production builds; full DB-backed server suite; regression coverage for source-word preservation, malformed output/repair, heading grouping, table grouping, semantic navigation, source order, timed visuals, interruption/resume, cache identity, persistence across instances, shared flights and cancellation.

Real reader checks used the Loss-Free Balancing PDF: original prose, repaired title hyphenation, metadata exclusion, question-free UI, Audio menu placement, return to the saved guided-tour checkpoint, and a grounded two-part table explanation. Stored prose survived an API restart and a new browser load; cached endpoint responses were approximately 8–22 ms. The table explanation used the existing agent workflow, two PDF images and one model call. No new full paid guided tour was generated solely for this change.

## Contextual visuals follow-up

The displayed expression, not an OCR component, is the reading unit. Nearby equation fragments in the same page/section are grouped using layout and text-line geometry; case words inside the display stay with it. Separate columns and prose boundaries remain separate. A logical math target resolves to the complete source rectangle, so a summation index cannot become the default view of the whole explanation.

Caption association uses ingestion's explicit link first, then an unambiguous same-page source-text match (including split caption blocks). The visual explanation receives that source caption plus the preceding/already-read and following/to-be-read source passages. Caption definitions, timing, units and qualifications belong in the explanation. Unassociated captions are retained rather than silently discarded. Only visual cache keys change for this contract; validated ordinary prose stays reusable.

Visual explanations continue the surrounding reading rather than restart it as a standalone answer. The model is shown which adjacent prose was already read and which will be read verbatim next. It should add the mechanism, relationship or comparison, reserving the next paragraph's glossary and claims for the actual original text. Adjacent visuals are labelled as source evidence, not fabricated spoken transcripts. Introductory recaps, "the selected object" openings and repeated concluding previews are discouraged, without deleting or paraphrasing the original passages. The visual cache version changes so older repetitive explanations are regenerated; cached original prose remains valid.

The shared answer workflow has an internal reading purpose: continuation instructions, a planning field separating already-read/reserved/new material, and an empty follow-up schema. Its developer policy is separate from the untrusted source evidence. Public Q&A retains its standalone answer instructions and follow-ups; answer caches distinguish the two purposes. Reading uses the same grounding, visual authoring and validation path.

## Structured procedures

Procedural source material also uses the explanation route. Generic control-flow, assignment, input/output and numbered-operation cues identify candidates; same-page, same-column layout joins their adjacent OCR blocks, including embedded equations, closing lines and outputs. Titles or incidental algorithm mentions alone do not change ordinary prose into an explanation. Existing figure/table ownership takes precedence, and narrative paragraphs, section/column/page boundaries stop grouping. No paper titles, variable names, algorithm numbers or source coordinates are built into the recognition.

The model receives the full original region and page context and chooses a natural explanation of purpose, initialization, dependencies, repetition/branching, updates and result, preserving signs and timing without reciting syntax. This remains structural recognition plus model interpretation, not a guarantee of detecting every possible abstract passage. Synthetic source targets resolve to all component rectangles; search and navigation to any component return to the same explanation. The Loss-Free PDF's algorithm (`p4.b3`–`p4.b6`) now forms one procedural unit instead of literal prose, a separate update expression, `end` and `Output` readings. Ordinary text remains source-faithful.

The actual Loss-Free PDF was checked against its reading plan: page 3's 17 mathematical/OCR fragment passages become two complete expression units, and `p2.b2` is part of `fig1`, not a later caption-only unit. Fresh generated speech for the figure and both mathematical displays was compared with the source page. The routing/update loop and complete MoE/loss relationships are described together; native annotations and live boards remain available. This check does not establish perfect model explanation quality on every paper.

## Lookahead preparation

From mode entry, the reader prepares the current unit and then the remaining natural units, one background request at a time. Preparation continues during speech and speech pauses while Read aloud stays open. Foreground playback joins an already-running request, including camera handoff, and takes priority when seeking to an uncached earlier passage. Completed speech, annotations and animations are reused from the durable cache. Seeking discards obsolete work; leaving the mode or opening a separate answer stops background work. An isolated content rejection is not retried in the background; later passages can still be prepared. Authentication/provider outages or two consecutive content failures suspend the queue, preventing one failing call per remaining paragraph. Playback can retry the failed passage; it is never silently skipped in the spoken reading. The loader also handles React StrictMode's setup/cleanup replay.

Authored scene preparation renders its first frame in the same isolated, time-bounded worker as playback, then terminates the worker. The visible scene reuses that cached preview while its live renderer starts. Preview memory is bounded; full animation code and timed actions remain in the reading cache. Plotly module loading is shared with background preparation. Native boards already carry their render data. This prepares visuals without playing them early or replacing live animations with videos.

Tests cover mode-entry preparation beyond the old two-unit window, sequential warming, duplicate-request prevention, camera handoff, navigation cancellation and priority, text/action cache reuse, preview reuse/cancellation, lifecycle replay and failed foreground/background retry loops. In the earlier real reading run, upcoming passage requests started while the current visual explanation was being narrated; the next original text followed without a separate caption reading.
