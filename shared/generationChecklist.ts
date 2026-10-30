import type { GenerationEvent } from './activity';
import { lossDetail, lossesFromEvents } from './coverage';
import { uniqueGenerationEvents } from './generationDiagnostics';

export type ChecklistState = 'pending' | 'active' | 'done' | 'failed' | 'unknown';
export interface ChecklistRow {
  id: string;
  label: string;
  state: ChecklistState;
  detail?: string;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined);
const kinds: Record<string, string> = {
  problem: 'The problem',
  idea: 'The central idea',
  method: 'How it works',
  figure: 'Explain the figure',
  formula: 'Unpack the equation',
  result: 'Results',
  limitation: 'Limitations',
  takeaway: 'Takeaway',
  overview: 'Overview',
  point: 'Explain this point',
  exercise: 'Work through the exercise',
};

/** Keep the dock's subscription small: no model prompts, text deltas, schemas or raw outputs. */
export function checklistEvent(event: GenerationEvent): GenerationEvent | null {
  const data = event.data;
  let compact: Record<string, unknown>;
  if (event.type === 'plan.ready') {
    compact = {
      beats: Array.isArray(data.beats)
        ? data.beats.map((value) => {
            const beat = object(value);
            return { id: beat.id, kind: beat.kind, label: beat.label, target: beat.target, detail: beat.detail };
          })
        : [],
    };
  } else if (
    ['beat.started', 'beat.completed', 'beat.failed', 'beat.fallback', 'beat.omitted', 'beat.degraded'].includes(
      event.type,
    )
  ) {
    // The cause of a loss (a short code per part), never the checks' wording.
    compact = {
      beat: data.beat,
      outcome: data.outcome,
      code: data.code,
      because: data.because,
      dropped: data.dropped,
      causes: data.causes,
    };
  } else if (event.type === 'board.duplicate') {
    compact = {
      dropped: Array.isArray(data.dropped)
        ? data.dropped.map((drop) => ({ step: object(drop).step, beat: object(drop).beat }))
        : [],
    };
  } else if (['tool.started', 'tool.completed'].includes(event.type)) {
    const args = object(data.arguments),
      output = object(data.output),
      chapter = object(args.chapter);
    const plan = data.plan ?? output.plan;
    compact = {
      callId: data.callId,
      name: data.name,
      chapterId: data.chapterId ?? output.chapterId ?? chapter.id,
      chapterTitle: data.chapterTitle ?? chapter.title,
      savedSteps: data.savedSteps ?? output.savedSteps,
      published: data.published ?? output.published,
      failed: data.failed ?? !!output.error,
      plan: Array.isArray(plan)
        ? plan.map((value) => {
            const row = object(value);
            return { id: row.id, title: row.title };
          })
        : undefined,
    };
  } else if (['model.started', 'model.completed', 'model.failed'].includes(event.type)) {
    compact = { callId: data.callId, name: data.name };
  } else if (
    [
      'run.started',
      'step.started',
      'sources.prepared',
      'run.completed',
      'run.failed',
      'run.paused',
      'tour.direction',
    ].includes(event.type)
  ) {
    compact = { stage: data.stage, retrying: data.retrying };
  } else return null;
  return { id: event.id, at: event.at, type: event.type, data: compact };
}

