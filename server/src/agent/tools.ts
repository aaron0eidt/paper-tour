import { createToolRegistry } from './tools/registry';
import { readTools } from './tools/read';
import { visualTools } from './tools/visuals';
import { tourTools } from './tools/tour';
export { AGENT_VERSION, AGENT_INSTRUCTIONS } from './instructions';
export {
  draftFromState,
  requiredVisuals,
  paperManifest,
  toolOutput,
  type RunState,
  type VisualSource,
  type ToolScope,
} from './tools/context';

/** One catalog supplies SDK schemas, validation, execution and workflow metadata. */
export const paperTools = createToolRegistry([...readTools, ...visualTools, ...tourTools]);
export const AGENT_TOOLS = paperTools.definitions;
export const checkArguments = paperTools.validate;
export const executeTool = paperTools.execute;
