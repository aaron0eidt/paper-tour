import type { Step, Tour } from '../../../shared/paper';
import type { Direction } from './direct';

// The degrade ladder (notes/ROADMAP.md, wave 1): a tour never fails because of one visual. A step whose board, worked
// example or pen marks still fail after their corrections keeps its narration and its page cues and loses only what
// failed; a step with no usable narration takes the fallback beat. Every loss is recorded, never silent.

/** What a step lost so that the tour could still play. */
export type DroppedPart = 'board' | 'example' | 'marks';
export interface Degraded {
  dropped: DroppedPart[];
  /** Why, as the checks worded it for the repair turns. */
  problems: string[];
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
