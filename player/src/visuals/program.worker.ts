import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
import wasmLocation from '@jitl/quickjs-wasmfile-release-sync/wasm?url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { renderProgramFrame, type ProgramRuntimeAdapter } from '../../../shared/programRuntime';
import type { ProgramItem } from '../../../shared/program';

// A dedicated worker is also terminable by the UI; even engine initialization cannot block it.
// An explicit Vite asset URL works in both dev workers and hashed production chunks.
const quickJS = newQuickJSWASMModule(newVariant(RELEASE_SYNC, { wasmLocation }));
const adapter: ProgramRuntimeAdapter = {
  async evaluate(script, milliseconds) {
    const module = await quickJS;
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
        throw new Error(error.message ?? 'Invalid scene program');
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
      parseTagValue: false,
      processEntities: true,
      trimValues: false,
    }).parse(source);
  },
};
self.onmessage = async (
  event: MessageEvent<{ id: number; item: ProgramItem; t: number; parameters: Record<string, number> }>,
) => {
  const { id, item, t, parameters } = event.data;
  try {
    self.postMessage({ id, frame: await renderProgramFrame(item, t, adapter, parameters) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Scene rendering failed' });
  }
};
