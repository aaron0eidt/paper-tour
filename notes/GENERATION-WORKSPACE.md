# Durable tour workspace

The harness reuses the private `agent_events` journal instead of adding a second state store. `workspace.saved` contains a content-addressed artifact; `workspace.reused` records reuse without inventing a model request or charging its original tokens again. The partial playable tour remains separate from these internal drafts.

The workspace belongs to one generation. An explicit retry of that generation can resume it. A new generation starts fresh. Source, analysis, model, profile, prompt version, messages (including image content), schema, effort and output budget participate in provider-response keys. Changing these inputs invalidates reuse. Keys contain hashes, not image payloads or credentials. Normal generation ownership and deletion rules apply.

Artifacts have different meanings:

- A provider response is saved as a **draft**, not proof of valid teaching content. Its normal validators still run when reused.
- A direction draft retains its narration, visual payload, latest validation problems and repair revision. Visual repairs accept only visual/example fields and cues; saved narration and the teaching point are merged back unchanged. Feedback is rebuilt from source context plus the latest draft, rather than appending every failed answer.
- An `inspect` direction has passed direction checks and awaits asynchronous rendered review. Rendering can resume independently of writing the explanation.
- A `ready` direction has completed rendered inspection and can be assembled without rewriting or rerendering it. Intermediate authored-visual repairs are also saved before inspection.

The selected visual is required by the adaptive direction schema. Where a worked example is supported, the schema requires either the visual or the example. This does not relax arithmetic, grounding, narration or rendering checks. Repeated visual repair revisions ask for a changed construction instead of repeating the same answer.

Cancellation and existing workflow error boundaries remain active. This change does not create an unlimited background retry loop. Existing Vercel guided-agent runs retain their own durable state; this workspace closes the equivalent gap in the harness path shown by `beat_direction` activity.

Runs created before workspace checkpoints existed cannot recover validated artifacts retroactively. Once the updated workflow runs, completed provider responses and directions survive worker restarts and explicit retry of the same generation. They are internal work, never published as a finished tour until validation completes.
