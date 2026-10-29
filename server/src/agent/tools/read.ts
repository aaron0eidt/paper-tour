import { defineTool, wire } from './registry';
import { ids, object } from './schema';
export const readTools = [
  defineTool({
    wire: wire([
      'search_paper',
      'Search this paper for supporting evidence.',
      object({ query: { type: 'string', minLength: 2, maxLength: 300 } }, ['query']),
    ]),
    effect: 'read',
    stage: 'writing',
    async execute(scope, next, args, _original) {
      return {
        state: next,
        output: await scope.service.search(scope.owner, scope.documentId, scope.analysisId, args.query),
      };
    },
  }),
  defineTool({
    wire: wire([
      'read_elements',
      'Read exact text and relationships for up to 30 source IDs.',
      object({ ids }, ['ids']),
    ]),
    effect: 'read',
    stage: 'writing',
    async execute(scope, next, args, _original) {
      const elements = await scope.service.elements(scope.owner, scope.documentId, scope.analysisId, args.ids);
      if (elements.length !== new Set(args.ids).size)
        throw new Error('Some requested source IDs do not exist in this paper.');
      return { state: next, output: elements };
    },
  }),
];
