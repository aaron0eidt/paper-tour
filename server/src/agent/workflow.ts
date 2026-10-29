import type { RunState } from './tools';
/** A concise controller checkpoint, not a second model interpreting the agent. */
export function workflowDirective(state: RunState, required: string[], attachedSources: string[] = []): string {
  const viewed = new Set([...Object.keys(state.delivered ?? {}), ...attachedSources]);
  const unseen = required.filter((id) => !state.observations[id] && !viewed.has(id));
  const unrecorded = required.filter((id) => !state.observations[id] && viewed.has(id));
  const missing = state.plan.filter((chapter) => !state.chapters[chapter.id]);
  const checkpoint = `Saved chapters: ${Object.keys(state.chapters).join(', ') || 'none'}.`;
  if (unrecorded.length)
    return `${checkpoint} Record observations for already viewed sources: ${unrecorded.join(', ')}. Each needs sourceId, description, readable and uncertainties. For prose pages, a concise description and empty components suffice; reserve detailed components for diagrams/tables. Do not reopen these images.`;
  if (unseen.length)
    return `${checkpoint} Inspect missing visual sources in batches: ${unseen.join(', ')}. Batch up to 12 sources per view_visuals call. After seeing them, record observations, then write.`;
  if (!state.plan.length)
    return 'All required sources are inspected. Set a concise chapter plan in document order, then save the first chapters. You can call set_tour_plan followed by upsert_tour_chapter in the same response; writes execute in order.';
  if (missing.length)
    return `${checkpoint} Next chapters: ${missing.map((c) => `${c.id}: ${c.title}`).join('; ')}. Save two or three consecutive chapters in this response when they fit, using one upsert_tour_chapter call per chapter. Successfully saved chapters, including automatic timing adjustments, are complete: do not rewrite them for optional polish. Explain mechanisms and why they matter, with a concrete worked example where useful. Use grounded zoom, spotlight, arrows, highlights and explanatory board actions when they clarify the explanation. After the last chapter, call finish_tour in the same response.`;
  return `${checkpoint} All planned chapters and required observations are saved. Call finish_tour now. Only repair concrete validation errors it returns; do not rewrite saved chapters for optional timing adjustments.`;
}
