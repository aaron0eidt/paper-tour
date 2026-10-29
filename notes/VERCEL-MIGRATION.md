# Vercel AI SDK migration

Branch: `codex/vercel-ai-sdk-migration`, based on merged `main`.

## Current cleanup

The earlier one-shot writer has now been retired, along with `TOUR_WRITER`, its strategy
registry, coverage-repair code and unused worker inspection-cache queries. Guided jobs
use the harness; persistent-agent jobs keep their durable engine. Active agent writing
rules moved to `agent/writing.ts`, retaining their prompt version and content. Shared
provider, source and canonical validation modules remain in use. Existing tours and
stored records are preserved. The verification record below describes the migration
before this cleanup; see `GENERATION-ARCHITECTURE.md` for retirement details.

## Product contract

Preserve the PDF reader, tour ordering and playback, narration/audio controls, live native plots/scenes, floating question dock, language choice, voice questions, selected-region questions, library/settings, activity details and pause/resume/cancel. SDK integration sits below these features. Persisted tours remain compatible. A model-transport change must not weaken source grounding, numerical verification or geometry checks.

## Implementation plan

1. Pin the current AI SDK and compatible provider packages. Prove Muse structured output, image input, streaming, tool calls, reasoning options and token accounting through a provider adapter. Centralize credential-safe error handling and disable hidden retries where the application already owns recovery.
2. Move all structured model calls (harness, legacy writer, Q&A and repair) to AI SDK generation/streaming. Keep existing domain interfaces as adapters so the application and frontend contracts remain stable.
3. Integrate the SDK's agent/tool contracts into the durable agent path. Preserve database checkpoints, idempotent tool results, serialized writes, cancellation and recovery. Provider-specific count/retrieve operations remain explicit transport capabilities rather than being mistaken for portable SDK model generation.
4. Use the SDK's typed tool schemas, structured output, lifecycle/usage hooks, cancellation and development observability. Bridge streaming into the existing activity UI; preserve frontend interactions. Adopt additional SDK UI/runtime features only where they solve a concrete product need.
5. Test scripted provider/error/stream cases and existing app contracts; run production builds and the full suite. Then run real Muse structured, image, tool and streaming checks plus a real tour/Q&A and browser smoke checks. Fix failures rather than silently reverting to the old model transport.
6. Document verified compatibility and remaining provider/runtime boundaries; commit signed changes, push the migration branch and open a reviewable PR against `main`.

## Architecture decisions to verify

- AI SDK owns provider normalization, generation/stream parsing and agent/tool interfaces. Application validators retain scientific correctness and canonical tour publication.
- Keep the working Postgres/pg-boss durability layer during this migration. `WorkflowAgent` requires its own runtime; adding a second job/checkpoint system solely to use another SDK API would duplicate responsibility. Reconsider it only with an explicit durability migration and deployment tests.
- Keep the product UI and saved event contracts; model deltas and SDK lifecycle events adapt into them. DevTools are development-only and opt-in; secrets and raw image bytes must not enter persisted activity logs.
- Voice input remains a required feature. If Meta's nonstandard ASR endpoint needs a custom SDK transcription provider, implement that adapter rather than removing transcription.

## Verification record

Verified on 29 October 2026 with `ai@7.0.156`, `@ai-sdk/openai@4.0.104` and
`@ai-sdk/openai-compatible@3.0.80`:

- `npm test`: player regressions passed; 281 server tests passed with seven database-only
  suites skipped; Python ingestion ran 62 tests with one existing skip.
- `npm run test:integration`: 338 tests passed, zero failures or skips. This includes durable
  tool writes, ownership, pause/resume/cancel, context rollover, local history replay,
  missing-provider-history recovery and uncertain dispatch without duplicate inference.
- `npm run build`: server type checking and production player build passed. Production
  dependency audit reported zero vulnerabilities.
- Real Muse structured output and streaming passed; inline Figure 2 was correctly described
  through an SDK tool call. A second stored-response step consumed its tool result; exactly
  two requests were dispatched. The wire retained requested reasoning effort, source image
  bytes and provider response IDs; adapter tests also verify the configured cache key.
- A fresh deep tour for *Attention Is All You Need* completed in 156.7 seconds: 21 steps,
  16 visual inputs and 23 model calls. One rejected direction draft was repaired; the final
  tour and board validators reported zero problems. This is one observed run, not a latency
  benchmark or a guarantee about future model-generated tours.
- Browser checks covered the new tour's navigation, native animated bars/formulas, source
  annotation, camera refit, pause and resume controls. An actual German question with a
  selected PDF region returned two grounded steps; server diagnostics confirmed both the
  crop and full page were supplied. Existing reader, audio, selection, library and question
  UI contracts are preserved; no frontend package or saved-tour schema was replaced.
- SDK transcription of a synthetic spoken question returned the correct question. No
  physical microphone recording was needed. Voice cancellation and WAV validation tests pass.
- An actual DevTools trace retained usage metadata without the probe's private prompt,
  generated answer or credential markers. DevTools is opt-in, development-only and dynamically
  imported. Its current integration receives full events despite recording flags, so an
  explicit metadata allowlist protects the local trace store. Docker sets `NODE_ENV=production`.

## Provider and runtime boundaries

Muse currently rejects `tool_choice=none`, `required` and named tool choice. The SDK's
`activeTools: []` gives source initialization no tools without sending an unsupported option.
Application authorization and schema/geometry/numerical validation still run at the journal
boundary; SDK tool definitions never execute durable writes themselves.

The SDK is configured with zero automatic generation retries. Only explicit missing-history
rejections are retried by the existing recovery path. A completed JSON response to a streaming
request is parsed through SDK generation using that same buffered response, never a second
provider dispatch. Failed/incomplete provider envelopes remain visibly failed/incomplete.

`ToolLoopAgent` runs one step per durable job. Postgres/pg-boss owns resumption and exactly-once
application writes; SDK stream resumption or `WorkflowAgent` would require a separate runtime
migration. Meta's count/retrieve and nonstandard ASR remain narrow provider adapters. Browser
speech synthesis and live React/SVG/KaTeX visualizations remain in place. This change does not
move hosting, authentication or storage to Vercel, and it does not enable the optional persistent
agent globally or merge the migration branch.

References: [AI SDK agents](https://ai-sdk.dev/docs/agents/overview),
[tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling),
[structured output](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data),
[DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools).
