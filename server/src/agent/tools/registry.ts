import Ajv2020, { type ErrorObject } from 'ajv/dist/2020.js';
import type { TourGenerationStage } from '../../../../shared/contracts';
import type { materializeTour } from '../../muse/schema';
import type { RunState, ToolScope, VisualSource } from './context';

interface WireDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: object;
  strict: boolean;
}
export interface ToolResult {
  state: RunState;
  output: unknown;
  images?: VisualSource[];
  finished?: ReturnType<typeof materializeTour>;
}
export interface PaperTool {
  wire: WireDefinition;
  effect: 'read' | 'write';
  stage: TourGenerationStage;
  prepare?(raw: unknown): unknown;
  argumentError?(raw: unknown, errors?: ErrorObject[] | null): string | undefined;
  execute(scope: ToolScope, state: RunState, args: Record<string, any>, original: unknown): Promise<ToolResult>;
}
export const wire = ([name, description, parameters]: [string, string, object]): WireDefinition => ({
  type: 'function',
  name,
  description,
  parameters,
  strict: false,
});
export const defineTool = (definition: PaperTool): PaperTool => definition;

/** All domain writes remain pure transitions; only the durable journal commits them. */
export function createToolRegistry(tools: readonly PaperTool[]) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const catalog = new Map<string, { tool: PaperTool; check: ReturnType<typeof ajv.compile> }>();
  for (const tool of tools) {
    if (catalog.has(tool.wire.name)) throw new Error(`Duplicate paper tool: ${tool.wire.name}`);
    catalog.set(tool.wire.name, { tool, check: ajv.compile(tool.wire.parameters) });
  }
  const validate = (name: string, args: unknown) => {
    const entry = catalog.get(name);
    if (!entry) throw new Error('Invalid tool arguments: unknown tool');
    if (!entry.check(args))
      throw new Error(
        entry.tool.argumentError?.(args, entry.check.errors) ??
          `Invalid tool arguments: ${ajv.errorsText(entry.check.errors)}`,
      );
  };
  return {
    definitions: tools.map((tool) => tool.wire),
    effect: (name: string) => catalog.get(name)?.tool.effect,
    stage: (name: string) => catalog.get(name)?.tool.stage ?? 'writing',
    validate,
    async execute(scope: ToolScope, state: RunState, name: string, raw: unknown): Promise<ToolResult> {
      const entry = catalog.get(name);
      if (!entry) throw new Error('Invalid tool arguments: unknown tool');
      const args = entry.tool.prepare?.(raw) ?? raw;
      validate(name, args);
      return entry.tool.execute(scope, structuredClone(state), args as Record<string, any>, raw);
    },
  };
}
