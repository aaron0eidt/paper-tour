import { getQuickJS } from 'quickjs-emscripten';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { renderProgramFrame as render, type ProgramRuntimeAdapter } from '../../../shared/programRuntime';
import type { ProgramItem } from '../../../shared/program';

/** QuickJS receives strings only, never a native callback or a reference to application state. */
export const programRuntime: ProgramRuntimeAdapter = {
  async evaluate(script, milliseconds) {
    const module = await getQuickJS();
    const runtime = module.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(256 * 1024);
    const deadline = Date.now() + milliseconds;
    runtime.setInterruptHandler(() => Date.now() > deadline);
    const context = runtime.newContext();
    try {
      const result = context.evalCode(script, 'paper-scene.js');
      if (result.error) {
        const error = context.dump(result.error) as { message?: string };
        result.error.dispose();
        throw new Error(`Scene execution failed: ${error.message ?? 'invalid program'}`);
      }
      const output = context.getString(result.value);
      result.value.dispose();
      return output;
    } finally {
      context.dispose();
      runtime.dispose();
    }
  },
  parseSvg(source) {
    if (XMLValidator.validate(source) !== true) throw new Error('Invalid SVG');
    return new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      preserveOrder: true,
      processEntities: true,
      parseTagValue: false,
      trimValues: false,
    }).parse(source);
  },
};
export const renderProgramFrame = (item: ProgramItem, t: number, parameters: Record<string, number> = {}) =>
  render(item, t, programRuntime, parameters);
