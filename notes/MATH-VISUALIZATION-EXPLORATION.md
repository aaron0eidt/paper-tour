# Mathematical visualization exploration

Branch: `codex/math-visualization-exploration`.
Baseline: `c157a12`, preserved on `codex/vercel-ai-sdk-migration`.
Status: isolated working prototype; no production renderer or agent tool replaced.

## Question

Can we give the reading agent a general live mathematical canvas in the spirit of
3Blue1Brown: changing functions, moving vectors, transforming coordinate planes,
working with matrices and explaining computation paths? A graph renderer alone
would not answer this question. The desired outcome is mathematical intuition,
not more motion or an additional list of boxes.

## Research and candidate choice

| Candidate                                                | Useful capability                                                                                       | Assessment for this experiment                                                                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Mafs](https://mafs.dev/guides/get-started/installation) | React components for plots, vectors, coordinate transforms, draggable points and composable math scenes | Implemented and browser-tested beside our existing renderer. Most promising first adapter for 2D mathematical exploration.                                         |
| [Motion](https://motion.dev/docs/react-svg-animation)    | SVG path drawing, morphing, transitions and React animation                                             | Included only for presentation transitions in this prototype. It does not supply mathematical semantics or replace our playback clock.                             |
| [Motion Canvas](https://motioncanvas.io/docs/)           | Programmed vector animations designed to synchronize with voice-overs                                   | Researched, not executed here. Worth a separate cinematic-scene spike, but its TypeScript generator/project workflow needs a deliberate authoring/runtime adapter. |
| [JSXGraph](https://jsxgraph.org/docs/)                   | Interactive geometry, implicit curves, vector fields and mathematical constructions                     | Researched, not installed. A broader option if these constructions become necessary; no evidence yet that we need a second math engine.                            |
| [MathBox](https://github.com/unconed/mathbox)            | Presentation-quality WebGL mathematical graphing                                                        | Researched, not installed. A possible later adapter for substantial 3D needs.                                                                                      |
| [ELK](https://github.com/kieler/elkjs)                   | Automatic layout of semantic graph nodes and edges                                                      | Implemented as the graph-layout helper, not the general mathematical canvas.                                                                                       |

These assessments are engineering judgments for this codebase. They are not a
universal ranking or a claim that all candidates received equal implementation
or performance testing.

## Runnable comparison

```sh
npm --prefix player ci
npm --prefix player run dev:math-lab
# http://localhost:5175/math-lab.html
npm --prefix player run test:math-lab
npm --prefix player run build:math-lab
```

The original app continues on port 5174 in its original checkout. The lab uses a
separate HTML entry and build configuration; the normal production entry does not
import the experiment. The new packages are development dependencies. Mafs's
nested KaTeX is explicitly aligned to our existing 0.19.0 version; the resulting
player dependency audit is clean.

Both renderers receive the same semantic lesson values and normalized time:

- A parameterized sigmoid with the original curve retained as a reference. Both
  show the same fixed sample and calculated output while the response changes.
- A linear map with basis vectors, input and result. Mafs additionally transforms
  a real coordinate grid. Dragging the input updates both views and the matrix
  multiplication displayed below them.
- A nine-node, twelve-edge computation graph, with topology laid out by ELK.
  Forward/reverse emphasis follows graph dependencies, not screen positions. This
  demonstrates traversal paths, not computed derivatives or a complete autodiff
  engine.

The fixtures are illustrative test data, including one network resembling the
user's example. They are not paper-specific production logic. The current lab
contract covers three lesson families; it is not yet the final freely composable
agent scene language.

## Findings from implementation

Visual acceptance remains open. The first prototype was judged less attractive
than the existing presentation; additional renderer capabilities do not establish
a visual improvement. A subsequent lab-only pass frames the actual mathematical
quantities more tightly, reduces grid/tick density, separates vector labels and
uses lighter strokes. Bounds are derived from the transformation's endpoints,
including negative/rotated cases, rather than fitted to one paper. Both lab
renderers receive those same bounds, so camera framing does not favor a library.
The original
reader and renderer remain unchanged; this is not a decision to replace them.

1. **A richer math renderer helps.** Mafs makes a transformed grid and draggable
   mathematical input straightforward. The same transformation changes geometry
   and numbers together, rather than replacing one static card with another.
2. **Representation remains a separate problem.** A library cannot recover nodes
   the model collapsed into layer labels. The agent should describe equations,
   variables, relationships and transformations; adapters should own layout and
   drawing.
3. **The current contract is restrictive.** The native scene renderer can draw
   this graph when directly previewed, but the unchanged production validator
   flags intersections at diagonal arrow/circle bounds. The lab explicitly shows
   this limitation. It does not disable that validator in the production pipeline
   or mark meaningful objects as background to bypass it.
4. **Library conventions need explicit adapters.** Mafs's affine matrix storage is
   row-major 2×3, not SVG's six-value ordering. The prototype's conversion is
   checked against Mafs's real vector transform, so its grid and vector calculation
   use the same matrix. A visually plausible skew is not sufficient verification.
5. **Timing should stay outside the renderer.** One controllable state drives both
   views. Pause/seek and repeated source updates must not leave a library-owned
   animation running. The lab uses its own manual demonstration clock; integration
   with real TTS and spoken anchors is still future work.
6. **Layout has a cost.** The isolated comparison entry is about 616 kB minified /
   196 kB gzip including both renderers, React, KaTeX and presentation controls.
   ELK is a separate lazy chunk, about 1.48 MB / 449 kB gzip. These are whole-build
   observations, not isolated library costs or runtime benchmarks. ELK currently
   executes through its bundled async adapter; a production integration should
   place layout work in a worker and cache it by topology and panel dimensions.

## Recommended next architecture

Use a composable **mathematical scene document** between the agent and rendering
libraries. It needs stable object identities, named parameters, equations,
coordinate systems, vector/matrix operations, functions, graph relationships and
source references. Objects may be combined in one explanation instead of forcing
an exclusive choice between one formula, one flow or one plot.

Keep creation, updates and inspection as shared services for tours, exercise
solutions and follow-up questions. Separate each renderer's schema, semantic
validation, layout, rendering and focusable parts. Mafs can implement 2D math;
KaTeX handles formula typography; ELK helps graph layout; source annotations stay
attached to the PDF. Motion or another animation adapter can interpolate authored
states while the existing narration clock remains authoritative. Optional future
3D or cinematic renderers should fit the same boundary.

Give the model expressive composition and revision tools, rather than a finite
set of paper templates. Keep numerical/source validation and rendered checks.
Do not equate arbitrary executable model-generated code with flexibility: that
would also bypass the shared timing, validation and update contracts.

## Verification and limits

- Dedicated math-lab checks pass: matrix interpolation and Mafs affine conversion,
  numerical parity, monotonic response sensitivity, graph identity/connectivity,
  reverse traversal, layout bounds and the observed native validation limitation.
- Existing player regression tests, original reader production build and isolated
  lab production build pass.
- Browser checks cover all three cases, dragging the input, forward/reverse paths,
  pause, seeking and console errors. Screenshots are saved locally for comparison.
- This is a renderer feasibility experiment. It does not yet evaluate whether a
  real agent consistently authors useful scenes, production audio synchronization,
  dense long-form derivations, general 3D scenes or a full replacement of the
  existing tour/Q&A contracts.
