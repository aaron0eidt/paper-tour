# Visuals and narration, second version (2026-10-29)

Aaron tried the 10-29 tour and found it too simple: the drawings "don't really help understanding what the paper is
trying to show" and are "sometimes really unnecessary"; boards are "always simple flow diagrams or scores of
numbers"; and the narration "can't just repeat what is highlighted but a diluted down version. Only the most
important parts, directly explained."

A real run on *Attention Is All You Need* confirms it: 21 steps, 15 bar charts (three of the same English-German
scores, three of the same attention-weight example, toy bars such as "pos1 10, pos2 0"), one plot, and no visual for
positional encoding. The model only has bars, flows, formulas, plots and free-form scenes, decides one step at a time
with no view of the whole tour, and is told to paraphrase "close to the authors' terminology".

## Principles

1. **Only the most important parts.** The default length goes back to `standard` (10-12 steps). Depth comes from
   questions.
2. **Direct explanation, never a diluted copy.** The highlight already shows the sentence. The voice says what the text
   does not: why it matters, how it works, the intuition, the consequence. The first sentence states the point.
   Checked in code: narration that mostly restates the sentences it highlights is sent back once for a rewrite.
3. **Each picture shows what the paper is trying to show**: the mechanism, the relationship or the trade-off at its
   core, with the paper's own symbols and numbers or clearly labelled illustrative values. Never decorative, never a
   redraw of the figure on screen, never the same data twice. No board is better than a weak one.
4. **The model chooses, the code draws and checks.** New kinds take semantic data; code lays them out, animates them
   and checks grounding and arithmetic.
5. **Generic, never tuned.** Every rule and example must fit any paper. Judge changes on several documents.

## New board kinds

All three follow the existing registry pattern (`server/src/harness/board.ts`): a provider schema, a check with
actionable problems, focus IDs and parts. Shared types and checks live in `shared/` so the server and the player use
the same rules. The player renders them with the board's palette, easing, pause and reduced-motion behaviour.

### heatmap: a grid of values with labelled rows and columns

For any matrix-shaped idea: which items attend to or depend on which (attention, alignment), masks, similarity or
correlation, confusion matrices, a grid of ablation results, values of a formula over two indices (such as a
positional encoding over positions and dimensions).

```ts
interface HeatmapItem {
  kind: 'heatmap';
  title?: string;                    // at most 60 characters
  rows: string[];                    // 2-10 labels, at most 16 characters each (queries, settings, positions)
  cols: string[];                    // 2-10 labels
  values: number[][];                // rows x cols, finite; the server fills them from `expression` when given
  expression?: string;               // safe expression (shared/plot.ts grammar): x is the column number, a the row
                                     // number, both from 1; the server evaluates it into `values`
  source: 'document' | 'illustrative' | 'formula';
  scale?: 'sequential' | 'diverging';  // diverging centres on zero for signed values
  normalize?: 'rows';                // values are raw scores; the board shows how a row-wise softmax turns them
                                     // into weights that sum to one
  mask?: 'upper';                    // square only: cells above the diagonal are masked (a position sees only earlier
                                     // ones)
  view?: 'grid' | 'links';           // links: the column labels as a top row of tokens, the row labels as a bottom
                                     // row, curves from the focused row to every column weighted by its value
  unit?: string;
}
```

- Checks: shapes match; labels are short and distinct; `source: 'document'` values are printed in the evidence (as
  bars); `formula` needs a valid expression, and the server computes every value; `normalize` needs at least one row
  with different values; `mask` needs a square grid; `links` needs at most 8 columns.
- Focus parts: `row-1` to `row-10` (a row lights up; in `links` its curves draw in).
- Player: cells fade in row by row; with `normalize` the colours and printed values morph from raw scores to softmax
  weights after the grid appears; masked cells are hatched; the illustrative or formula source shows as a small tag.

### scatter: points on two measured axes

For trade-offs and relationships between two quantities: quality against cost or size, accuracy against speed,
precision against recall, a parameter sweep, any two columns of a results table.

