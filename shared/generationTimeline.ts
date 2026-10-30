import type { GenerationEvent } from './activity';
import { uniqueGenerationEvents } from './generationDiagnostics';
export interface ActivityEntry {
  id: string;
  kind: 'model' | 'tool';
  title: string;
  detail: string;
  text: string;
  state: 'running' | 'done' | 'failed';
  durationMs?: number;
  at: string;
}
const object = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const names: Record<string, string> = {
  view_visuals: 'Open pages and figures',
  read_elements: 'Read source passages',
  search_paper: 'Search the paper',
  record_visual_observations: 'Save visual observations',
  set_tour_plan: 'Plan the tour',
  upsert_tour_chapter: 'Save a chapter',
  finish_tour: 'Check and publish the tour',
};
export const modelActivityNames: Record<string, string> = {
  paper_card: 'Understand the document',
  claims: 'Find the main claims',
  tour_plan: 'Plan the tour',
  opening_visual: 'Plan the first visual',
  visual_plan: 'Design the side visuals',
  beat_direction: 'Write narration and visual cues',
  exercise_solution: 'Work through an exercise',
  exercise_visual: 'Draw the method of an exercise',
};
/** Only public assistant text; structured JSON and private reasoning stay in the inspector. */
export function readableAgentText(value: string): string {
  const text = value.trim();
  if (/^[\[{]/.test(text) || /^```/.test(text)) return '';
  // A model can send commentary followed by its structured final payload.
  return text.split(/\n\s*(?=```)|(?=\{\s*"[^"\n]+"\s*:|\[\s*\{)/)[0].trim();
}
function assistantText(output: unknown): string {
  if (!Array.isArray(output)) {
    const value = object(output);
    // Harness `say` is public narration. Planning and reasoning fields stay out.
    return typeof value.say === 'string' ? readableAgentText(value.say) : '';
  }
  return output
    .filter((item) => item?.type === 'message' && item.role === 'assistant')
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => readableAgentText(part.text))
    .filter(Boolean)
    .join('\n\n');
}
export function generationTimeline(events: GenerationEvent[]): ActivityEntry[] {
  const entries = new Map<string, ActivityEntry>();
  const narrating = new Set<string>();
  for (const event of uniqueGenerationEvents(events)) {
    const key = String(event.data.callId ?? event.id);
    if (event.type === 'context.reset' || event.type === 'context.fallback') {
      for (const item of entries.values()) if (item.state === 'running') item.state = 'failed';
    }
    if (event.type === 'model.started' || event.type === 'tool.started') {
      if (entries.has(key)) continue;
      const kind = event.type === 'model.started' ? 'model' : 'tool';
      const args = object(event.data.arguments);
      const ids = Array.isArray(args.ids) ? args.ids.filter((id: unknown) => typeof id === 'string') : [];
      const chapter = object(args.chapter);
      const task = object(event.data.task);
      entries.set(key, {
        id: key,
        kind,
        title:
          kind === 'model'
            ? typeof task.label === 'string' && task.label.trim()
              ? task.label.trim()
              : (modelActivityNames[String(event.data.name)] ?? 'Working with the paper')
            : (names[String(event.data.name)] ?? 'Use document tool'),
        detail:
          typeof args.query === 'string'
            ? args.query
            : ids.length
              ? ids.join(', ')
              : typeof chapter.title === 'string'
                ? chapter.title
                : Array.isArray(args.observations)
                  ? `${args.observations.length} sources`
                  : '',
        text: '',
        state: 'running',
        at: event.at,
      });
    }
    const entry = entries.get(key);
    if (!entry) continue;
    if (event.type === 'model.tool.started') {
      entry.detail = `Preparing: ${names[String(event.data.name)] ?? 'document action'}`;
    }
    if (event.type === 'model.delta' && !narrating.has(key) && typeof event.data.delta === 'string')
      entry.text += event.data.delta;
    if (event.type === 'model.narration' && typeof event.data.text === 'string') {
      narrating.add(key);
      entry.text = readableAgentText(event.data.text);
      entry.detail = 'Drafting narration · validation follows';
    }
    if (['model.completed', 'tool.completed', 'model.failed'].includes(event.type)) {
      const output = object(event.data.output);
      entry.state = event.type === 'model.failed' || output.error ? 'failed' : 'done';
      const elapsed =
        typeof event.data.durationMs === 'number' ? event.data.durationMs : Date.parse(event.at) - Date.parse(entry.at);
      if (Number.isFinite(elapsed) && elapsed >= 0) entry.durationMs = elapsed;
      if (entry.kind === 'model') {
        entry.detail =
          typeof output.say === 'string' ? 'Narration draft · assembled and validated before publication' : '';
        const completed = assistantText(event.data.output);
        if (completed) entry.text = completed;
      } else if (output.error) {
        const error = Array.isArray(output.error)
          ? output.error.join(' ')
          : typeof output.error === 'string'
            ? output.error
            : '';
        entry.detail = /description/.test(error)
          ? 'The visual descriptions need to be completed.'
          : /Missing visual/.test(error)
            ? 'Some visual sources still need to be checked.'
            : /unknown document element/.test(error)
              ? 'A source reference could not be found in the document.'
              : /at_phrase/.test(error)
                ? 'A visual cue could not be matched to the narration.'
                : 'This step needs a correction. The full error is available in Details.';
      } else if (Array.isArray(output.recorded)) entry.detail = `${output.recorded.length} visual observations saved`;
      else if (typeof output.savedSteps === 'number') entry.detail = `${output.savedSteps} tour steps saved`;
      else if (output.published === true) entry.detail = 'Your tour is saved and ready to open.';
    }
  }
  return [...entries.values()].map((entry) => ({ ...entry, text: readableAgentText(entry.text) }));
}
