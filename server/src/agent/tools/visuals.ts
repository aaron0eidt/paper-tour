import type { VisualSource } from './context';
import { visualFrame, updateVisualComponents, type VisualComponent } from '../../muse/visual-direction';
import { observation, ids, object } from './schema';
import { defineTool, wire } from './registry';
export const visualTools = [
  defineTool({
    wire: wire([
      'view_visuals',
      'See actual images for up to 12 page/figure/table source IDs. Images are returned to you, not interpreted by another model.',
      object({ ids: { ...ids, maxItems: 12 } }, ['ids']),
    ]),
    effect: 'write',
    stage: 'images',
    async execute(scope, next, args, _original) {
      const requested = [...new Set(args.ids as string[])];
      const images: VisualSource[] = [];
      for (const id of requested) {
        const source = scope.visuals.find((v) => v.targetId === id);
        if (!source) throw new Error('Unknown visual source ' + id);
        if (next.presented[id] !== source.sha256) images.push(source);
        next.presented[id] = source.sha256;
      }
      return {
        state: next,
        output: {
          sources: requested.map((id) => {
            const { storagePath: _path, ...source } = scope.visuals.find((v) => v.targetId === id)!;
            return { ...source, frame: visualFrame(scope.doc, id) };
          }),
          alreadyInContext: requested.filter((id) => !images.some((v) => v.targetId === id)),
        },
        images,
      };
    },
  }),
  defineTool({
    wire: wire([
      'record_visual_observations',
      'Save grounded observations of sources actually shown in an earlier tool result. Record all viewed pages and figures. Identify individual labelled blocks, operations, arrows, axes or table groups, not just large left/right containers. Complex diagrams usually need 6–12 precise component regions. Use the image coordinate frame from view_visuals. Empty components is only for a genuinely single-part visual.',
      object({ observations: { type: 'array', minItems: 1, maxItems: 24, items: observation } }, ['observations']),
    ]),
    effect: 'write',
    stage: 'images',
    prepare: (raw) => {
      const supplied = raw as { observations?: Record<string, unknown>[] } | null;
      if (!Array.isArray(supplied?.observations)) return raw;
      return {
        ...supplied,
        observations: supplied.observations.map((item) =>
          item && typeof item === 'object' && !Object.hasOwn(item, 'uncertainties')
            ? { ...item, uncertainties: [] }
            : item,
        ),
      };
    },
    argumentError: (raw, errors) => {
      if (!errors?.some((error) => error.keyword === 'required' && error.params.missingProperty === 'description'))
        return undefined;
      const observations = (raw as { observations?: { sourceId?: string; description?: unknown }[] } | null)
        ?.observations;
      const missing = Array.isArray(observations)
        ? observations
            .filter((item) => item && typeof item === 'object' && !Object.hasOwn(item, 'description'))
            .map((item) => item.sourceId)
            .filter((id): id is string => typeof id === 'string')
        : [];
      return `Invalid tool arguments: each observation needs a description of what is visible. Missing descriptions: ${missing.join(', ')}. Resubmit the corrected observations with sourceId, description, readable and uncertainties. Example: {"sourceId":"page1","description":"Describe the actual visible content here.","readable":true,"uncertainties":[]}. Keep the existing components. Use images already delivered in this context; do not reload them just to repair these fields.`;
    },

    async execute(scope, next, args, original) {
      const supplied = original as { observations?: Record<string, unknown>[] } | null;
      const uncertaintyProvided = Array.isArray(supplied?.observations)
        ? supplied.observations.map((item) => !!item && Object.hasOwn(item, 'uncertainties'))
        : [];

      for (const [index, item] of args.observations.entries()) {
        const source = scope.visuals.find((v) => v.targetId === item.sourceId);
        if (
          !source ||
          next.presented[item.sourceId] !== source.sha256 ||
          (scope.availableSources && !scope.availableSources.includes(item.sourceId))
        )
          throw new Error('Inspect ' + item.sourceId + ' with view_visuals before recording an observation.');
        const previous = next.observations[item.sourceId] as
          | { uncertainties?: string[]; uncertaintiesReported?: boolean; components?: VisualComponent[] }
          | undefined;
        const { replaceComponents, ...observation } = item;
        const components = updateVisualComponents(previous?.components, item.components, replaceComponents);
        next.observations[item.sourceId] = {
          ...observation,
          ...(components !== undefined ? { components } : {}),
          uncertainties: uncertaintyProvided[index] ? item.uncertainties : (previous?.uncertainties ?? []),
          uncertaintiesReported:
            uncertaintyProvided[index] || (previous?.uncertaintiesReported ?? Array.isArray(previous?.uncertainties)),
        };
      }
      return { state: next, output: { recorded: args.observations.map((x: any) => x.sourceId) } };
    },
  }),
];
