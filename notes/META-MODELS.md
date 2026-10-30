# Meta models beyond Muse Spark: spike results (2026-10-29)

A spike made real calls with the project key: 138 to SAM 3.1 (about $0.35) and 4 to Muse Wonder (about $0.29). It used
figures from the Attention, robotic-fish, Casimir and ant papers.

## SAM 3.1: region snapping is a go

When a learner drags a loose box around part of a figure, SAM returns the object they meant.
- 42 of 46 snaps were correct, over 23 parts with two sloppy drags each.
- Latency: median 1.2 s, p90 2.2 s.
- Block diagrams: confidence 0.92 to 0.96.
- Icons, photo parts, plot legends and markers also worked.

**Request:** `POST https://api.meta.ai/v1/responses` with `model: sam-3.1`.
- Send an `input_text` prompt and an `input_image` data URL.
- Set `metadata: {include_confidence: "true", mask_encoding: "one_bit"}`.
- Box prompt: `<0f>0<|box;x1=..;y1=..;x2=..;y2=..;w=W;h=H|>`. Coordinates are pixels; x2 and y2 are inclusive; w and h must
  equal the image size. A positive point can be appended as `<|point;x=..;y=..;w=W;h=H|>`.
- One call can carry up to 16 objects.

**Masks:**
- Decode them with npm `@meta-sam/parser` 0.1.0: `decodeMaskToRaster`, positioned at the mask record's bounds.
- Then keep the connected component under the drag centre.
- Trace its outer contour and simplify it at about 1.5 px. A polygon comes to about 150 bytes.

**Guards** (all good snaps passed them, the failures did not): reject when any of these holds, and keep the learner's
rectangle instead.
- Confidence is below 0.6.
- The mask overshoots the drag box by more than 0.15.
- The mask covers more than 0.9 of the drag box.

**Failure modes:**
- "Nothing found" is HTTP 200 with empty text.
- A drag over two stacked blocks returns their union.
- Translucent CAD internals are unreliable.

**Concept prompts** (find a part by name, with no box) depend on the kind of figure:
- **Data plots:** a go for markers, solid curves, legends and colorbars.
- **Schematics:** semantic names fail (0 of 15), while colour and shape phrases work ("orange box", 7 of 12).
- **Photo and CAD:** mostly a no-go.

So use the box snap for learner selections. For plots, use concept phrases that a cheap Spark call proposes.

## Muse Wonder: valid, but Spark is the better planner here

On the whole-tour visual plan, Wonder at the default effort ran out of tokens (73 s, truncated). With
`reasoning_effort` set, every call returned a valid plan:

| Setting | Time | Cost |
|---|---|---|
| Wonder, minimal | 19 s | $0.03 |
| Wonder, low | 15 s | $0.03 |
| Wonder, high | 28 s | $0.07 |
| Muse Spark 1.3, minimal | 5.5 s | $0.007 |

Spark was equally valid. Spark stays the default planner. Wonder fits only where its depth pays off, and always with a
reasoning effort and at least 4000 output tokens.
