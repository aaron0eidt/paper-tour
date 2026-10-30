import { HarnessTourGenerator as Generator } from '../src/harness/generator';
import { PACE } from '../src/harness/pace';

/**
 * Scripted model fixtures do not depend on local OCR binaries or synthetic one-pixel image contents, and a provider
 * outage they script is waited out at once (the waits themselves are tested in harness-pace.test.ts).
 */
export class HarnessTourGenerator extends Generator {
  constructor(...args: ConstructorParameters<typeof Generator>) {
    const pace = args[5] ?? PACE;
    super(args[0], args[1], args[2], args[3], args[4] ?? (async () => []), { ...pace, outages: pace.outages.map(() => 0) });
  }
}
