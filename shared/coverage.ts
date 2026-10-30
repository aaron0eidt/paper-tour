// What a tour left out of its plan and why, in plain words. The writer records it (server/src/harness/generator.ts), the
// activity checklist and the reader's cards say it, so that every surface names the same cause. Pure, no dependencies.

/**
 * Why a planned step, or a part of one, is not in the tour: the model took too long, what it wrote failed the checks, its
 * answer could not be used, it would only repeat earlier content, or the model could not be reached.
 */
export type LossCause = 'slow' | 'checks' | 'invalid' | 'repeats' | 'unavailable';
export const LOSS_CAUSES: readonly LossCause[] = ['slow', 'checks', 'invalid', 'repeats', 'unavailable'];

/**
 * What is missing: the whole step; the step's own explanation, which a summary from the document card replaces; its
 * worked example; its side board; or pen marks on the page.
 */
export type LostPart = 'step' | 'narration' | 'example' | 'board' | 'marks';

/** One loss: a step of the plan, what went, why, and for a step that went whole, the part it could not do without. */
export interface LeftOut {
  step: string;
  part: LostPart;
  cause: LossCause;
  /** The step went whole because this part could not be written and the step was nothing without it. */
  because?: 'example';
}

/** The phrase that follows its subject: "its visual did not pass the checks". Plural subjects take the same verbs. */
const REASON: Record<LossCause, string> = {
  slow: 'took too long to write',
  checks: 'did not pass the checks',
  invalid: 'came back unusable',
  repeats: 'would have repeated earlier content',
  unavailable: 'could not be written because the model was not available',
};

/** What the lost part is called, and what became of it. */
const PART: Record<LostPart, { subject: string; result: string }> = {
  step: { subject: 'this step', result: 'so it was left out' },
  narration: { subject: 'its explanation', result: 'so a short summary stands in' },
  example: { subject: 'its worked example', result: 'so it was left out' },
  board: { subject: 'its visual', result: 'so it was left out' },
  marks: { subject: 'some pen marks', result: 'so they were left out' },
};

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Each part of a step once, with the first cause found for it. */
const unique = (items: readonly LeftOut[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.step} ${item.part}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
};

/** One loss as a sentence: "Its worked example took too long to write, so the step was left out." */
export function lossSentence({ part, cause, because }: LeftOut): string {
  const { subject, result } = PART[part];
  const first = because === 'example' ? 'its worked example' : subject;
  return `${sentence(first)} ${REASON[cause]}, ${because === 'example' ? 'so the step was left out' : result}.`;
}

/** The losses of one step for its row in a checklist, each as a sentence. */
export const lossDetail = (items: readonly LeftOut[]): string => unique(items).map(lossSentence).join(' ');

/** The noun phrase of a group of the same part, as the reader counts it. */
const COUNTED: Record<Exclude<LostPart, 'marks' | 'board'>, [one: string, many: string]> = {
  step: ['planned step left out', 'planned steps left out'],
  narration: ['step explained only briefly', 'steps explained only briefly'],
  example: ['worked example left out', 'worked examples left out'],
};

/**
 * What a learner is told when a tour is not all of its plan, briefly: what was left out and why, for example
 * "1 planned step left out: its worked example took too long to write". Pen marks and side visuals are not counted: the
 * step and what it says stay, and the activity checklist names them. Null when nothing the learner would miss was lost.
 */
export function coverageNote(lost: readonly LeftOut[]): string | null {
  const groups: string[] = [];
  for (const part of ['step', 'narration', 'example'] as const) {
    const items = unique(lost).filter((item) => item.part === part);
    if (!items.length) continue;
    const [one, many] = COUNTED[part];
    const kinds = new Map<string, number>();
    for (const { cause } of items) kinds.set(cause, (kinds.get(cause) ?? 0) + 1);
    const why =
      kinds.size > 1
        ? [...kinds].map(([cause, n]) => `${n} ${REASON[cause as LossCause]}`).join(', ')
        : items.length === 1
          ? `${items[0].because === 'example' ? 'its worked example' : 'it'} ${REASON[items[0].cause]}`
          : `they ${REASON[items[0].cause]}`;
    groups.push(`${items.length} ${items.length === 1 ? one : many}: ${why}`);
  }
  return groups.length ? groups.join('; ') : null;
}

const known = (value: unknown): value is LossCause => LOSS_CAUSES.includes(value as LossCause);

/**
 * The losses a generation's events record, for a reader that has no tour: a step omitted or fallen back, the parts a step
 * dropped, and boards that repeated an earlier step's: the facts the tour's own list (`left_out`) is built from. A retry
 * starts a new run, and only the latest one describes the tour, as in the activity.
 */
export function lossesFromEvents(events: readonly { type: string; data: Record<string, unknown> }[]): LeftOut[] {
  const out: LeftOut[] = [];
  const run = events.map((event) => event.type).lastIndexOf('run.started');
  for (const { type, data } of events.slice(Math.max(run, 0))) {
    const step = typeof data.beat === 'string' ? data.beat : '';
    if (type === 'board.duplicate' && Array.isArray(data.dropped)) {
      for (const drop of data.dropped as { step?: unknown; beat?: unknown }[]) {
        const owner = typeof drop?.beat === 'string' ? drop.beat : drop?.step;
        if (typeof owner === 'string') out.push({ step: owner, part: 'board', cause: 'repeats' });
      }
    } else if (!step) continue;
    else if (type === 'beat.omitted' && known(data.code))
      out.push({ step, part: 'step', cause: data.code, ...(data.because === 'example' ? { because: 'example' } : {}) });
    else if (type === 'beat.fallback' && known(data.code)) out.push({ step, part: 'narration', cause: data.code });
    else if (type === 'beat.degraded' && Array.isArray(data.dropped) && data.causes && typeof data.causes === 'object')
      for (const part of data.dropped as LostPart[]) {
        const cause = (data.causes as Record<string, unknown>)[part];
        if (known(cause)) out.push({ step, part, cause });
      }
  }
  return unique(out);
}
