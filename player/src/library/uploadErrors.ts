import { ApiRequestError } from './client';

export class UploadValidationError extends Error {}

/** Do not display TUS's raw URLs, headers or response JSON in the document library. */
export function uploadErrorMessage(cause: unknown): string {
  if (cause instanceof UploadValidationError || cause instanceof ApiRequestError) return cause.message;
  const detail = cause as {
    originalResponse?: { getStatus?(): number };
    originalRequest?: unknown;
    name?: string;
  } | null;
  const status = detail?.originalResponse?.getStatus?.();
  if (status === 401 || status === 403) return 'The upload could not be authorized. Sign in again, then retry.';
  if (status === 409) return 'An upload for this PDF already exists. Cancel this upload and try again.';
  if (status === 413) return 'This PDF is too large for the library. Choose a smaller file.';
  if (status === 429) return 'Too many uploads. Wait a moment, then retry.';
  if (status && status >= 500) return 'The file service is temporarily unavailable. Retry in a moment.';
  if (status && status >= 400) return 'The file service rejected this upload. Retry, or choose another PDF.';
  if (cause instanceof TypeError || detail?.originalRequest)
    return 'The upload stopped. Check your connection, then retry.';
  if (detail?.name === 'AuthError' || detail?.name === 'AuthApiError')
    return 'The upload could not be authorized. Sign in again, then retry.';
  return 'The PDF could not be uploaded. Check your connection, then retry.';
}