```ts
interface ScatterItem {
  kind: 'scatter';
  title?: string;
  x_label: string;                   // plain words with the unit, at most 40 characters
  y_label: string;
  x_log?: boolean;
  y_log?: boolean;
  better?: 'up-left' | 'up-right' | 'down-left' | 'down-right';  // the corner where results are better
  points: { label: string; x: number; y: number; series?: string }[];  // 2-10 points
  source: 'document' | 'illustrative';
}
```

- Checks: labels short and distinct; `document` coordinates are printed in the evidence; log axes need positive
  values; at most 3 series.
- Focus parts: `point-1` to `point-10`.
- Player: axes with readable ticks (decades on log axes), points arrive one by one, labels placed clear of each other,
  the better corner shaded with a small "better" mark, points of a series joined in order, the focused point and label
  enlarged.

### shapes: matrix shapes through an operation

For linear algebra in any field: how the dimensions of matrices and vectors combine (Q times K transposed makes an n
by n grid), what an operation keeps or removes, where a dimension disappears.

```ts
interface ShapesItem {
  kind: 'shapes';
  title?: string;
  terms: ShapesTerm[];               // 3-9 terms: matrix, operator, matrix, ..., ending with a matrix
}
type ShapesTerm =
  | { kind: 'matrix'; name: string; rows: string; cols: string }  // name in LaTeX; dimensions as symbols ("n",
                                                                    // "d_k") or numbers; a vector has cols "1"
  | { kind: 'op'; op: 'times' | 'plus' | 'hadamard' | 'equals' | 'apply'; label?: string };  // apply: a function such
                                                                    // as softmax, named in label
```

- Checks in code: `times` needs the inner dimensions to match (`cols` of the left equals `rows` of the right);
  `plus` and `hadamard` need equal shapes; after `equals` the result has the computed shape; `apply` keeps the shape;
  names render in KaTeX.
- Focus parts: `term-1` to `term-9` (matrices).
- Player: matrices as blocks sized by their dimensions (the same symbol always has the same length; numbers scale with
  limits), names inside, dimension labels on the edges, built left to right; for `times` the shared inner dimension is
  coloured on both operands and fades out of the result.

## The tour's visual plan

A new stage (`server/src/harness/visual-plan.ts`) runs once after the beats are planned and before they are directed.
One call sees the whole document card and every beat and decides, per beat, the visual and the idea it makes visible:

```json
{ "beats": [{ "beat": "b3", "visual": "heatmap", "idea": "Each word's row shows which words it draws from...",
              "data": "illustrative weights for a 6-word sentence; rows sum to one" }] }
```

- `visual` is a board kind or `none`. Rules: about half the steps get a board; a figure step usually teaches on the
  figure itself; never the same data twice. **Diversity comes first** (Aaron: "diversity is number one, pick different
  visualisation methods, everything needs to be versatile and cool"): each kind once, a second time only when the
  document clearly needs it, and at least four different kinds when a tour has five or more visuals. Prefer the
  kind that shows the paper's point (heatmap for relations and weights, scatter for trade-offs, shapes for matrix
  operations, plot for how a formula behaves, formula for an equation's parts, bars for one key comparison, flow only
  for a real dependency structure the page does not draw).
- Code checks the plan (known beats and kinds, the variety rules) and falls back to today's behaviour if the call fails
  or the plan is invalid.
- Each direction call gets its line ("VISUAL FOR THIS STEP: heatmap: ...") and only that board in its schema; a step
  planned without a board gets no board fields. A worked example is no longer forced on a step whose plan names
  another visual.

## Checks across the tour

- A board that repeats an earlier board's data (the same numbers, formula, points or labels) is dropped with its focus
  cues; the narration stays.
- The paraphrase check (in `insight.ts`): when most of a step's content words come from the sentences it highlights,
  the step is repaired once with "explain the why, not the sentence".

## Out of scope for now

Questions (`ask-*.ts`) keep today's kinds; the new kinds go into answers once tours use them well. Niko's graph module
proposal (VISUALIZATION-ARCHITECTURE.md, ELK layout) is separate work.
