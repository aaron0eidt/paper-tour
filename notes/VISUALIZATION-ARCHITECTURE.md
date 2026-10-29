# Live teaching visuals: architecture decision

Status: researched proposal, 2026-10-29. The plot-selection, source-cue and
readable-streaming corrections below are implemented. The graph module and new
library adapters described here are not yet implemented.

## Observed problem

The supplied backpropagation example shows an individual computation graph on the
PDF, but the answer reduces it to five layer boxes. The current flow authoring
contract permits only 3–7 nodes, short labels and at most 12 edges. Its renderer
can branch; the defect is not that it always renders a chain. Its small contract
and the model's representation choice encourage grouping, losing the actual
variables and paths. Simply increasing the cap would not add edge labels,
source-bound semantic identities or explicit backward traversal.

Native scenes already provide shapes, vectors, matrices and plots with stable
object IDs. They can reconstruct graphs, but require the model to place each node
and connection geometrically. Graph topology should be semantic data; a layout
engine should place it. Exercise solution authoring also remains formula-specific;
upgrading Q&A alone would leave that generation path restricted.

## Recommended composition

Keep the Vercel AI SDK for model/tool execution and UI streaming. Keep a validated,
declarative visual document between the model and React. Extend that document via
separate renderer modules; do not make the model generate executable JSX or code.

1. Add a graph module with semantic nodes, labelled directed edges, optional groups,
   values, source references and stable IDs. The model specifies relationships,
   not pixel coordinates. Distinct variables must remain distinct unless the
   learner explicitly requests a coarse overview.
2. Use **elkjs** behind a layout adapter for layered placement, ports, spacing and
   edge routing. Load it lazily in a worker. Render the resulting geometry with
   our SVG/KaTeX components to preserve the chosen design and narration controls.
   Cache layout by graph topology, labels, sizing and panel dimensions. Value or
   emphasis updates should not arbitrarily rearrange the graph.
3. Keep the existing safe function evaluator and plot renderer initially. It
   already supports curves and parameter sweeps. Consider a **Mafs** adapter when
   draggable mathematical exploration, coordinate transforms or richer math
   components justify it. **JSXGraph** is a broader alternative for geometry,
   implicit curves, differential equations and mathematical constructions; do not
   install both libraries without a demonstrated need.
4. Keep source annotations, graphs, plots, formulas and matrices on the same
   playback clock. Every visual transition must be seekable, pausable and tied to
   the relevant spoken anchor. A library's independent animation loop must not
   keep running after narration pauses. Forward data flow and reverse gradient
   flow are traversal events over the same graph, not separate disconnected
   drawings.
5. Give creation and revision a shared service boundary: create visual, update
   existing visual by ID, inspect validation/render feedback. Tour generation,
   exercise solutions and follow-up questions call the same service. A follow-up
   can add weights or change an input without replacing the whole illustration.

Each renderer module should own its schema, validation, layout adapter, rendering,
focusable parts and inspection output. Extend the existing board registry rather
than adding another parallel authoring pipeline. Graph validation checks identity,
edge endpoints, topology, source provenance and typed traversal events. Rendering
checks label bounds and collisions, followed by a bounded visual-review repair
when needed. Visual inspection complements source/math validation; it does not
establish that a plausible picture has the correct mathematical dependencies.

For the supplied exercise, a correct teaching sequence preserves both inputs,
both pairs of hidden activations, prediction, target and loss; shows their actual
connections; then follows the relevant backward paths while discussing the chain
rule. This is an acceptance example, not a paper-specific rendering template.

## Why not use React Flow as the entire teaching renderer?

React Flow supports custom nodes, edges and animated paths, and is a strong option
if users need to drag, connect or edit graph nodes. It still delegates automatic
layout to libraries such as Dagre or ELK. Our immediate requirement is synchronized
explanation in a PDF reader, with an established SVG renderer and playback clock.
ELK plus that renderer is the smaller integration. Introduce a React Flow adapter
later if graph editing becomes a real product feature. Manim video output remains
outside this design, following the user's preference for live animations.

## Corrections implemented now

- One visual-selection policy is shared by the guided writer, Q&A, walkthrough
  guidance and durable agent. Function behavior favors a meaningful live plot;
  graph explanations preserve nodes and topology. Boards are suggestions, not
  mandatory representations. Source-first guidance no longer prohibits a useful
  side visual.
- A complete safe parameter-sweep example documents plot authoring. It is a generic
  tool example, not a network/paper-specific template.
- Explicit source highlights are no longer suppressed by earlier steps or silently
  capped at two. Source and board cues share an eight-cue authoring allowance,
  keeping their spoken anchors and in-step deduplication.
- SDK `partialOutputStream` supplies only public `say` snapshots to the activity
  feed while structured output is in progress. Raw JSON remains in technical
  activity. Planning fields are not displayed. Final output still needs validation.

Verification: 291 server tests pass with 7 database-only skips; player tests pass.
A real Muse call on Attention scaling independently selected a live plot, retained
three source highlights, and emitted three narration snapshots before completion
(31.4 seconds for this single call, not a performance benchmark). This does not
prove graph reconstruction or every future visual is correct.

## Primary references

- [ELK JavaScript and worker support](https://github.com/kieler/elkjs)
- [ELK layered layout phases and routing](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)
- [React Flow layout comparison](https://reactflow.dev/learn/layouting/layouting)
- [React Flow animated edges](https://reactflow.dev/examples/edges/animating-edges)
- [Mafs interactive math components](https://mafs.dev/)
- [JSXGraph API and supported constructions](https://jsxgraph.org/docs/)
- [AI SDK partial structured output](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK typed UI data streaming](https://ai-sdk.dev/docs/ai-sdk-ui/streaming-data)
