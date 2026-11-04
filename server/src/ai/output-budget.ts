import { ProcessingError } from '../errors';

/** Retry only truncated responses, keeping the same task and increasing room for reasoning/output.
 * The caller's cancellation/deadline and the provider's supported limits remain authoritative.
 */
export async function withGrowingOutputBudget<T>(
  initialTokens: number,
  signal: AbortSignal | undefined,
  request: (tokens: number) => Promise<T>,
): Promise<T> {
  let tokens = initialTokens;
  for (;;) {
    signal?.throwIfAborted();
    try {
      return await request(tokens);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof ProcessingError) || error.code !== 'muse_output_truncated') throw error;
      const next = tokens * 2;
      if (!Number.isSafeInteger(next)) throw error;
      tokens = next;
    }
  }
}
