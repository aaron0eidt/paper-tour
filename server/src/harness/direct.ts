import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc } from '../../../shared/paper';
import type { Beat } from './beats';

export const CUE_ACTIONS = ['highlight', 'box', 'spotlight', 'note'] as const;
export type CueAction = (typeof CUE_ACTIONS)[number];
export interface Cue {
  action: CueAction;
  target: string;
  label: string;
  anchor: string;
}
export interface Direction {
  plan: string;
  say: string;
  cues: Cue[];
}
/** What a beat may point at: sentences to highlight, and figures, panels or equations to box or spotlight. */
export interface BeatTargets {
  page: number;
  sentences: string[];
  visuals: string[];
}

/** Targets on the page the camera shows: a text beat's paragraphs, or a figure with its panels, or an equation. */
export function beatTargets(beat: Beat, doc: Doc): BeatTargets {
  if (beat.target) {
    const figure = doc.figures.find((f) => f.id === beat.target);
    const equation = doc.equations.find((e) => e.id === beat.target);
    const page = figure?.page ?? equation?.page ?? 1;
    return { page, sentences: [], visuals: figure ? [figure.id, ...figure.panels.map((p) => p.id)] : [beat.target] };
  }
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const first = sentences.get(beat.evidence[0]);
  const page = first?.page ?? 1;
  const blocks = new Set(beat.evidence.map((id) => sentences.get(id)).filter((s) => s?.page === page).map((s) => s!.block));
  const ids = doc.blocks.filter((b) => blocks.has(b.id)).flatMap((b) => b.sentences);
  return { page, sentences: ids.slice(0, 60), visuals: [] };
}

const actionsFor = (beat: Beat): CueAction[] => (beat.target ? ['box', 'spotlight', 'note'] : ['highlight', 'note']);

/** The beat's response schema; `strict` adds the enums the model must choose from (the code re-checks them anyway). */
export function directionSchema(beat: Beat, targets: BeatTargets, strict = true) {
  const actions = actionsFor(beat);
  const ids = strict ? [...targets.sentences, ...targets.visuals] : [];
  const words = beat.kind === 'takeaway' ? 90 : 70;
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plan', 'say', 'cues'],
    properties: {
      plan: { type: 'string', maxLength: 600 },
      say: { type: 'string', minLength: 20, maxLength: words * 9, description: `About 25-${words - 25} spoken words.` },
      cues: {
        type: 'array',
        maxItems: !strict || ids.length ? 4 : 0,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'target', 'label', 'anchor'],
          properties: {
            action: strict ? { type: 'string', enum: actions } : { type: 'string' },
            target: !strict ? { type: 'string' } : ids.length ? { type: 'string', enum: ids } : { type: 'string', maxLength: 0 },
            label: { type: 'string', maxLength: 80, description: 'Box label (at most 4 words) or note text; else empty.' },
            anchor: { type: 'string', minLength: 1, maxLength: 80, description: 'A 2-6 word phrase copied from say.' },
          },
        },
      },
    },
  };
}

/** The beat's task text: the point to make and the local evidence, quoted from the document. */
export function beatBrief(beat: Beat, doc: Doc, targets: BeatTargets): string {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) => ids.map((id) => sentences.get(id)).filter(Boolean).map((s) => `[${s!.id}] ${s!.text}`);
  const lines = [`STEP KIND: ${beat.kind}${beat.detail ? ' (a closer look at one important detail)' : ''}`, `POINT TO MAKE: ${beat.point}`];
  const figure = doc.figures.find((f) => f.id === beat.target);
  const equation = doc.equations.find((e) => e.id === beat.target);
  if (figure) {
    lines.push(`${figure.kind.toUpperCase()} ${figure.number} [${figure.id}], page ${figure.page}: ${figure.caption}`);
    if (figure.panels.length) lines.push(`PANELS: ${figure.panels.map((p) => `${p.id}${p.label ? ` (${p.label})` : ''}`).join(', ')}`);
    lines.push('CITED BY:', ...quote(figure.referenced_by.slice(0, 4)));
    lines.push('The image of this figure is attached. Describe only what is visible or stated.');
  } else if (equation) {
    const block = doc.blocks.findIndex((b) => b.id === equation.block);
    const around = doc.blocks.slice(Math.max(0, block - 1), block + 2).flatMap((b) => b.sentences);
    lines.push(`EQUATION (${equation.number}) [${equation.id}], page ${equation.page}: ${equation.text}`);
    lines.push('TEXT AROUND IT:', ...quote(around.slice(0, 6)));
    lines.push('Say in words what the formula computes and what each important symbol means.');
  } else {
    lines.push('EVIDENCE:', ...quote(beat.evidence));
    lines.push(`OTHER SENTENCES YOU MAY HIGHLIGHT: ${targets.sentences.filter((id) => !beat.evidence.includes(id)).join(', ') || 'none'}`);
  }
  if (beat.kind === 'takeaway')
    lines.push(
      'This is the last step. End by inviting the learner to ask a question, and mention one of these:',
      ...(beat.questions ?? []).map((q) => `- ${q}`),
    );
  return lines.join('\n');
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Keep a direction whose shape and narration are usable; drop just the cues with an action or target this beat may not use. */
export function cleanDirection(value: unknown, beat: Beat, targets: BeatTargets): Direction | null {
  if (!ajv.compile(directionSchema(beat, targets, false))(value)) return null;
  const d = value as unknown as Direction;
  const say = d.say.replace(/\s+/g, ' ').trim();
  const words = say.split(' ').length;
  if (words < 8 || words > (beat.kind === 'takeaway' ? 90 : 70)) return null;
  const actions = new Set<string>(actionsFor(beat)),
    sentences = new Set(targets.sentences),
    visuals = new Set(targets.visuals);
  const cues = d.cues.filter(
    (c) =>
      actions.has(c.action) &&
      (c.action === 'highlight'
        ? sentences.has(c.target)
        : c.action === 'note'
          ? c.label.trim().length > 0 && (sentences.has(c.target) || visuals.has(c.target))
          : visuals.has(c.target)),
  );
  return { plan: d.plan, say, cues };
}
