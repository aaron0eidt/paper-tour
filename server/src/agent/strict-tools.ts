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
