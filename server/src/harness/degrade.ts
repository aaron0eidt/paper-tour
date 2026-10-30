import type { LeftOut, LossCause, Step, Tour } from '../../../shared/paper';
import type { Direction } from './direct';

// The degrade ladder (notes/ROADMAP.md, wave 1): a tour never fails because of one visual. A step whose board, worked
// example or pen marks still fail after their corrections keeps its narration and its page cues and loses only what
// failed; a step with no usable narration takes the fallback beat. A step whose model calls were too slow is asked for
// less (generator.ts) before it loses anything. Every loss is recorded with its cause, never silent.

/** What a step lost so that the tour could still play. */
export type DroppedPart = 'board' | 'example' | 'marks';
export interface Degraded {
  dropped: DroppedPart[];
  /** Why, as the checks worded it for the repair turns. */
  problems: string[];
  /** The cause of each dropped part that the learner is told of: it failed its checks, or the model took too long. A record without it was a failed check. */
  causes?: Partial<Record<DroppedPart, LossCause>>;
}
/** Why a step has no narration of its own, and for a step that went whole, the part it could not do without. */
export interface Omission {
  code: LossCause;
  because?: 'example';
}

/** At most this many problems are recorded per step, which is enough to see why. */
const MAX_PROBLEMS = 8;

/**
 * The direction as far as it can be published. Its board and example are already absent when they failed their checks
 * and its faulty pen marks were left out (cleanDirection), so only the problems are cleared here and recorded: the
 * board, example or marks it lost, and why. A direction without faults comes back as it is.
 */
export function degradeDirection(direction: Direction): { direction: Direction; degraded?: Degraded } {
  const board = direction.boardProblems ?? [];
  const example = direction.exampleProblems ?? [];
  const marks = direction.visualProblems ?? [];
  const dropped: DroppedPart[] = [];
  const problems: string[] = [];
  // A valid worked example crowds out a second board; a failed one is gone, and so is a board that failed.
  const lostBoard = !direction.board && (board.length > 0 || (example.length > 0 && !!direction.example));
  if (lostBoard) {
    dropped.push('board');
    problems.push(...board, ...(direction.example ? example : []));
  }
  if (example.length && !direction.example) {
    dropped.push('example');
    problems.push(...example);
  }
  if (marks.length) {
    dropped.push('marks');
    problems.push(...marks);
  }
  if (!example.length && !marks.length && !lostBoard) return { direction };
  return {
    direction: { ...direction, exampleProblems: [], visualProblems: [] },
    degraded: { dropped, problems: [...new Set(problems)].slice(0, MAX_PROBLEMS) },
  };
}

/** What one planned step came to, as the record of what the tour left out needs it. */
export interface StepOutcome {
  beat: string;
  /** The step has steps of its own in the tour. */
  present: boolean;
  /** The step took the fallback beat, or an exercise part was not solved. */
  fallback: boolean;
  omission?: Omission;
  degraded?: Degraded;
  /** Boards the tour's last checks took out with their cues, and boards that repeated an earlier step's data. */
  late?: boolean;
  repeated?: boolean;
}

/** The most the tour records (schema/tour.schema.json); pen marks, which the learner is not told of, go first. */
const MAX_LEFT_OUT = 60;

/**
 * What the tour left out of its plan, in tour order: steps that are not there (a detail without narration, or a step
 * whose fallback only read the document aloud), steps explained by the card's words alone, and the worked examples,
 * boards and pen marks the others lost, each with its cause (coverage.ts). A part is recorded once, with the first cause
 * found.
 */
export function leftOutOf(steps: StepOutcome[]): LeftOut[] {
  const out: LeftOut[] = [];
  for (const step of steps) {
    const add = (part: LeftOut['part'], cause: LossCause, because?: 'example') => {
      if (!out.some((item) => item.step === step.beat && item.part === part))
        out.push({ step: step.beat, part, cause, ...(because ? { because } : {}) });
    };
    if (!step.present) add('step', step.omission?.code ?? 'invalid', step.omission?.because);
    else if (step.fallback) add('narration', step.omission?.code ?? 'invalid');
    // A dropped part with no cause beside the others was not one the plan called for.
    const { dropped = [], causes } = step.degraded ?? {};
    for (const part of dropped) if (!causes || part in causes) add(part, causes?.[part] ?? 'checks');
    if (step.late) add('board', 'checks');
    if (step.repeated) add('board', 'repeats');
  }
  return (out.length > MAX_LEFT_OUT ? out.filter((item) => item.part !== 'marks') : out).slice(0, MAX_LEFT_OUT);
}

/** The steps with a board that a list of tour problems names, by step ID or by path into the tour, with their problems. */
export function boardStepsOf(tour: Tour, problems: string[]): Map<string, string[]> {
  const steps = tour.chapters.map((chapter) => chapter.steps);
  const named = new Map<string, string[]>();
  for (const problem of problems) {
    const path = /^\/chapters\/(\d+)\/steps\/(\d+)\b/.exec(problem);
    const step: Step | undefined = path
      ? steps[Number(path[1])]?.[Number(path[2])]
      : steps.flat().find((s) => problem.startsWith(`${s.id}: `));
    if (step?.actions.some((action) => action.type === 'board'))
      named.set(step.id, [...(named.get(step.id) ?? []), problem]);
  }
  return named;
}

/** The tour with the board actions of the given steps taken out; their narration and page cues stay. */
export function withoutBoards(tour: Tour, ids: ReadonlySet<string>): Tour {
  return {
    ...tour,
    chapters: tour.chapters.map((chapter) => ({
      ...chapter,
      steps: chapter.steps.map((step) =>
        ids.has(step.id)
          ? { ...step, actions: step.actions.filter((a) => a.type !== 'board' && a.type !== 'board_focus') }
          : step,
      ),
    })),
  };
}
