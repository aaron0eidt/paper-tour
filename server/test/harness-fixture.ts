import { HarnessTourGenerator as Generator } from '../src/harness/generator';

/** Scripted model fixtures do not depend on local OCR binaries or synthetic one-pixel image contents. */
export class HarnessTourGenerator extends Generator {
  constructor(...args: ConstructorParameters<typeof Generator>) {
    super(args[0], args[1], args[2], args[3], args[4] ?? (async () => []), args[5]);
  }
}
