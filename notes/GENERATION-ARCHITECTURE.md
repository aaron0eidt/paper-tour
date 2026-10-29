# Generation architecture consolidation

Queued guided tours and durable agent turns share one runtime entry point. The guided
generator is bound in `generation/generator.ts`; the obsolete one-shot Muse writer,
writer registry and `TOUR_WRITER` configuration have been removed.

Paper tools are grouped by source reads, visual inspection and tour editing. Each tool
owns its schema, execution, progress stage and concurrency classification. The durable
journal commits state and publishes agent tours atomically.

The agent's active writing rules now live in `agent/writing.ts`. Shared source context,
coverage planning, schema validation and visual direction remain active dependencies
under `muse/`; that directory is not an obsolete generation strategy.

## Activity UI

Use the AI SDK UI message stream with typed activity data parts. The private database
journal remains the source of replay, and closing a view never cancels its generation.
Keep raw requests and token diagnostics behind the details view.

Keep the existing reader and activity design, including its original icons and dock
checklist. The temporary compact redesign was reverted following user feedback. Only
the streaming transport and meaningful task labels change.

## Historical migration verification

Verified on 29 October 2026 before writer retirement (the counts below describe that revision):

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

## Writer retirement

The one-shot writer, coverage-repair merger and inspection-only prompts/tests were
removed. Its completed-inspection and batch-checkpoint lookups were also removed from
`TourWorker` and `TourGenerationInput`: guided generation never consumed them. Agent
visual observations, checkpoint recovery and image caching remain in the durable agent.
No saved tours, database records or historical activity events are deleted. Old
`TOUR_WRITER` environment entries no longer select a strategy; ordinary queued jobs
use the harness, while jobs persisted with the agent engine retain their engine.

The lecture fixture's scripted provider was updated to recognize the optional formula
suggestion wording. Its existing rendering assertions remain in place. Shared SDK call
recording keeps a direct multimodal/redaction test after the old writer tests are retired.

Retirement verification on 29 October 2026: production build and player tests passed;
276 server tests passed with seven database-only skips; Python ran 62 tests with one
existing skip. All 332 database integration tests passed with no failures or skips.
No live provider calls or browser smoke checks were repeated for this cleanup.
