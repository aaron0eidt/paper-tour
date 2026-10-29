import { SOURCE_VISUAL_POLICY } from './visual-policy';
import type { Action, Doc, Region } from '../../../shared/paper';
import { TourValidationError, type TourDraft } from './schema';

export interface VisualComponent {
  label: string;
  region: Region;
  explanation?: string;
}
export interface VisualObservation {
  readable?: boolean;
  components?: VisualComponent[];
}

export const VISUAL_DIRECTION_GUIDANCE = `VISUAL DETAIL AND SPEECH TIMING
${SOURCE_VISUAL_POLICY}
Treat a meaningful figure as a guided explanation, not one caption and one outline. First orient the reader, then explain its important components, connections, computations and takeaway in separate small steps. Multi-part diagrams normally need 2–4 or more steps. Explain what each part does and why its relationship matters. Equations deserve a similar term-by-term explanation in natural speech.
Inspect at the level of INDIVIDUAL OPERATIONS. Two large rectangles for the left and right halves of a complex architecture are only an overview, never a complete decomposition. Record and explain its readable named blocks, internal arrows, branching/merging points, repeated computation and output transform. Complex diagrams commonly need 6–12 component regions and 4–8 teaching steps, with 2–4 successive annotations per step. Simple three-box diagrams need only their actual parts. For plots, separate axes, curves, distinctive trends and comparisons; for tables, meaningful column/row groups and the entries supporting the finding. Do not invent subdivisions in a single-part image. Spend the step budget on mechanisms instead of many generic prose paraphrases.
When inspecting a figure/table, record its meaningful components as labels and normalized regions. Use components: [] only for an image with no useful internal subdivisions. Coordinates [x0,y0,x1,y1] are relative to the CURRENT TARGET's bounding box, with origin top left and values 0–1. A page image and a cropped figure have different coordinate frames. view_visuals supplies the exact frame and existing panel IDs. Prefer a real panel ID when it fits; otherwise use the recorded component region on the figure ID. Never guess regions from a caption alone.
A component label must mark that component, not the whole diagram. For example, when describing one side of a two-part diagram, box only that side. Whole-figure outlines are allowed for an unlabelled overview. Use several precise boxes, spotlights and brief anchored notes to explain mechanisms; avoid decorative motion or giant notes. Reuse the component regions you actually inspected.
Synchronize every change with the spoken explanation. at_word is a ZERO-BASED index into the FINAL say text split on whitespace. Keep the initial camera move at 0; show the next highlight, box, spotlight or note when the corresponding concept is mentioned, including in the middle of a sentence. Do not fire all annotations at 0. For example, in 'First inspect the input, then follow the connection.', 'input,' is word 3 and 'connection.' is word 7. Derive indices from your own narration, never from the PDF text.
PREFER at_phrase for annotations: copy a unique short phrase from your final say text, e.g. at_phrase: "input" and at_phrase: "connection". The server computes the exact at_word; do not guess a number when you can name the spoken phrase. If a term repeats, copy a longer unique phrase. Use a real descriptive label on each component box, a spotlight to isolate a dense subdiagram, and short anchored notes for key invariants or mathematical meanings. Clear temporary overlays before the next unrelated concept. A list of module names with one box around an entire stack is insufficient: teach how the signal flows through each module, and move/mark exactly that module while explaining it.
If a sentence compares two parts, use separate actions at their respective spoken words. Persist related boxes while comparing them; clear them before an unrelated topic. Important multi-part figures need distinct component regions and delayed annotations across multiple steps. In prose, highlight each supporting sentence when its claim is introduced; use a separate timed action for a later clause, and occasional underline or anchored notes where they clarify a term.`;

const area = ([x0, y0, x1, y1]: Region) => (x1 - x0) * (y1 - y0);
function within(parent: Region, child: Region): Region {
  const [x, y, x1, y1] = parent,
    w = x1 - x,
    h = y1 - y;
  return [(child[0] - x) / w, (child[1] - y) / h, (child[2] - x) / w, (child[3] - y) / h];
}
export function visualFrame(doc: Doc, id: string) {
  const figure = doc.figures.find((f) => f.id === id);
  const page = doc.pages.find((p) => `page${p.n}` === id);
  return {
    normalizedTo: id,
    origin: 'top-left',
    bounds: figure?.bbox ?? (page ? [0, 0, page.width, page.height] : undefined),
    panels: figure?.panels.map((panel) => ({ id: panel.id, region: within(figure.bbox, panel.bbox) })) ?? [],
  };
}
export function checkComponents(components: VisualComponent[] | undefined) {
  if (components && (components.length > 24 || components.some((c) => !c.label.trim())))
    throw new Error('Use at most 24 components with nonempty labels.');
  if (components?.some((c) => c.region[0] >= c.region[2] || c.region[1] >= c.region[3] || area(c.region) > 0.95))
    throw new Error('Component regions must have positive area and identify a specific part, not the whole image.');
}

