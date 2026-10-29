import { museAuthoringSchema } from '../muse/authoring-schema';
/**
 * Muse strict function calls require every object property, including nested ones.
 * This tool has no unions or optional semantic payloads: empty components / an empty
 * explanation and replaceComponents=false preserve the normal merge behavior.
 * Keep the chapter tool separate; its action unions need a different wire schema.
 */
export function strictVisualObservationTool<T extends { name: string; parameters: object; strict: boolean }>(
  tool: T,
): T {
  if (tool.name !== 'record_visual_observations') return tool;
  const parameters = structuredClone(tool.parameters);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const schema = value as Record<string, unknown>;
    if (schema.oneOf || schema.allOf)
      throw new Error('Visual observation strict schema cannot contain oneOf or allOf.');
    if (schema.type === 'object') {
      schema.additionalProperties = false;
      schema.required = Object.keys((schema.properties ?? {}) as object);
    }
    Object.values(schema).forEach(visit);
  };
  visit(parameters);
  return { ...tool, strict: true, parameters };
}

/** Keep the chapter envelope structured while polymorphic actions are validated
 * against the full canonical schema at execution. Muse limits function schema depth.
 */
export function shallowChapterTool<
  T extends { name: string; description: string; parameters: object; strict: boolean },
>(tool: T): T {
  if (tool.name !== 'upsert_tour_chapter') return tool;
  return {
    ...tool,
    strict: false,
    description: `${tool.description} Supply chapter as an object with id, title and steps, not as an encoded string or an extra chapter wrapper. Polymorphic actions must satisfy the complete authoring contract documented here; the server validates every action, source and timing: ${JSON.stringify(tool.parameters)}`,
    parameters: museAuthoringSchema(tool.parameters, false),
  };
}
