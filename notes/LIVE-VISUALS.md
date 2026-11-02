# Live mathematical explanations

The renderer catalog now includes two agent-authored representations alongside the existing native boards:

- `program`: a JavaScript function that constructs SVG from host narration time, parameters, source data, theme and small math/drawing helpers. It can implement a paper-specific construction rather than selecting a fixed animation template.
- `plotly`: data-only figure JSON plus bounded function expressions. The host samples functions; the model should not enumerate hundreds of points. An isolated Python process independently checks the computed curve contract.

Tour directions, exercise visuals, question answers and the optional persistent PaperAgent use the same inspection/review/repair modules under `server/src/visuals`. Source IDs, source facts and narration remain inputs to review. A program is executed at five narration times, rendered to actual PNGs, and sent with original source context to an independent model review. Concrete defects feed a bounded repair loop. Plotly receives numerical/contract checks and source/narration review; its actual browser rendering is verified separately.

## Execution and rendering

QuickJS receives strings and numerical inputs, with no application objects or host callbacks. It has memory, stack and interrupt limits. Browser execution runs in a terminable worker; output is an inert SVG image. The SVG validator rejects external resources, scripts, events and unsupported tags/attributes, and bounds its canvas, aspect ratio and complexity. Native PNG rendering runs in a credential-free, killable subprocess with a fixed pixel budget.

The frontend explicitly imports the QuickJS WASM asset through Vite. Both development worker URLs and production hashed chunks must resolve the real WASM file; a successful TypeScript/build check alone did not catch the original HTML-response bug. Plotly is loaded only when a Plotly board is shown. Its toolbar retains local exploration/download controls and removes cloud-sharing controls.

Narration controls scene time. Pausing/seeking also pauses/seeks the construction; parameters can change while paused. A local slider draft is sent with the next question. The server loads the referenced saved visual and accepts only finite numerical parameter overrides within its saved bounds; code, expressions, source data and ranges come from the server copy.

## Persistence and extension points

Visuals belong to an owner, document and immutable analysis. Tour publication and its artifact references commit together. A question can fork a tour visual, revise a visual already in the same conversation, or fork a visual from another conversation. Previous revisions and saved tours remain intact. Conversation turns save their original question, source snapshot and final answer references.

`visuals/inspect.ts` is the execution/repair gate; `model-author.ts` supplies multimodal review and correction; `artifacts.ts` owns provenance and optimistic revision locking; `persistence.ts` attaches references transactionally. The persistent agent records source/narration/code-bound review hashes in its journal and refuses to publish a changed or unaudited chapter. Paid review occurs before SQL row locks.

## Verification on 30 October 2026

- Scripted end-to-end generation verifies that actual PNG frames reach the reviewer before a chapter/partial is published, broken code is repaired, and persistent failure cannot publish a substitute board.
- Sandbox, hostile canvas, deterministic frame, finite-difference gradient, cross-runtime function, artifact ownership/analysis, atomic rollback and conversation revision tests pass.
- A real Muse conversation about *Attention Is All You Need* authored a scaling/softmax program. Moving the scale from 2 to 4 changed the computed output from 8.808 to 7.311. A follow-up retained scale 4 and added the unscaled comparison as revision 2 of the same artifact.
- A subsequent real request produced an interactive Plotly function. Setting both raw scores to zero changed its SVG curve into the expected horizontal output 5. An earlier attempt was truncated; revisions now have a larger output budget at low reasoning effort, and function guidance delegates sampling to the host. Explicit retries retain the original source/visual snapshot even if a partial answer moved the camera.
- An initial brief, paper-order tour completed in 116 seconds with Muse Spark 1.2 Contributor: 9 steps, source pages 2, 3, 4, 4, 5, 6, 7, 8, 10, with saved artifact references. Content review found two reduced directions after provider/validation faults, including a planning objective spoken as narration. Concept summaries are now explicitly separate from learning objectives, with a regression covering the stand-in text. A subsequent Spark 1.3 run exposed an overly short planning deadline. Further inspection traced repeated formula-direction 5xx responses to an invalid empty action enum; the schema now supports targeted PDF formula boxes without emitting an empty enum. A fresh complete real tour after that correction remains unverified.

These are reproducible contract checks and a small live evaluation, not a universal guarantee of model-selected pedagogy. No paper-specific formulas, coordinates or animation templates were added to production generation.

## Content scope and completion

The follow-up branch `codex/adaptive-content-scope` removes artificial concept/visual quotas and elapsed-time-driven simplification. Teaching-map authoring continues across output-sized responses. Visual planning splits requests after provider output truncation, preserving the entire tour and every planned explanation. Initial understanding precedes narration. Neutral narration uses the length the concept needs; profile jobs cannot substitute summaries, silently strip selected visuals, or delete an intentional reuse of the same construction after repairs fail.

Validation keeps the complete semantic error set internally, so staged repairs of a large map count as progress. Every actual section is listed for the model, including headings without prose. The initial schema and repair instructions distinguish the paper's contribution, mechanisms and evidence; correcting a role reuses its existing concept ID.

The shapes tool now uses tagged term variants. Matrices require a name and dimensions; an applied function requires its label. A direct Muse Spark 1.3 probe accepted the contract and produced a valid row-wise normalization construction. The provider-schema regression permits this specific tagged union while retaining the other schema restrictions.

Provider requests and sandbox execution retain technical time/resource limits. pg-boss requires an absolute job lease (the configured maximum is 24 hours); heartbeats detect lost claims but do not renew this lease. Real database regressions check that a healthy job beyond the former 15-minute limit stays active and that cancellation fences its claim and prevents late publication.

## Verification on 1 November 2026

- Full database-backed server suite: 966 passed, 7 skipped, no failures or cancelled tests.
- Player tests and server/player builds passed. Script tests: 84 passed. Python: 123 run, 2 skipped.
- New regressions cover more than 30 planned concepts, complete evidence vocabularies, staged planning and repairs, missing visual decisions, large-map error accounting, natural narration length, preserved visual reuse, cancellation and invalid visual publication guards.
- The final real Muse Spark 1.3 Contributor standard-depth, paper-order run completed in 153.7 seconds: 13 planned concepts, 16 steps, 1,276 spoken words, two computed function plots and a measured BLEU comparison. Fallback beats, omitted details and degraded parts are all empty.
- The scaling plot compares sigmoid(x) with sigmoid(x/8) for an explicitly illustrative two-way case at dk=64. The positional plot compares frequencies and a shifted sine; the BLEU bars retain the source values. This verifies concrete relationships rather than text-only side panels.
- A preceding technically complete run used only highlights and was not accepted as sufficient visual quality. Planning guidance now compares source annotations with computed alternatives, without a visual quota. A redundant-example regression ensures an already computed native plot does not require additional manual frames.
- Final browser inspection found floating tables assigned to the preceding physical section. The generic assembly fix uses supporting prose and actual heading order while preserving source targets. The agent-created final test tour was deterministically regrouped with all 16 narration/action/artifact objects preserved exactly; core validators passed before and after. No new model content or paper-specific rule was inserted by this repair.
