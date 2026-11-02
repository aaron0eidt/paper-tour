# Paper reading and source order

The reader has two independent playback modes. Guided tours retain their existing agent, saved scripts and questions. **Read aloud** is a detailed, source-faithful paper reading without a question box, suggested questions or learner checks. Its options live in the player's Audio menu.

## Source contract

- The model prepares prose from the actual PDF analysis. Layout whitespace, soft hyphens and recognized citation markers are cleaned first. Every original word, number, operator and negation must survive in the same order. Case, punctuation and broken-word hyphens may change; timed source cues retain their word positions.
- A changed draft receives one explicit correction request. An unresolved failure pauses reading; it does not silently publish a summary or speak OCR garbage.
- Consecutive section/subsection headings and the following paragraph form one natural reading unit and one model request. Their individual PDF targets remain separately highlighted. The same shared unit builder drives model context, playback, page navigation and search jumps, including units spanning pages.
- Author/affiliation blocks, page headers/footers, figure labels and recognizable contact metadata are excluded. Bibliography and citation-marker settings are explicit. Captions and substantive footnotes remain source text.
- Formulae, tables and figures use the existing explanation/visual-authoring workflow with the original PDF selection and full-page context. Their spoken explanation may differ from literal symbols/cells. PDF annotations and useful live visualizations remain available. These explanation steps are joined with their original word-relative action timing, rather than replaced by static prose.

## Playback and persistence

The engine waits for cancellable lazy speech preparation before speaking. Prepared captions, word timing and visual actions are adopted together; a subsequent resume keeps the current sentence. Ordinary prose clears an earlier visual board. Guided-tour checkpoints are not overwritten with synthetic reading IDs.

`reading_speech` permanently stores validated speech and visual actions under an owner/document/analysis/source/model/provider/language/cleanup/prompt-version key. Migration: `202611020002_reading_speech.sql`. Deleting a document/analysis cascades to this cache. Direct client access is revoked; the authenticated service checks document ownership before every lookup. Concurrent requests in one API process share in-flight generation; failed/cancelled outputs are not stored. Live cache versions intentionally invalidate when the reading contract changes.

The first visit to an uncached unit can wait for a model request; reading is generated on demand, not as a new full-document background job. Browser TTS synthesizes the saved text with the chosen voice; audio files are not cached. Native mathematical pronunciation and OCR quality remain dependent on the source/browser. Object explanation quality is still a model judgement; passing unit tests is not evidence that every paper explanation is pedagogically excellent.

## Tour order

Evidence is presented to the direction writer in ingestion reading order (including columns), and the prompt asks for premises before conclusions and signalled returns. A prose step's initial camera target follows its first valid spoken cue. Cues are never independently sorted away from their narration. Saved older tour narration is not silently rewritten; regenerate it to receive the new planning instructions.

## Verification

Player suite and production builds; full DB-backed server suite; regression coverage for source-word preservation, malformed output/repair, heading grouping, table grouping, semantic navigation, source order, timed visuals, interruption/resume, cache identity, persistence across instances, shared flights and cancellation.

Real reader checks used the Loss-Free Balancing PDF: original prose, repaired title hyphenation, metadata exclusion, question-free UI, Audio menu placement, return to the saved guided-tour checkpoint, and a grounded two-part table explanation. Stored prose survived an API restart and a new browser load; cached endpoint responses were approximately 8–22 ms. The table explanation used the existing agent workflow, two PDF images and one model call. No new full paid guided tour was generated solely for this change.
