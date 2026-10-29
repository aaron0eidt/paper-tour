import type { MuseConfig, Config } from '../config';
import type { TourGenerator } from '../tour-generator';
import { HarnessTourGenerator } from '../harness/generator';
import { MuseTourGenerator } from '../muse/generator';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { ProcessingError } from '../errors';

type Writer = Config['tours']['writer'];
type Factory = (config: MuseConfig, preset: Config['tours']['preset'], transport?: typeof fetch) => TourGenerator;
const writers: Record<Writer, Factory> = {
  harness: (config, preset, transport) => new HarnessTourGenerator(config, preset, transport),
  muse: (config, _preset, transport) => new MuseTourGenerator(config, transport),
};

/** One provider binding for every authoring strategy; persisted model selection wins. */
export function createTourGenerator(config: MuseConfig, options: Config['tours'], transport?: typeof fetch) {
  if (!OFFICIAL_MODELS[config.model]?.tourCompatible)
    throw new ProcessingError('unsupported_model', 'Choose a model that supports paper text and images.');
  return writers[options.writer](config, options.preset, transport);
}