export function generationChecklist(input: GenerationEvent[], status: string) {
  const phases: ChecklistRow[] = [
    { id: 'prepare', label: 'Prepare document sources', state: 'pending' },
    { id: 'understand', label: 'Read and understand the document', state: 'pending' },
    { id: 'plan', label: 'Plan the tour', state: 'pending' },
    { id: 'write', label: 'Write narration and visual cues', state: 'pending' },
    { id: 'validate', label: 'Check references and presentation', state: 'pending' },
    { id: 'publish', label: 'Save the finished tour', state: 'pending' },
  ];
  const phase = (id: string) => phases.find((row) => row.id === id)!;
  const items = new Map<string, ChecklistRow>();
  const trackedIds = new Set<string>();
  const events = uniqueGenerationEvents(input).flatMap((event) => checklistEvent(event) ?? []);
  let tracked = false;
  let published = false;
  for (const event of events) {
    const { data, type } = event;
    // Legacy retries keep the generation ID and append a fresh run to its journal.
    // The checklist describes this attempt, not the sum of historical attempts.
    if (type === 'run.started') {
      phases.forEach((row) => {
        row.state = 'pending';
        delete row.detail;
      });
      phase('prepare').state = 'active';
      items.clear();
      trackedIds.clear();
      tracked = false;
      published = false;
    }
    if (type === 'step.started') {
      if (data.stage === 'preparing') phase('prepare').state = 'active';
      if (data.stage === 'validating') {
        phase('write').state = 'done';
        phase('validate').state = 'active';
      }
    }
    if (type === 'sources.prepared') phase('prepare').state = 'done';
    if (type === 'model.started') {
      const name = String(data.name);
      phase('prepare').state = 'done';
      if (['paper_card', 'paper_context', 'context'].includes(name)) phase('understand').state = 'active';
      if (name === 'tour_plan') {
        phase('understand').state = 'done';
        phase('plan').state = 'active';
      }
      if (['beat_direction', 'exercise_solution'].includes(name)) phase('write').state = 'active';
    }
    if (type === 'run.completed') published = true;
    if (type === 'tool.started') {
      if (['view_visuals', 'record_visual_observations'].includes(String(data.name)))
        phase('understand').state = 'active';
      if (data.name === 'set_tour_plan') phase('plan').state = 'active';
      if (data.name === 'upsert_tour_chapter') {
        phase('write').state = 'active';
        const row = items.get(String(data.chapterId));
        if (row) row.state = 'active';
      }
      if (data.name === 'finish_tour') phase('validate').state = 'active';
    }
    if (type === 'tool.completed' && !data.failed) {
      if (data.name === 'set_tour_plan' && Array.isArray(data.plan)) {
        for (const id of ['prepare', 'understand', 'plan']) phase(id).state = 'done';
        const retained = new Set<string>();
        for (const value of data.plan) {
          const chapter = object(value),
            id = text(chapter.id);
          if (!id) continue;
          retained.add(id);
          if (!items.has(id)) items.set(id, { id, label: text(chapter.title) ?? 'Chapter', state: 'pending' });
        }
        for (const id of items.keys()) if (!retained.has(id)) items.delete(id);
      }
      if (data.name === 'upsert_tour_chapter') {
        const id = String(data.chapterId),
          row = items.get(id);
        if (row) {
          row.state = 'done';
          row.detail = `${data.savedSteps} tour steps saved`;
          trackedIds.add(id);
          tracked = true;
        }
      }
      if (data.published === true) published = true;
    }
    if (type === 'plan.ready') {
      for (const id of ['prepare', 'understand', 'plan']) phase(id).state = 'done';
      items.clear();
      for (const value of Array.isArray(data.beats) ? data.beats : []) {
        const beat = object(value),
          id = text(beat.id);
        if (!id) continue;
        const label = text(beat.label) ?? kinds[String(beat.kind)] ?? 'Tour step';
        const detail = [text(beat.target), beat.detail === true ? 'Detailed explanation' : undefined]
          .filter(Boolean)
          .join(' · ');
        items.set(id, { id, label, state: 'pending', ...(detail ? { detail } : {}) });
      }
    }
    if (type.startsWith('beat.')) {
      const id = String(data.beat),
        row = items.get(id);
      if (!row) continue;
      tracked = true;
      trackedIds.add(id);
      if (type === 'beat.started') {
        row.state = 'active';
        phase('write').state = 'active';
      }
      if (type === 'beat.failed') row.state = 'failed';
      if (['beat.completed', 'beat.fallback', 'beat.omitted'].includes(type)) {
        row.state = 'done';
        // The cause comes with the event; a record from before it was kept says no more than what happened.
        const outcome = data.outcome ?? type.replace('beat.', '');
        if (outcome === 'fallback') row.detail = 'Prepared with fallback narration';
        if (outcome === 'omitted') row.detail = 'Skipped; the reason was not recorded';
      }
    }
    if (type === 'tour.direction') {
      phase('write').state = 'done';
      phase('validate').state = 'done';
      phase('publish').state = 'active';
    }
  }
  // What each step lost, and why, in plain words.
  const losses = lossesFromEvents(events);
  for (const row of items.values()) {
    const lost = losses.filter((loss) => loss.step === row.id);
    if (lost.length) row.detail = lossDetail(lost);
  }
  if (published || ['ready', 'completed'].includes(status)) {
    phases.forEach((row) => (row.state = 'done'));
    for (const row of items.values())
      if (!trackedIds.has(row.id)) {
        row.state = 'unknown';
        row.detail = 'Detailed status was not recorded for this step';
      }
  } else if (['failed', 'cancelled'].includes(status)) {
    for (const row of [...phases, ...items.values()])
      if (row.state === 'active') {
        row.state = 'failed';
        row.detail = status === 'cancelled' ? 'Cancelled' : 'Interrupted';
      }
  } else if (['paused', 'needs_configuration'].includes(status)) {
    for (const row of [...phases, ...items.values()])
      if (row.state === 'active') row.detail = 'Paused; saved work is kept';
  }
  const rows = [...items.values()];
  return {
    phases,
    items: rows,
    planned: rows.length,
    finished: rows.filter((row) => row.state === 'done').length,
    active: rows.filter((row) => row.state === 'active').length,
    tracked,
  };
}
