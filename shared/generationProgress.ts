import type { GenerationEvent } from './activity';
import { uniqueGenerationEvents } from './generationDiagnostics';
import { modelActivityNames } from './generationTimeline';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** Human-readable, observable actions only; no generated thoughts or extra provider requests. */
export function generationProgress(events: GenerationEvent[], status: string) {
  events = uniqueGenerationEvents(events);
  const starts = new Map<string, GenerationEvent>();
  const finished = new Set<string>();
  const viewed = new Set<string>();
  const observations = new Set<string>();
  const chapters = new Map<string, number>();
  const drafts = new Set<string>();
  let publishedSteps: number | undefined;
  let imageRequests = 0,
    resets = 0,
    historyResets = 0,
    failures = 0;
  let lastTool: GenerationEvent | undefined;
  let latestReset: GenerationEvent | undefined;
  for (const event of events) {
    const call = String(event.data.callId ?? event.id);
    if (event.type === 'model.completed' && typeof record(event.data.output).say === 'string') drafts.add(call);
    if (event.type === 'tour.direction' && typeof event.data.steps === 'number') publishedSteps = event.data.steps;
    if (event.type === 'model.started' || event.type === 'tool.started') starts.set(call, event);
    if (['model.completed', 'model.failed', 'tool.completed'].includes(event.type)) finished.add(call);
    if (event.type === 'context.reset') {
      resets++;
      if (event.data.reason === 'provider_history_unavailable') historyResets++;
      latestReset = event;
      // A reset abandons any previous pending dispatch.
      for (const key of starts.keys()) finished.add(key);
    }
    if (event.type === 'tool.started' && event.data.name === 'view_visuals') {
      const ids = strings(record(event.data.arguments).ids);
      imageRequests += ids.length;
      ids.forEach((id) => viewed.add(id));
    }
    if (event.type === 'model.failed') failures++;
    if (event.type === 'inspection.reused') strings(event.data.sources).forEach((id) => observations.add(id));
    if (event.type !== 'tool.completed') continue;
    lastTool = event;
    const output = record(event.data.output);
    if (output.error) {
      failures++;
      continue;
    }
    if (event.data.name === 'record_visual_observations')
      strings(output.recorded).forEach((id) => observations.add(id));
    if (typeof output.chapterId === 'string' && typeof output.savedSteps === 'number')
      chapters.set(output.chapterId, output.savedSteps);
  }
  const active = [...starts.values()].reverse().find((event) => !finished.has(String(event.data.callId ?? event.id)));
  const terminal: Record<string, string> = {
    ready: 'Tour saved',
    completed: 'Tour saved',
    failed: 'Tour generation interrupted',
    cancelled: 'Tour generation cancelled',
    paused: 'Tour generation paused',
    pausing: 'Finishing the current action before pausing',
    needs_configuration: 'Waiting for a Meta connection',
  };
  let title = terminal[status] ?? 'Waiting for the next action';
  let detail =
    status === 'ready' || status === 'completed'
      ? 'Ready to play. Follow the tour or ask about any part of the document.'
      : 'Your work is saved as each chapter is completed.';
  if (!terminal[status] && active) {
    const tool = active.data.name;
    const args = record(active.data.arguments);
    if (active.type === 'tool.started') {
      const ids = strings(args.ids);
      const descriptions: Record<string, string> = {
        view_visuals: 'Opening pages and figures',
        search_paper: 'Finding supporting passages',
        read_elements: 'Reading the cited passages',
        record_visual_observations: 'Saving visual observations',
        set_tour_plan: 'Planning the tour chapters',
        upsert_tour_chapter: 'Checking and saving a chapter',
        finish_tour: 'Validating references and publishing the tour',
      };
      title = descriptions[String(tool)] ?? 'Running a document tool';
      if (ids.length)
        detail = `Sources: ${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ` and ${ids.length - 6} more` : ''}.`;
    } else if (modelActivityNames[String(tool)]) {
      title = modelActivityNames[String(tool)];
      const parallel = [...starts.values()].filter(
        (start) => start.type === 'model.started' && !finished.has(String(start.data.callId ?? start.id)),
      ).length;
      detail =
        parallel > 1
          ? `${parallel} model requests are running in parallel.`
          : 'Preparing this part of the tour for validation.';
    } else if (['paper_context', 'context'].includes(String(tool))) {
      title = latestReset ? 'Restoring the paper context' : 'Reading the paper context';
    } else {
      const previous = String(lastTool?.data.name ?? '');
      title =
        previous === 'view_visuals'
          ? 'Interpreting the opened pages and figures'
          : previous === 'upsert_tour_chapter'
            ? 'Preparing the next chapter'
            : previous === 'finish_tour'
              ? 'Addressing the tour validation results'
              : 'Preparing the next tour action';
      if (lastTool && record(lastTool.data.output).error) {
        title = 'Preparing a correction after a rejected tool call';
        detail = 'The previous tool result contains an error. The model is preparing its next action.';
      }
    }
  }
  const warnings: string[] = [];
  if (events.some((event) => event.type === 'context.fallback'))
    warnings.push(
      'Provider history was unavailable. Continuing from the locally saved conversation; saved observations and chapters are retained.',
    );
  if (historyResets)
    warnings.push(
      `${historyResets} context reload${historyResets === 1 ? '' : 's'} because the provider could not find previous responses. This can cause sources to be read again.`,
    );
  else if (resets) warnings.push(`${resets} context reload${resets === 1 ? '' : 's'} recorded.`);
  const repeated = imageRequests - viewed.size;
  if (repeated > 0)
    warnings.push(
      `${imageRequests} visual source requests for ${viewed.size} distinct sources (${repeated} repeated requests; these do not necessarily resend image data).`,
    );
  if (failures)
    warnings.push(
      `${failures} rejected or failed call${failures === 1 ? '' : 's'} recorded. Details remain available below.`,
    );
  return {
    title,
    detail,
    warnings,
    since: !terminal[status] ? (active?.at ?? null) : null,
    observations: observations.size,
    chapters: chapters.size,
    steps: publishedSteps ?? [...chapters.values()].reduce((sum, count) => sum + count, 0),
    drafts: drafts.size,
  };
}
