/** Meta limits nested provider schemas. Keep the structured chapter/step envelope;
 * polymorphic visual actions are checked against the unchanged canonical schema
 * by the authoring/journal boundary, after the model returns.
 */
export function museAuthoringSchema(schema: object, includeContract = true): object {
  const source = schema as { $defs?: Record<string, unknown>; description?: string };
  const defs = source.$defs;
  if (!defs?.action || !defs.step) return schema;
  const action = defs.action as { oneOf: { properties: { type: { const: string } } }[] };
  const visualAction = {
    type: 'object',
    additionalProperties: true,
    required: ['type'],
    properties: { type: { type: 'string', enum: action.oneOf.map((item) => item.properties.type.const) } },
  };
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (node.$ref === '#/$defs/action') return visualAction;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const target = defs[node.$ref.slice('#/$defs/'.length)];
      if (!target) throw new Error('Unknown canonical authoring schema reference');
      return visit(target);
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== '$defs')
        .map(([key, item]) => [key, visit(item)]),
    );
  };
  const projected = visit(schema) as Record<string, unknown>;
  return includeContract
    ? {
        ...projected,
        description: `${source.description ?? ''} Every visual action must follow this complete authoring contract; the server validates it before publication: ${JSON.stringify(defs)}`,
      }
    : projected;
}
