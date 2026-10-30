import type { BBox, Doc, DocBlock, DocFigure, Region } from '../../../shared/paper';
import { isTableTarget } from '../../../shared/tableTargets';

export interface MeasuredTarget {
  id: string;
  target: string;
  kind: 'component' | 'panel' | 'text';
  label: string;
  region: Region;
}

export function measuredFrameText(targets: MeasuredTarget[]): string {
  if (!targets.length) return '';
  return [
    'MEASURED IMAGE TARGETS (local image geometry and OCR, not estimates):',
    ...targets.map(
      (t) =>
        `[${t.id}] ${t.kind}: ${JSON.stringify(t.label || 'unlabelled visible shape')}; bounds ${JSON.stringify(t.region)}`,
    ),
    'Choose these IDs for the corresponding printed components or enclosing panels. Their exact measured bounds are applied automatically: omit bounds/region, or use region whole. Prefer native detected text IDs when they already identify the same label. A text target encloses words; a component target encloses its module; a panel encloses a group. Use the measured enclosing panel for a group, never estimate its extent. Optional members lists up to four measured IDs to outline separate related components; do not draw one union through unrelated content. Keep labels empty when the image already names the component.',
  ].join('\n');
}

export function measuredCueTargets(target: string, members: unknown, measured: MeasuredTarget[]): MeasuredTarget[] {
  const ids = Array.isArray(members) && members.length ? members : [target];
  return ids.flatMap((id) => measured.find((t) => t.id === id) ?? []);
}

/** The faults of one cue and how many separate marks it draws; none for a cue that is not a pen or measured mark. */
function cueFaults(
  raw: unknown,
  index: number,
  imaged: string | undefined,
  measured: MeasuredTarget[],
): { problems: string[]; marks: number } {
  const none = { problems: [], marks: 0 };
  if (!raw || typeof raw !== 'object') return none;
  const diagram = measured.some((t) => t.kind === 'component' || t.kind === 'panel');
  const c = raw as Record<string, unknown>;
  const at = `Cue ${index + 1}`;
  const problems: string[] = [];
  const selected = measuredCueTargets(String(c.target), c.members, measured);
  // A measured target is meaningful for a box only. Check it before branching
  // on action: otherwise highlight is silently dropped as a non-sentence,
  // and spotlight loses its region during canonical conversion.
  const measuredRequest = selected.length || String(c.target).startsWith('measured:') || c.members !== undefined;
  if (!measuredRequest && !['arrow', 'circle', 'box'].includes(String(c.action))) return none;
  if (
    c.members !== undefined &&
    (!Array.isArray(c.members) || c.members.length > 4 || c.members.some((id) => !measured.some((t) => t.id === id)))
  )
    problems.push(`${at}: members must be at most four listed measured IDs.`);
  if (String(c.target).startsWith('measured:') && !selected.length)
    problems.push(`${at}: choose a measured ID from the supplied catalog.`);
  if (selected.length) {
    if (selected.some((t) => t.target !== imaged))
      problems.push(`${at}: measured targets must belong to the attached figure.`);
    if (c.action !== 'box')
      problems.push(`${at}: use box for a measured component or panel, preserving its exact boundary.`);
    if (c.bounds !== undefined && JSON.stringify(c.bounds) !== '[0,0,1,1]')
      problems.push(`${at}: a measured target already has exact bounds; omit bounds rather than replacing them.`);
    if (c.region !== undefined && c.region !== 'whole')
      problems.push(`${at}: measured targets use region whole; never crop them with a guessed region.`);
    return { problems, marks: selected.length };
  }
  if (c.bounds !== undefined && !exactBounds(c.bounds))
    problems.push(`${at}: bounds must be four finite ordered numbers within 0..1.`);
  const partial =
    (c.bounds !== undefined && JSON.stringify(c.bounds) !== '[0,0,1,1]') ||
    (c.region !== undefined && c.region !== 'whole');
  if (!imaged && (c.action !== 'box' || partial))
    problems.push(`${at}: fine geometry requires the actual attached figure crop.`);
  if (diagram && (c.action !== 'box' || partial))
    problems.push(
      `${at}: this diagram has measured geometry. Choose a listed component/panel ID or members; do not estimate bounds.`,
    );
  return { problems, marks: 1 };
}

/** Authoring errors request a correction; they never silently substitute a different mark. */
export function visualCueProblems(
  cues: unknown,
  imaged: string | undefined,
  measured: MeasuredTarget[] = [],
): string[] {
  if (!Array.isArray(cues)) return [];
  const faults = cues.map((raw, index) => cueFaults(raw, index, imaged, measured));
  const problems = faults.flatMap((fault) => fault.problems);
  if (faults.reduce((count, fault) => count + fault.marks, 0) > 4)
    problems.push('Use at most four separate visual marks in this step; split a larger explanation across steps.');
  return [...new Set(problems)];
}

