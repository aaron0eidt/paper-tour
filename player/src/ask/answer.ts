// An answer as a tour the reader plays with a second engine, and what the learner is looking at when they ask. Pure,
// so test/ask.test.ts checks it without a browser.

import { DEFAULT_SPEAKER } from '../types';
import { responseLanguage } from '../../../shared/languages';
import type { CameraAction, Tour } from '../types';
import type { TargetKind } from '../resolve';
import type { AskAnswer } from './api';

/**
 * The answer as a tour of its own: one chapter of its steps, spoken by the tour's speaker with the tour's voices, so
 * the narrator sounds the same. The reader still prepares it like the tour (prepareTour), so an ID the PDF lacks is
 * dropped instead of drawn.
 */
export function answerTour(answer: AskAnswer, question: string, tour: Tour | null, speaker = DEFAULT_SPEAKER): Tour {
  const seen = new Set<string>();
  const steps = answer.steps.map((step, i) => {
    const id = seen.has(step.id) ? `${step.id}-${i + 1}` : step.id;
    seen.add(id);
    return { ...step, id, ...(speaker !== DEFAULT_SPEAKER ? { speaker } : {}) };
  });
  return {
    schema: 'paper-tour/tour@0.1',
    title: question,
    paper: tour?.paper ?? 'answer',
    ...(tour?.voices ? { voices: tour.voices } : {}),
    ...(responseLanguage(answer.language) ? { voices: { ...tour?.voices, [speaker]: { ...tour?.voices?.[speaker], lang: answer.language } } } : {}),
    chapters: [{ id: 'answer', title: question, steps }],
  };
}

const VISUALS: readonly (TargetKind | null)[] = ['figure', 'panel', 'equation'];

/** The figure, panel or equation a camera action shows, so a question about "this" can be about it. */
export function visualShown(
  action: CameraAction | null | undefined,
  kind: (id: string) => TargetKind | null,
): string | undefined {
  return action && VISUALS.includes(kind(action.target)) ? action.target : undefined;
}

const normal = (question: string) => question.replace(/\s+/g, ' ').trim().toLowerCase();

/** Questions to offer: the given ones that are not empty, not repeated and not asked already, at most `limit`. */
export function openQuestions(questions: readonly string[] | undefined, asked: readonly string[], limit = 3): string[] {
  const taken = new Set(asked.map(normal));
  const out: string[] = [];
  for (const question of questions ?? []) {
    const key = normal(question);
    if (!key || taken.has(key)) continue;
    taken.add(key);
    out.push(question.trim());
  }
  return out.slice(0, limit);
}

/** What the panel says while an answer is on its way: honest stages, so a long wait does not look stuck. */
export function waitingLabel(ms: number): string {
  if (ms < 4_000) return 'Thinking';
  if (ms < 14_000) return 'Reading the document';
  if (ms < 35_000) return 'Writing the answer';
  return 'Still working on it';
}
