/** A paper-specific mathematical scene, authored as a function rather than a drawing template. */
export interface VisualParameter {
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
}
export interface ProgramItem {
  kind: 'program';
  title?: string;
  /** JavaScript function expression: ({t,params,data,theme,math,svg}) => SVG string. */
  code: string;
  parameters: VisualParameter[];
  data: { name: string; values: number[] }[];
  source: 'document' | 'illustrative';
  sourceRefs: string[];
  objective: string;
}
export interface ProgramFrame {
  svg: string;
  calculations: { label: string; value: number | number[] }[];
}
export const PROGRAM_LIMITS = { code: 16000, svg: 200000, elements: 1500, parameters: 12, data: 24 } as const;
const text = (maxLength: number, description?: string) => ({
  type: 'string',
  maxLength,
  ...(description ? { description } : {}),
});
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
export const PROGRAM_SCHEMA = object({
  kind: { type: 'string', enum: ['program'] },
  title: text(100),
  objective: text(600, 'What the reader should understand from the visible mathematical change.'),
  code: {
    ...text(
      PROGRAM_LIMITS.code,
      'A JavaScript function expression receiving {t,params,data,theme,math,svg}. t is 0..1 and follows speech. Return svg.scene(content), an SVG string. Use the documented drawing/math helpers, loops and your own functions; no imports, DOM, fetch or independent timers. The runtime executes only isolated WebAssembly.',
    ),
    minLength: 1,
  },
  parameters: {
    type: 'array',
    maxItems: PROGRAM_LIMITS.parameters,
    items: object({
      name: text(40),
      label: text(80),
      value: { type: 'number' },
      min: { type: 'number' },
      max: { type: 'number' },
      step: { type: 'number' },
    }),
  },
  data: {
    type: 'array',
    maxItems: PROGRAM_LIMITS.data,
    items: object({ name: text(40), values: { type: 'array', maxItems: 3000, items: { type: 'number' } } }),
  },
  source: { type: 'string', enum: ['document', 'illustrative'] },
  sourceRefs: { type: 'array', maxItems: 30, items: text(100) },
});
export function programProblems(value: unknown): string[] {
  const x = value as Partial<ProgramItem> | null;
  if (!x || typeof x !== 'object') return ['program: expected a scene object'];
  const problems: string[] = [];
  if (typeof x.code !== 'string' || !x.code.trim() || x.code.length > PROGRAM_LIMITS.code)
    problems.push('program: provide a JavaScript render function of at most 16000 characters');
  if (typeof x.objective !== 'string' || !x.objective.trim()) problems.push('program: state the learning objective');
  if (!['document', 'illustrative'].includes(x.source ?? ''))
    problems.push('program: identify document data or an illustrative calculation');
  if (
    !Array.isArray(x.sourceRefs) ||
    x.sourceRefs.length > 30 ||
    x.sourceRefs.some((id) => typeof id !== 'string' || id.length > 100)
  )
    problems.push('program: sourceRefs must contain source element IDs');
  if (!Array.isArray(x.parameters) || x.parameters.length > PROGRAM_LIMITS.parameters)
    problems.push('program: invalid parameter list');
  else {
    const names = new Set<string>();
    for (const p of x.parameters) {
      if (!p || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(p.name) || names.has(p.name))
        problems.push('program: parameters need distinct simple names');
      else names.add(p.name);
      if (
        !p ||
        ![p.value, p.min, p.max, p.step].every(Number.isFinite) ||
        p.min >= p.max ||
        p.value < p.min ||
        p.value > p.max ||
        p.step <= 0
      )
        problems.push(`program: invalid range for ${p?.name ?? 'parameter'}`);
    }
  }
  if (
    !Array.isArray(x.data) ||
    x.data.length > PROGRAM_LIMITS.data ||
    x.data.some(
      (d) =>
        !d ||
        !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(d.name) ||
        !Array.isArray(d.values) ||
        d.values.length > 3000 ||
        !d.values.every(Number.isFinite),
    )
  )
    problems.push('program: data must be named arrays of finite numbers');
  return problems;
}
