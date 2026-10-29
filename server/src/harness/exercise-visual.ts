import type { BoardItem, Doc } from '../../../shared/paper';
import { findAnchor } from './assemble';
import { boardPart, boardPartIds, boardSchema, checkBoard, type BoardKind } from './board';
import { TONE } from './doctype';
import { leaksResult, type Solution, type Unit } from './exercise';
import { BOARD_TASK } from './prompts';
import { visualLine, type StepVisual } from './visual-plan';
import { groundedCheck } from './visual-rules';

// The side-board visual of an exercise part (notes/VISUALS-V2.md): the sheet's visual plan gives a task at most one,
// chosen for the method it teaches (a grid of natural frequencies, a matrix and its shape, a point in the plane, the graph
// of a function). One call draws it after the part is solved, so that it fits the solution; the solution lines stay
// formula boards. The learner has tried the task by the time the board appears (it comes with the method, after the
// checkpoint), and code keeps the result off it: a board that shows the answer is sent back once, then dropped.

/** A method visual: its board, and where the narration of the method lights up its parts. */
export interface UnitVisual {
  item: BoardItem;
  /** A board part (the index boardPart gives) and the phrase of the method's narration that names it, in word order. */
  focus: { part: number; anchor: string }[];
}
/** The most parts the narration lights up. */
export const UNIT_FOCUS_MAX = 3;

/**
 * Whether a part has a step to show its visual: the method step, or in the compact form (the method joins the first
 * solution line) the first solution line, which follows the checkpoint. A part with no method narration has none.
 */
export const hasVisualHost = (unit: Unit, solution: Solution) =>
  Boolean(solution.method.say) && (!unit.compact || Boolean(solution.coach));

/** The task text and the maths of a part as the learner reads them: the numbers its givens print. */
function givenText(unit: Unit, doc: Doc): string {
  const text = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  return [
    ...unit.sentences.map((id) => text.get(id) ?? ''),
    ...unit.maths.map((id) => blocks.get(id)?.text ?? ''),
  ].join(' ');
}

/**
 * What a board's numbers may come from: the task's givens, the narration of the method, the solution lines that lead up
 * to the answer and the numbers the plan named. Never the answer line itself.
 */
export function visualEvidence(unit: Unit, doc: Doc, solution: Solution, visual: StepVisual): string {
  return [givenText(unit, doc), solution.method.say, ...solution.steps.map((step) => step.latex), visual.data].join(
    '\n',
  );
}

/** The response schema of the visual call: the planned board, and up to three parts for the narration to light up. */
export function unitVisualSchema(kind: BoardKind) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plan', kind, 'focus'],
    properties: {
      plan: {
        type: 'string',
        maxLength: 600,
        description:
          'Name what the picture shows that the algebra does not, then check that no label, value or title states the result.',
      },
      [kind]: {
        ...boardSchema(kind),
        description: `The ${kind} board of the method, set up from the givens of the task. Never the result.`,
      },
      focus: {
        type: 'array',
        maxItems: UNIT_FOCUS_MAX,
        description: 'Parts of the board that light up while the narration names them; empty when none fits.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'anchor'],
          properties: {
            target: { type: 'string', enum: boardPartIds(kind) },
            anchor: {
              type: 'string',
              minLength: 1,
              maxLength: 80,
              description:
                'A 2-6 word phrase copied exactly from the narration of the method, where it names this part.',
            },
          },
        },
      },
    },
  };
}

/** The visual call's task: the part, its planned visual, the narration it accompanies and the answer to keep off it. */
export function unitVisualTask(
  language: string,
  brief: string,
  visual: StepVisual & { visual: BoardKind },
  solution: Solution,
): string {
  const lines = solution.steps.map((step) => `  ${step.latex}`);
  const rules = [
    `Draw the setting and the method with the task's own givens, in the task's words and symbols: what the method looks at, not
   what it finds. Fill "plan" first.`,
    `Never show the result. The learner has tried the task but the answer comes in the solution lines after this step, so no
   label, value, title or cell of your board may state it. The givens, the set-up and the structure are what to show.`,
    `Numbers: copy the givens as printed. Anything made up is labelled illustrative in the title. Every value of a board of
   bars, a heatmap or a scatter must be printed in the task, the narration or the solution lines above.`,
    `"focus" lights up up to ${UNIT_FOCUS_MAX} parts of the board while the narration of the method names them: each has a
   board part and an anchor of 2-6 words copied exactly from that narration. Leave it empty when no part is named there.`,
  ];
  return [
    `TASK: draw ONE side-board visual for the method of an exercise, in ${JSON.stringify(language)}. ${TONE.exercise_sheet}`,
    brief,
    visualLine(visual),
    `THE METHOD AS IT IS NARRATED (the board appears while this is spoken): ${solution.method.say}`,
    `THE SOLUTION LINES (the board shows them right after this step, one by one):\n${lines.join('\n')}`,
    `THE ANSWER, which your board must not show: ${solution.answer.latex}`,
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    BOARD_TASK[visual.visual],
  ].join('\n');
}

/** What the board prints, as one text: every label, title and value, for the check that it keeps the answer off it. */
const boardText = (item: BoardItem) => JSON.stringify(item);

/**
 * The visual from the model's answer, or null with the problems for one repair turn: the planned board has to pass its
 * checks and the rules of a tour step, must not show the answer, and each focus cue needs a part of the board and its
 * anchor in the narration.
 */
export function cleanUnitVisual(
  value: unknown,
  kind: BoardKind,
  unit: Unit,
  doc: Doc,
  solution: Solution,
  visual: StepVisual,
): { visual: UnitVisual | null; problems: string[] } {
  const given = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  if (given[kind] === undefined || given[kind] === null)
    return { visual: null, problems: [`draw the planned ${kind} board in "${kind}"`] };
  const check = groundedCheck(checkBoard(kind, given[kind], visualEvidence(unit, doc, solution, visual)), false);
  const problems = check.problems.map((problem) => `${kind}: ${problem}`);
  if (!check.item)
    return { visual: null, problems: problems.length ? problems : [`draw the planned ${kind} board in "${kind}"`] };
  if (leaksResult(boardText(check.item), solution.answer.latex, givenText(unit, doc)))
    return {
      visual: null,
      problems: [
        `the board shows the result of the exercise (${solution.answer.latex}) in a label, a title or a value: show the givens and the structure of the method only`,
      ],
    };
  const said = solution.method.say;
  const parts = new Set<number>();
  const words = new Set<number>();
  const focus = (Array.isArray(given.focus) ? given.focus : [])
    .flatMap((cue: unknown) => {
      const { target, anchor } = (cue ?? {}) as { target?: unknown; anchor?: unknown };
      const part = typeof target === 'string' ? boardPart(check.item!, target) : -1;
      const word = typeof anchor === 'string' ? findAnchor(said, anchor) : null;
      return part < 0 || word === null ? [] : [{ part, anchor: String(anchor), word }];
    })
    .sort((a, b) => a.word - b.word)
    .filter((cue) => {
      const fresh = !parts.has(cue.part) && !words.has(cue.word);
      parts.add(cue.part);
      words.add(cue.word);
      return fresh;
    })
    .slice(0, UNIT_FOCUS_MAX)
    .map(({ part, anchor }) => ({ part, anchor }));
  return { visual: { item: check.item, focus }, problems: [] };
}
