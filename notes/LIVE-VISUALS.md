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

## Paused follow-up

Work is paused at the user's request. The follow-up branch `codex/adaptive-content-scope` checkpoints the removal of artificial concept/visual quotas and elapsed-time-driven simplification. It adds paginated teaching-map authoring and an output-truncation batching helper for visual planning; the visual helper is not yet connected to the generator. Initial understanding must precede narration. There is no finished end-to-end verification of this follow-up yet.

Remaining work: integrate and test visual-plan continuation; remove adaptive narration length caps and summary/visual degradation fallbacks; verify the queue heartbeat/cancellation regressions; rerun a real tour and inspect fallback beats, omitted details, left-out work and actual explanations before calling it complete. Provider requests and sandbox execution retain technical time/resource limits. The proposed pg-boss policy has its documented maximum 24-hour lease; heartbeats do not extend it.

The last full suite before this follow-up reported 920 server passes (7 skips), plus passing player, script and Python suites and both builds. That result does not validate the paused edits.
