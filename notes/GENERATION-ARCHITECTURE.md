# Generation architecture consolidation

Keep the SDK migration branch and all reader contracts. Consolidate orchestration and
extension points before deciding whether a generation strategy can be retired.

1. Give queued tours and durable agent turns one runtime entry point. Select writers
   through a registry, and share provider model validation and recorded structured calls.
2. Split paper tools by responsibility: source reads, visual inspection and tour editing.
   Each tool owns its description, schema, argument preparation, execution, stage and
   concurrency classification. A registry derives SDK definitions and validates dispatch.
3. Preserve the durable journal as the only writer of state and published tours. Keep tool
   names, schemas, results, error corrections and image-delivery checks compatible.
4. Exercise every strategy and SDK boundary in tests, then run real upload/generation,
   questions, voice and reader checks. Record concrete differences between the detailed
   walkthrough and guided harness before removing either strategy.

The older walkthrough still has page-coverage and visual-inspection behavior that differs
from the guided harness. Retaining it behind the common registry is intentional during
this audit. This work does not add paper-specific prompts.

## Activity UI

Use the AI SDK UI message stream with typed activity data parts. The private database
journal remains the source of replay, and closing a view never cancels its generation.
Keep raw requests and token diagnostics behind the details view.

Keep the existing reader and activity design, including its original icons and dock
checklist. The temporary compact redesign was reverted following user feedback. Only
the streaming transport and meaningful task labels change.

## Verification

Verified on 29 October 2026:

- One runtime now routes queued tours, durable turns and startup recovery. The writer
  registry preserves both `TOUR_WRITER=harness` and `TOUR_WRITER=muse`.
- Seven existing tool contracts are supplied by source-read, visual-inspection and
  tour-editing modules. Their schemas, argument preparation, corrective feedback,
  execution, phase and read/write classification live with the tool. The journal
  remains responsible for atomic persistence and publication.
- Both writers share recorded SDK calls. The actual planned explanation label is
  recorded per call, so simultaneous writing calls can be distinguished in Activity.
- Authenticated activity streams can use `format=ui`: the AI SDK writes and reads
  typed UI message data parts. Cursor replay still comes from the existing private
  journal. Tests verify Unicode, event reconciliation, ownership and redaction.
- `npm test`: all player checks passed; 288 server tests passed with seven
  database-only suites skipped; Python ingestion ran 62 tests with one existing skip.
- All 345 database integration tests and production builds pass. Both frontend
  and server production dependency audits report zero vulnerabilities.
- Real upload, extraction, guided generation, saved-tour publication and idempotent
  retry passed through the running worker. A selected-region question supplied both
  crop and full page and returned a grounded German answer. Synthetic speech was
  transcribed through the SDK adapter. Browser console checks reported no errors.
- A real durable agent test exercised pause/resume and published a ten-step tour.
  Its cumulative run includes earlier rejected test attempts; after the final
  contract reset, seven more turns completed in about 70 seconds. This is a single
  test observation, not a performance benchmark.
- The walkthrough strategy separately generated a six-step tour with two reviewed
  images in two model calls (96 seconds in this test).

## Defects found by real-provider testing

The canonical chapter/action schema exceeded Muse's ten-level provider-schema limit.
This affected the durable chapter tool and the older structured tour writer. Encoding
an entire chapter as a JSON string also proved unnecessarily brittle in a real agent
repair. The final adapter keeps chapter and step fields structured and projects only
polymorphic visual actions at the provider boundary. The complete authoring contract
is included as documentation. The canonical argument, source, geometry, chronology and
publication validators remain unchanged and still reject invalid actions. The same
adapter serves both generation paths; no hidden transport retry bypasses these checks.

## Retirement assessment

Do not delete the older writer during this change. It remains a supported setting and
has full-page visual inspection/coverage semantics, while the guided harness selects
central ideas and adapts to different document types. The durable agent can also cover
the full document, but retiring a setting needs a deliberate migration and broader
parity checks on longer papers and image-heavy documents. The shared `muse` schema,
source and provider modules are active dependencies of the other paths, not obsolete
files merely because they share that directory name.

Next retirement work can remove the old writer registry entry, its implementation and
its strategy-only tests once its users/settings and coverage requirements are migrated.