/** A correction to one part must not silently erase the other inspected parts. */
export function updateVisualComponents(
  previous: VisualComponent[] | undefined,
  incoming: VisualComponent[] | undefined,
  replace = false,
): VisualComponent[] | undefined {
  if (replace && incoming === undefined) throw new Error('Provide components when replacing the component list.');
  if (incoming === undefined) return previous;
  const byLabel = new Map(
    [...(replace ? [] : (previous ?? [])), ...incoming].map((component) => [
      component.label.trim().toLowerCase(),
      component,
    ]),
  );
  const components = [...byLabel.values()];
  checkComponents(components);
  return components;
}

function overlaps(a: Region, b: Region) {
  const intersection =
    Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return intersection / (area(a) + area(b) - intersection) >= 0.4;
}
/** Additional quality gates for new agent drafts; historical/manual tours remain valid. */
export function validateVisualDirection(
  draft: TourDraft,
  doc: Doc,
  observations: Record<string, unknown>,
  partial = false,
) {
  const problems: string[] = [];
  const steps = draft.chapters.flatMap((c) => c.steps);
  const textIds = new Set([
    ...doc.sentences.map((s) => s.id),
    ...doc.blocks.map((b) => b.id),
    ...doc.sections.map((s) => s.id),
  ]);
  const visualIds = new Set([
    ...doc.figures.flatMap((f) => [f.id, ...f.panels.map((p) => p.id)]),
    ...doc.equations.map((e) => e.id),
  ]);
  for (const step of steps) {
    const navigation = step.actions.find((a) => a.type === 'focus' || a.type === 'zoom');
    if (navigation && 'target' in navigation && textIds.has(step.source) && visualIds.has(navigation.target))
      problems.push(
        `${step.id}: use the visual ID as source when the camera explains a figure/panel/equation; cite the supporting prose in evidence. This preserves the image coordinate frame.`,
      );
  }
  for (const step of steps)
    for (const action of step.actions) {
      if (
        action.type === 'box' &&
        action.label &&
        doc.figures.some((f) => f.id === action.target) &&
        (!action.region || area(action.region) > 0.9)
      )
        problems.push(
          `${step.id}: labelled component '${action.label}' needs its own region or a panel ID; outlining the entire figure mislabels it.`,
        );
    }
  if (!partial)
    for (const figure of doc.figures) {
      const observation = observations[figure.id] as VisualObservation | undefined;
      if (observation?.readable === false) continue;
      if (!observation?.components) {
        problems.push(
          `${figure.id}: record inspected component regions, or components: [] only when the image has no meaningful internal parts.`,
        );
        continue;
      }
      if (observation.components.length < 2) {
        if (figure.panels.length > 1)
          problems.push(
            `${figure.id}: its ${figure.panels.length} known panels need separate component regions and explanations.`,
          );
        continue;
      }
      const regionOf = (action: Action): Region | undefined => {
        const target = 'target' in action ? action.target : 'anchor' in action ? action.anchor : undefined;
        if (target === figure.id) return 'region' in action ? action.region : undefined;
        const panel = figure.panels.find((p) => p.id === target);
        if (!panel) return;
        const base = within(figure.bbox, panel.bbox);
        if (!('region' in action) || !action.region) return base;
        const [x, y, x1, y1] = base,
          w = x1 - x,
          h = y1 - y,
          r = action.region;
        return [x + r[0] * w, y + r[1] * h, x + r[2] * w, y + r[3] * h];
      };
      const directed = steps.filter((step) =>
        step.actions.some((action) => regionOf(action) || ('target' in action && action.target === figure.id)),
      );
      const marks = directed
        .flatMap((step) => step.actions)
        .filter((action) => ['box', 'spotlight'].includes(action.type))
        .map((action) => ({ action, region: regionOf(action) }))
        .filter((entry): entry is { action: Action; region: Region } => !!entry.region);
      const minimum = Math.min(4, observation.components.length);
      if (directed.length < minimum)
        problems.push(
          `${figure.id}: explain its parts in at least ${minimum} small steps, currently ${directed.length}.`,
        );
      const missing = observation.components.filter(
        (component) => !marks.some((mark) => overlaps(mark.region, component.region)),
      );
      if (missing.length)
        problems.push(
          `${figure.id}: separately mark and explain components: ${missing.map((c) => c.label).join(', ')}.`,
        );
      if (!marks.some((mark) => (mark.action.at_word ?? 0) > 0))
        problems.push(
          `${figure.id}: synchronize component annotations with spoken words using nonzero at_word; all marks currently appear at the start.`,
        );
    }
  if (problems.length) throw new TourValidationError(problems.slice(0, 12));
}