/** The positions of the cues whose marks cannot be drawn as asked: a step that stays faulty publishes without them. */
export function faultyVisualCues(cues: unknown, imaged: string | undefined, measured: MeasuredTarget[] = []): number[] {
  if (!Array.isArray(cues)) return [];
  return cues.flatMap((raw, index) => (cueFaults(raw, index, imaged, measured).problems.length ? [index] : []));
}

/** Authoring-only geometry. Published tours continue to use their existing `region` tuple. */
export const BOUNDS_SCHEMA = {
  type: 'array',
  minItems: 4,
  maxItems: 4,
  items: { type: 'number', minimum: 0, maximum: 1 },
  description:
    'Exact [left,top,right,bottom] in the TARGET bounding box, top-left origin, 0..1. Tight visible component only. Omit for nonvisual cues.',
};

export function exactBounds(value: unknown): Region | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)
  )
    return;
  const [x0, y0, x1, y1] = value;
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : undefined;
}

const area = (b: BBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const within = (parent: BBox, child: BBox): Region => [
  (child[0] - parent[0]) / (parent[2] - parent[0]),
  (child[1] - parent[1]) / (parent[3] - parent[1]),
  (child[2] - parent[0]) / (parent[2] - parent[0]),
  (child[3] - parent[1]) / (parent[3] - parent[1]),
];

/** Only detected figure text wholly inside this crop; nearby prose/captions are not component targets. */
export function figureTextTargets(doc: Doc, figure: DocFigure): DocBlock[] {
  if (figure.kind !== 'figure' || !area(figure.bbox)) return [];
  return doc.blocks
    .filter(
      (b) =>
        b.type === 'figure_text' &&
        b.page === figure.page &&
        b.text.trim() &&
        area(b.bbox) > 0 &&
        exactBounds(within(figure.bbox, b.bbox)),
    )
    .slice(0, 64);
}

export function figureForTarget(doc: Doc, id: string): DocFigure | undefined {
  return doc.figures.find(
    (f) => f.id === id || f.panels.some((p) => p.id === id) || figureTextTargets(doc, f).some((b) => b.id === id),
  );
}

/** The model sees the whole figure crop. Every offered target states its location in that parent image. */
export function figureFrameText(doc: Doc, figure: DocFigure): string {
  const targets = [
    { id: figure.id, bbox: figure.bbox, label: 'whole image' },
    ...figure.panels.map((p) => ({ ...p, label: p.label ?? 'panel' })),
    ...figureTextTargets(doc, figure).map((b) => ({ ...b, label: b.text.replace(/\s+/g, ' ').trim().slice(0, 180) })),
  ];
  return [
    `IMAGE FRAME: the attached crop is [${figure.id}]. Origin top-left; x increases right, y down.`,
    'TARGET LOCATIONS in that image [left,top,right,bottom], normalized 0..1:',
    ...targets
      .filter((t) => exactBounds(within(figure.bbox, t.bbox)))
      .map(
        (t) =>
          `[${t.id}] ${JSON.stringify(t.label)}: ${JSON.stringify(within(figure.bbox, t.bbox).map((n) => Math.round(n * 10000) / 10000))}`,
      ),
    'Cue bounds are relative to the chosen TARGET, not the page or parent image. Prefer a listed panel or detected text ID for that exact printed component; text boxes enclose only the printed words, not an entire module. If a measured catalog follows, choose its exact IDs and do not estimate bounds. Only when no measured component exists may an unmistakable unlabelled visual feature use tight bounds on the image ID. Never infer position from a caption or replace a specific component with a whole-image overview.',
  ].join('\n');
}

export interface VisualMark {
  action: 'arrow' | 'circle' | 'box';
  region?: Region;
  label: string;
}

/** Preserve validated authored geometry; remove only labels that repeat printed text. */
export function groundedVisualMark(
  doc: Doc,
  target: string,
  action: VisualMark['action'],
  region: Region | undefined,
  label: string,
  imaged?: string,
): VisualMark {
  if (isTableTarget(doc, target)) return { action: 'box', label: '' };
  const figure = figureForTarget(doc, target);
  if (!figure || figure.id !== imaged) return { action, ...(region ? { region } : {}), label };
  const targetBox =
    figure.id === target
      ? figure.bbox
      : (figure.panels.find((p) => p.id === target)?.bbox ??
        figureTextTargets(doc, figure).find((b) => b.id === target)?.bbox);
  if (!targetBox) return { action, ...(region ? { region } : {}), label };
  const printed =
    doc.blocks.find((b) => b.id === target)?.text ?? figure.panels.find((p) => p.id === target)?.label ?? '';
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const redundant = !!label.trim() && !!printed && words(printed).includes(words(label));
  return { action, ...(region ? { region } : {}), label: redundant ? '' : label };
}
