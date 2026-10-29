import { TOUR_DRAFT_SCHEMA, resolveSpeechAnchors, validateDraft, materializeTour } from '../../muse/schema';
import { validateVisualDirection } from '../../muse/visual-direction';
import { draftFromState, requiredVisuals } from './context';
import { object, chapter } from './schema';
import { defineTool, wire } from './registry';
export const tourTools = [
  defineTool({
    wire: wire([
      'set_tour_plan',
      'Set the tour title and ordered chapters. Use real section order and unique chapter IDs.',
      object(
        {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          chapters: {
            type: 'array',
            minItems: 1,
            maxItems: 10,
            items: object({ id: { type: 'string', minLength: 1 }, title: { type: 'string', minLength: 1 } }, [
              'id',
              'title',
            ]),
          },
        },
        ['title', 'chapters'],
      ),
    ]),
    effect: 'write',
    stage: 'writing',
    async execute(_scope, next, args, _original) {
      if (new Set(args.chapters.map((c: any) => c.id)).size !== args.chapters.length)
        throw new Error('Chapter IDs must be unique.');
      if (Object.keys(next.chapters).some((id) => !args.chapters.some((c: any) => c.id === id)))
        throw new Error('The plan must retain already saved chapter IDs.');
      next.title = args.title;
      next.plan = args.chapters;
      return { state: next, output: { plan: next.plan } };
    },
  }),
  defineTool({
    wire: wire([
      'upsert_tour_chapter',
      'Save or replace one complete chapter of precise, chronological tour steps. Every prose step needs sentence highlights.',
      { ...object({ chapter }, ['chapter']), $defs: TOUR_DRAFT_SCHEMA.$defs },
    ]),
    effect: 'write',
    stage: 'writing',
    prepare: (raw) => {
      if (raw && typeof raw === 'object' && typeof (raw as { chapter?: unknown }).chapter === 'string') {
        try {
          return { ...raw, chapter: JSON.parse((raw as { chapter: string }).chapter) };
        } catch {
          throw new Error(
            'chapter must be a JSON object with id, title and steps; the supplied JSON string is malformed.',
          );
        }
      }
      return raw;
    },

    async execute(scope, next, args, _original) {
      if (!next.plan.some((c) => c.id === args.chapter.id)) throw new Error('Set the chapter in the tour plan first.');
      next.chapters[args.chapter.id] = args.chapter;
      const warnings: string[] = [];
      const timed = resolveSpeechAnchors(draftFromState(next), (id, phrase) => {
        warnings.push(
          `${id}: timing phrase ${JSON.stringify(phrase)} was not unique in narration; cue starts at the beginning of this step.`,
        );
      });
      const { draft } = validateDraft(timed, scope.doc, true);
      next.chapters[args.chapter.id] = draft.chapters.find((c) => c.id === args.chapter.id)!;
      validateVisualDirection(draftFromState(next), scope.doc, next.observations, true);
      return {
        state: next,
        output: {
          chapterId: args.chapter.id,
          savedSteps: args.chapter.steps.length,
          ...(warnings.length
            ? {
                timingAdjustments: warnings,
                nextAction:
                  'Saved successfully. Timing was already resolved automatically. Continue with the next missing chapter; do not resubmit this chapter for these adjustments.',
              }
            : {}),
        },
      };
    },
  }),
  defineTool({
    wire: wire([
      'finish_tour',
      'Validate and publish the entire tour. Returns concrete missing coverage or reference errors if incomplete.',
      object({}, []),
    ]),
    effect: 'write',
    stage: 'validating',
    async execute(scope, next, _args, _original) {
      const missing = requiredVisuals(scope.doc, scope.visuals).filter((source) => !next.observations[source.targetId]);
      if (missing.length)
        throw new Error('Missing visual observations for: ' + missing.map((v) => v.targetId).join(', '));
      const missingChapters = next.plan.filter((c) => !next.chapters[c.id]);
      if (missingChapters.length) throw new Error('Missing chapters: ' + missingChapters.map((c) => c.id).join(', '));
      validateVisualDirection(draftFromState(next), scope.doc, next.observations);
      const finished = materializeTour(draftFromState(next), scope.doc, scope.documentId, scope.language);
      return { state: next, output: { published: true }, finished };
    },
  }),
];
