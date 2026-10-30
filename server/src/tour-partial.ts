import type { TourGenerationStage, TourGenerationStatus } from '../../shared/contracts';
import type { Doc, Tour } from '../../shared/paper';
import type { ActivitySink } from './activity';
import type { Db } from './db';

/**
 * Progressive tours. While a tour is written, the generator reports the leading steps that are complete, and the
 * reader can start playing them before the rest exists.
 *
 * The generator emits through TourGenerationInput.onEvent:
 *   onEvent('tour.partial', { tour, ready, planned })
 * where `tour` is a valid, playable Tour of the leading steps, `ready` counts the steps (or beats) it holds and
 * `planned` the whole tour's. Each emission supersedes the one before; the worker keeps only the latest.
 *
 * What is stored: one row per running generation in tour_generation_partials, written in one statement (so never
 * half-written), replaced only by an equal or longer partial (so a late write cannot step back), written only while
 * the generation is `generating` (so it never follows or replaces a finished tour), and removed when the finished
 * tour is saved or an attempt starts again. A partial is never a tours row: a tours row means finished.
 *
 * What the reader gets: GET /api/documents/:id/generations/:generationId/partial (TourPartialView below). The reader
 * polls it while the generation is active; the finished tour still arrives through the manifest as before.
 */
export interface TourPartial {
  tour: Tour;
  ready: number;
  planned: number;
}

/**
 * The response of GET /api/documents/:id/generations/:generationId/partial[?after=N&attempt=ID].
 *
 * - `status` and `stage` are the generation's, as in TourGenerationSummary. Poll while status is `queued` or
 *   `generating`; on `ready` load the finished tour through the manifest (`tourId` names it) and stop.
 * - `tour`, `ready`, `planned` and `attempt` are set only while status is `generating` and a partial exists;
 *   otherwise `tour` is null, `attempt` is null and the counts are 0 (a finished generation reports 0 and 0).
 * - `tour` is a playable Tour of the first `ready` steps. Steps only ever append within one attempt, and a step keeps
 *   its id, so playback can continue in place while the tour grows.
 * - `attempt` identifies one run of the generator. After a retry it changes and the steps may differ: replace the
 *   partial tour instead of extending it.
 * - A client that already holds a partial sends `after` (its ready) and `attempt`; when both still match, `tour` is
 *   null and only the counts are returned, which keeps the poll small. Without both, the tour is always sent.
 */
export interface TourPartialView {
  generationId: string;
  status: TourGenerationStatus;
  stage: TourGenerationStage;
  /** The finished tour once status is `ready`. */
  tourId: string | null;
  attempt: string | null;
  ready: number;
  planned: number;
  tour: Tour | null;
}

/** A partial larger than this is not stored; the tour of a long document is a fraction of it. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_STEPS = 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : 0);

/**
 * The partial an event carries, or null when it cannot be served: another document's tour, no playable step, or a
 * shape the player would reject. The generator validates the tour itself; this only keeps a bad event from being
 * stored as a tour. `planned` below `ready` is raised to it.
 */
export function partialFromEvent(data: Record<string, unknown>, doc: Doc): TourPartial | null {
  const { tour } = data;
  const ready = count(data.ready);
  if (!ready || ready > MAX_STEPS || !isObject(tour)) return null;
  if (tour.schema !== 'paper-tour/tour@0.1' || tour.doc_sha256 !== doc.source.sha256 || typeof tour.title !== 'string')
    return null;
  const chapters = tour.chapters;
  if (!Array.isArray(chapters) || !chapters.length) return null;
  let steps = 0;
  for (const chapter of chapters) {
    if (!isObject(chapter) || typeof chapter.id !== 'string' || !Array.isArray(chapter.steps)) return null;
    for (const step of chapter.steps)
      if (
        !isObject(step) ||
        typeof step.id !== 'string' ||
        typeof step.say !== 'string' ||
        !Array.isArray(step.actions)
      )
        return null;
    steps += chapter.steps.length;
  }
  if (!steps || steps > MAX_STEPS) return null;
  if (JSON.stringify(tour).length > MAX_BYTES) return null;
  return { tour: tour as unknown as Tour, ready, planned: Math.min(Math.max(count(data.planned), ready), MAX_STEPS) };
}

/**
 * Keep this partial for the running generation, unless it is no longer running or holds fewer steps than the one
 * stored. True when it was stored. The share lock makes a save that races the final publication wait for it and then
 * see the generation finished.
 */
export async function savePartial(db: Db, generationId: string, partial: TourPartial): Promise<boolean> {
  const { rowCount } = await db.query(
    `insert into tour_generation_partials(generation_id,tour,ready,planned)
     select id,$2::jsonb,$3,$4 from tour_generations where id=$1 and status='generating' and result_tour_id is null for share
     on conflict(generation_id) do update set tour=excluded.tour,ready=excluded.ready,planned=excluded.planned,updated_at=now()
     where tour_generation_partials.ready<=excluded.ready`,
    [generationId, JSON.stringify(partial.tour), partial.ready, partial.planned],
  );
  return rowCount === 1;
}

/**
 * The sink the worker gives the generator: 'tour.partial' goes to the partial store, and to the journal as counts only
 * (a tour is large and each one replaces the last); every other event goes to the journal as it is. A partial that
 * cannot be kept is logged and dropped, because it only delays the reader's first step and must never fail the tour.
 */
export function partialSink(
  db: Db,
  generationId: string,
  doc: Doc,
  record: ActivitySink,
  warn: (event: 'tour_partial_rejected' | 'tour_partial_failed') => void,
): ActivitySink {
  let journalled = 0;
  return async (type, data) => {
    if (type !== 'tour.partial') return record(type, data);
    const partial = partialFromEvent(data, doc);
    if (!partial) return warn('tour_partial_rejected');
    try {
      if ((await savePartial(db, generationId, partial)) && partial.ready > journalled) {
        journalled = partial.ready;
        await record('tour.partial', { ready: partial.ready, planned: partial.planned });
      }
    } catch {
      warn('tour_partial_failed');
    }
  };
}

/**
 * Forget the partial: an attempt starts again and writes its own, or the finished tour was saved. Best effort: a store
 * that cannot be reached must not fail a tour, and a partial is served only while the generation is running.
 */
export async function clearPartial(db: Db, generationId: string): Promise<void> {
  try {
    await db.query('delete from tour_generation_partials where generation_id=$1', [generationId]);
  } catch {
    /* the next write of this generation replaces it, or nothing reads it */
  }
}

/** What the reader polls for one of the document's generations; null when the document has no such generation. */
export async function partialView(
  db: Db,
  documentId: string,
  generationId: string,
  held?: { after: number; attempt: string },
): Promise<TourPartialView | null> {
  const {
    rows: [row],
  } = await db.query(
    `select g.status,g.stage,g.result_tour_id,p.attempt,p.ready,p.planned,
       case when $3::int>=p.ready and $4::uuid=p.attempt then null else p.tour end as tour
     from tour_generations g left join tour_generation_partials p on p.generation_id=g.id and g.status='generating'
     where g.id=$1 and g.document_id=$2`,
    [generationId, documentId, held?.after ?? null, held?.attempt ?? null],
  );
  if (!row) return null;
  return {
    generationId,
    status: row.status,
    stage: row.stage,
    tourId: row.result_tour_id ?? null,
    attempt: row.attempt ?? null,
    ready: row.ready ?? 0,
    planned: row.planned ?? 0,
    tour: row.tour ?? null,
  };
}
