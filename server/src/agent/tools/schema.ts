import { TOUR_DRAFT_SCHEMA } from '../../muse/schema';
export const ids = { type: 'array', minItems: 1, maxItems: 30, items: { type: 'string', minLength: 1 } };
export const object = (properties: object, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
export const observation = object(
  {
    sourceId: { type: 'string' },
    description: { type: 'string', minLength: 1, maxLength: 2200 },
    readable: { type: 'boolean' },
    uncertainties: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
    replaceComponents: {
      type: 'boolean',
      description:
        'Set true with a complete components array to replace or clear previous components. Otherwise updates merge by label.',
    },
    components: {
      type: 'array',
      maxItems: 24,
      items: object(
        {
          label: { type: 'string', minLength: 1, maxLength: 80 },
          region: structuredClone(TOUR_DRAFT_SCHEMA.$defs.region),
          explanation: { type: 'string', maxLength: 400 },
        },
        ['label', 'region'],
      ),
    },
  },
  ['sourceId', 'description', 'readable', 'uncertainties'],
);
export const chapter = TOUR_DRAFT_SCHEMA.properties.chapters.items;
