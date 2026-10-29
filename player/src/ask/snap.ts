// Asking the server to snap a loose region to the object inside it (SAM 3.1: server/src/snap.ts). The reply never
// blocks anything: any failure, a slow answer or a "no object" leaves the learner's rectangle as it is.

import { apiRequest } from '../library/client';
import type { AskSource } from './api';
import { canSnap, parseSnapped, snapBody } from './snapGeometry';
import type { PageSize, Snapped } from './snapGeometry';
import type { RegionSelection } from './regionSelection';

/** The model answers within about 8 s on the server; the browser gives up a little after that. */
const WAIT_MS = 15_000;
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * The outline of the object inside the region, or null when there is none to show (a failed snap, no server, no
 * session, a drag too small or too large to hold one). Never throws.
 */
export async function snapObject(
  source: AskSource,
  selection: RegionSelection,
  page: PageSize,
  analysisId?: string,
  signal?: AbortSignal,
): Promise<Snapped | null> {
  if (!canSnap(selection, page)) return null;
  const init: RequestInit = {
    method: 'POST',
    body: JSON.stringify(snapBody(selection, page, analysisId)),
    signal: AbortSignal.any([AbortSignal.timeout(WAIT_MS), ...(signal ? [signal] : [])]),
  };
  try {
    let reply: unknown;
    if ('documentId' in source) {
      reply = await apiRequest<unknown>(`/api/documents/${encodeURIComponent(source.documentId)}/snap`, init);
    } else {
      // Demo papers have no session; the API answers them only in local development.
      const response = await fetch(`${apiBase}/api/demo/${encodeURIComponent(source.paper)}/snap`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      if (!response.ok) return null;
      reply = await response.json();
    }
    return parseSnapped(reply, page);
  } catch {
    return null;
  }
}
