import type { MuseConfig } from '../config';
import type { Preset } from '../harness/beats';
import { HarnessTourGenerator } from '../harness/generator';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { ProcessingError } from '../errors';

/** Bind the guided generator to the persisted job model and current credentials. */
export function createTourGenerator(config: MuseConfig, preset: Preset, transport?: typeof fetch) {
  if (!OFFICIAL_MODELS[config.model]?.tourCompatible)
    throw new ProcessingError('unsupported_model', 'Choose a model that supports paper text and images.');
  return new HarnessTourGenerator(config, preset, transport);
}
