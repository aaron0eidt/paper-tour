export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class ProcessingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly transient = false,
  ) {
    super(message);
  }
}
/** Retains render diagnostics for debugging while exposing a stable, safe retry message. */
export class VisualValidationError extends ProcessingError {
  readonly publicMessage =
    'The generated illustration did not pass its rendering checks. Retry this passage or ask again.';
  constructor(problems: string[]) {
    super('visual_validation_failed', `Authored visual failed inspection: ${problems.join('; ')}`);
  }
}
export function missing(): never {
  throw new HttpError(404, 'not_found', 'Document or element not found.');
}
