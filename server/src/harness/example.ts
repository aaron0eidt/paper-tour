import { splitWords, type Action, type BoardItem } from '../../../shared/paper';
import { evaluateExpression, parseExpression } from '../../../shared/plot';
import { LEGACY_BOARD_KINDS, boardSchema, checkBoard, numbersIn, type BoardKind } from './board';

export interface ExampleFrame {
  anchor: string;
  at: number;
  item: BoardItem;
}
export interface WorkedExample {
  assumptions: string;
  frames: ExampleFrame[];
}
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

function exampleBoardSchema(kind: BoardKind) {
  const schema = boardSchema(kind);
  if (kind !== 'bars') return schema;
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([name]) => name !== 'higher_is_better'),
  );
  return { ...schema, properties, required: ['title', 'unit', 'bars'] };
}

/**
 * Authoring only. Canonical tours use ordinary timed board actions, so existing players and saved tours work. A step
 * whose plan allots its frames some kinds (visual-plan.ts) offers those only.
 */
export function exampleSchema(kinds: readonly BoardKind[] = LEGACY_BOARD_KINDS) {
  return object({
    assumptions: text(220),
    inputs: { type: 'array', minItems: 1, maxItems: 8, items: object({ label: text(40), value: { type: 'number' } }) },
    calculations: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: object({ expression: text(200), result: { type: 'number' } }),
    },
    frames: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: object(
        { anchor: text(80), ...Object.fromEntries(kinds.map((kind) => [kind, exampleBoardSchema(kind)])) },
        ['anchor'],
      ),
    },
  });
}
export const EXAMPLE_SCHEMA = exampleSchema();

export const EXAMPLE_TASK = `WORKED EXAMPLES: If you introduce a numerical worked case, supply an "example" instead of repeating a symbolic board. Its assumptions state the illustrative special case and held-fixed quantities; say this naturally in the narration. inputs lists the named numerical starting values. calculations lists the actual arithmetic with numerical literals only and its results. Declare every nontrivial numeric operand as an input or an earlier calculation result (-1, 0 and 1 are implicit constants); + - * / ^ and sin, cos, tanh, exp, log, sqrt, abs, relu, sigmoid, min, max, softmax are supported, no variables or code. Prefer readable rounded illustrative results (usually 2–3 decimals, or scientific notation for tiny values), with ≈ for rounded equalities; code retains the exact computed value behind each rounded intermediate reference for later calculations. Never fill a formula or label with a floating-point tail or manually invent eight-digit precision. Keep the paper’s reported measurements exact. Non-integer results may be rounded to the precision shown; keep integer results exact. Superscript/layer indices are notation, not measured quantities: do not turn a symbolic indexed term into a fake scalar calculation.
Use 2–4 frames, including at least one useful native flow, bars, plot or scene that visually demonstrates the mechanism (not only formula/text cards). Each frame has an anchor copied exactly from say and exactly ONE native item named formula, flow, bars, plot or scene (same fields as those boards). Prefer spatial and value transformations over a series of formula cards, and choose each frame's kind by what it shows, never by habit: a plot for how a function responds, a scene for vectors or geometry, a flow for a process, a formula when the substitution itself is the lesson, and bars only for a few comparable quantities of one unit. The brief lists the kinds this step's frames may use; the tour counts frames toward its limit of each kind. For vector/matrix transformations or an illustration combining plots and moving quantities, choose a scene with stable objects and meaningful position/value changes. For a function example, make its behavior visible with a curve and data-bound sample points or a genuine component transformation. A one-cell matrix around a number followed by formula cards is not a meaningful animation. For quantitative vectors use a shared embedded plot with labeled axes and plotId-bound vectors, preserving the original vector alongside the transformed vector. Keep a stable origin, domain and object IDs across frames; do not replace one isolated arrow with another or silently rescale each state. Keep semantic labels consistent across states: preserve flow node IDs/order/edges for the same process and formula term labels for the same quantities when substituting values. Reusing those roles lets the live objects transform continuously. Use a formula card when the actual substitution itself is what teaches the mechanism. Show the concrete starting values, then a visibly changed calculation/output or a meaningful before/after comparison. The first frame explicitly shows the declared starting values, including their signs; preserve this input frame while repairing later states. The last shows a computed result explicitly in formula, flow, bars, or scene text/matrices. Bars support signed values around a zero baseline; preserve input and result signs. A plot may be an intermediate behavior frame, but axis limits alone do not display an example result. A title change or another highlight on the original symbolic equation is not a new state. Illustrative bars show inputs/intermediate values, not a quality ranking: omit higher_is_better, so no value is falsely labelled best. Keep the same ordered bar labels and the same unit when comparing successive states of the same quantity; different quantities need different units. Use illustrative titles, and never mix invented values with the paper's reported measurements. Formula terms and flow nodes can show concrete substitutions; bars may use the declared inputs and checked results. Each frame begins at its spoken anchor, in increasing order, with enough explanation to read it. Where the cue schema offers board_focus, its cues may name term-1, node-1, bar-1 or curve-1 etc of the frame active at their spoken anchor. Omit example when explaining a source diagram path without invented numerical values. FINAL CONSISTENCY CHECK before responding: read the narration against each frame in order. Every spoken input, sign, vector dimension, operation and result must match the actual displayed objects and checked calculations. When repairing frames, revise say and its anchors too; never preserve stale narration from an earlier example or describe a vector when the frame actually shows unrelated scalar cases. Prefer one coherent transformation with stable quantities over several disconnected demonstrations. Keep schema details out of say.`;

const raw = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter(raw) : []);
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
// Example arithmetic can legitimately express large operation counts; plot domains keep their own default guard.
const arithmetic = (source: string) => parseExpression(source, { maxConstant: Number.MAX_VALUE });
type ExactValues = ReadonlyMap<number, number>;
/** Carry exact results behind rounded references through a multi-stage example. */
function resolvedArithmetic(source: string, exact: ExactValues) {
  const resolve = (node: ReturnType<typeof arithmetic>): ReturnType<typeof arithmetic> => {
    if ('value' in node) return { value: exact.get(node.value) ?? node.value };
    if ('args' in node) {
      if (node.op === 'neg' && 'value' in node.args[0] && exact.has(-node.args[0].value))
        return { value: exact.get(-node.args[0].value)! };
      return { ...node, args: node.args.map(resolve) };
    }
    return node;
  };
  return resolve(arithmetic(source));
}
const same = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));
const precision = (n: number) => {
  if (Number.isInteger(n)) return Number.EPSILON * Math.abs(n) * 16;
  const [mantissa, power = '0'] = String(n).toLowerCase().split('e');
  const decimals = mantissa.split('.')[1]?.length ?? 0;
  return 0.5 * 10 ** (Number(power) - decimals);
};
const displayed = (shown: number, value: number) => same(shown, value) || Math.abs(shown - value) <= precision(shown);

/** Exact anchors prevent successive frames collapsing to the same initial word. */
function anchorWord(say: string, anchor: string): number | null {
  const token = (s: string) =>
    s
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const words = splitWords(say).map(token),
    phrase = splitWords(anchor).map(token);
  if (!phrase.length || !phrase.some(Boolean)) return null;
  const at = words.findIndex((_, i) => phrase.every((w, j) => words[i + j] === w));
  return at < 0 ? null : at;
}

function visibleText(item: BoardItem): string[] {
  if (item.kind === 'scene')
    return item.objects.flatMap((object) =>
      object.text ? [object.text.replace(/_(?:\{[^}]*\}|[\p{L}\p{N}])/gu, '')] : [],
    );
  if (item.kind === 'formula') return [item.latex.replace(/_(?:\{[^}]*\}|[\p{L}\p{N}])/gu, '')];
  if (item.kind === 'flow') return item.nodes.map((n) => n.label);
  if (item.kind === 'bars') return item.bars.map((b) => b.label);
  if (item.kind === 'plot') return item.curves.map((c) => c.label);
  return []; // Frames only use the kinds in LEGACY_BOARD_KINDS.
}
function visibleNumbers(item: BoardItem): number[] {
  const labels = visibleText(item)
    .map((text) =>
      text
        .replace(/\b(?:key|head|token|node|component|layer|position)\s+\d+\b/gi, '')
        .replace(
          /([+−-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:\\times|\\cdot|[×*])\s*10\s*\^\s*\{?([+−-]?\d+)\}?/g,
          (_, value, power) => `${value}e${power.replace('−', '-')}`,
        )
        .replace(/\\[A-Za-z]+/g, ' ')
        .replace(/\^\s*(?:\{\(?[+−-]?\d+\)?\}|\([+−-]?\d+\)|[+−-]?\d+)/g, ''),
    )
    .flatMap((text) =>
      [...text.matchAll(/(?<![\p{L}\p{N}_])[+−-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![\p{L}\p{N}_])/giu)].map(
        (match) => {
          const value = Number(match[0].replace('−', '-'));
          return value < 0 && /[\p{L}\p{N})\]]/u.test(text[(match.index ?? 0) - 1] ?? '') ? -value : value;
        },
      ),
    );
  if (item.kind === 'scene')
    return [
      ...item.objects.flatMap((object) => [
        ...(object.values?.flat() ?? []),
        ...(object.plotId && object.type === 'vector'
          ? [object.x, object.y, object.x + object.w, object.y + object.h]
          : []),
      ]),
      ...labels,
    ];
  if (item.kind === 'bars') return [...item.bars.map((b) => b.value), ...labels];
  if (item.kind === 'plot') return labels; // Axis ranges are not claimed computed values.
  return labels;
}

/** Read numerical content even if independent layout validation rejected this frame. Never published. */
function readableFrame(kind: BoardKind, item: Record<string, unknown>): BoardItem {
  if (kind === 'formula') return { kind, latex: clean(item.latex), terms: [] };
  if (kind === 'flow')
    return {
      kind,
      nodes: rows(item.nodes).map((node) => ({ id: clean(node.id), label: clean(node.label) })),
      edges: [],
    };
  if (kind === 'bars')
    return {
      kind,
      bars: rows(item.bars).map((bar) => ({ label: clean(bar.label), value: finite(bar.value) ? bar.value : NaN })),
    };
  if (kind === 'plot')
    return {
      kind,
      curves: rows(item.curves).map((curve) => ({ label: clean(curve.label), expression: '' })),
      x: [0, 1],
      y: [0, 1],
    };
  return {
    kind: 'scene',
    objects: rows(item.objects).map((object) => ({
      id: clean(object.id),
      type: 'text',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      text: clean(object.text),
      values: Array.isArray(object.values)
        ? object.values.filter(Array.isArray).map((row) => row.filter(finite))
        : undefined,
    })),
  };
}

/** Check literal numerical equalities too, rather than merely accepting that their digits were declared. */
function displayedCalculationProblems(item: BoardItem, exact: ExactValues): string[] {
  const problems: string[] = [];
  for (const source of visibleText(item)) {
    let text = source
      .replace(/\\(?:cdot|times)/g, '*')
      .replace(/\\(?:div)/g, '/')
      .replace(/\\(?:left|right)/g, '')
      .replace(/\\(?:approx|simeq)/g, '=')
      .replace(/,\s*\\(?:quad|qquad|\s)/g, ';')
      .replace(/[−–]/g, '-')
      .replace(/≈/g, '=');
    for (let i = 0; i < 4; i++) text = text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)');
    text = text
      .replace(/\\sqrt\{([^{}]+)\}/g, 'sqrt($1)')
      .replace(/\\(?:mathrm|text|operatorname)\{([^{}]+)\}/g, '$1')
      .replace(/[{}]/g, '')
      .replace(/\\(sin|cos|tanh|exp|log|sqrt|abs|relu|sigmoid|min|max|softmax)\b/gi, '$1');
    // Comma-separated parameter assignments are separate statements, not chains.
    // Split only at top level: commas inside max/softmax or tuples belong to
    // their expression, while "8/8=1, 6/8=.75" contains two equations.
    const statements: string[] = [];
    let depth = 0,
      start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(' || text[i] === '[') depth++;
      else if (text[i] === ')' || text[i] === ']') depth--;
      else if (depth === 0 && (text[i] === ',' || text[i] === ';')) {
        statements.push(text.slice(start, i));
        start = i + 1;
      }
    }
    statements.push(text.slice(start));
    for (const statement of statements.flatMap((s) => s.split(';'))) {
      // Display LaTeX supports vectors/matrices; the scalar expression grammar
      // intentionally does not. Their numeric inputs/results are checked by
      // provenance and the explicit calculations, not by parsing display math
      // as scalar code. Scalar equalities below are still evaluated directly.
      if (/\[|\\begin\{(?:[bpvV]?matrix|array)\}/.test(statement)) continue;
      const sides = statement.split('=');
      for (let i = 1; i < sides.length; i++) {
        const right = sides[i]
          .trim()
          .toLowerCase()
          .replace(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s+[a-z][a-z ]*$/, '$1');
        // Tuples are not scalar equalities. Their individual values still pass
        // the example's declared-input and checked-result provenance checks.
        if (/^\([^()]*,[^()]*\)$/.test(right)) continue;
        if (
          !/^(?:[+\-]?(?:\d|\.\d)|\(|(?:sin|cos|tanh|exp|log|sqrt|abs|relu|sigmoid|min|max|softmax)\s*\()/i.test(
            right,
          ) ||
          !/\d/.test(sides[i - 1])
        )
          continue;
        const left = sides[i - 1].trim().toLowerCase();
        // A layer/symbol index is not an executable numerical expression.
        if (
          /^[a-z\\]/i.test(left) &&
          !/^(?:sin|cos|tanh|exp|log|sqrt|abs|relu|sigmoid|min|max|softmax)\s*\(/i.test(left)
        )
          continue;
        const start = /\b(?:sin|cos|tanh|exp|log|sqrt|abs|relu|sigmoid|min|max|softmax)\s*\(|[+\-]?(?:\d|\.\d)|\(/.exec(
          left,
        );
        if (!start) continue;
        const expression = left.slice(start.index).trim();
        const prefix = left.slice(0, start.index);
        const unknownFunction = start[0] === '(' && /[a-z_]\s*$/.test(prefix);
        let problem: string | null;
        if (unknownFunction) problem = 'use a supported explicit numerical function';
        else if (/^[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+\-]?\d+)?$/i.test(right))
          problem = checkedCalculation(expression, Number(right), exact);
        else {
          try {
            const a = resolvedArithmetic(expression, exact),
              b = resolvedArithmetic(right, exact);
            const variables = (node: typeof a): boolean =>
              'variable' in node || ('args' in node && node.args.some(variables));
            if (variables(a) || variables(b)) problem = 'show concrete numerical substitutions on both sides';
            else
              problem = same(evaluateExpression(a, 0), evaluateExpression(b, 0))
                ? null
                : 'the two numerical expressions do not match';
          } catch {
            problem = 'use explicit numerical expressions that can be checked on both sides';
          }
        }
        if (problem) problems.push(`Visible calculation ${sides[i - 1].trim()} = ${right}: ${problem}.`);
      }
    }
  }
  return problems;
}

const visual = (item: BoardItem) => {
  if (item.kind === 'formula') return `formula:${item.latex.replace(/\s+/g, '')}`;
  const { title: _title, ...body } = item;
  return JSON.stringify(body);
};

type CalculationCheck = { error: string } | { error: null; value: number };

/** Validate once and carry the same exact value into later calculations. */
function checkCalculation(expression: string, result: number, exact: ExactValues): CalculationCheck {
  if (!Number.isFinite(result)) return { error: 'result must be finite' };
  try {
    const tree = resolvedArithmetic(expression, exact);
    const variables = (node: typeof tree): boolean =>
      'variable' in node || ('args' in node && node.args.some(variables));
    if (variables(tree)) return { error: 'use concrete numerical literals, not undeclared x or a' };
    const actual = evaluateExpression(tree, 0);
    // A written rounded substitution can deliberately use the displayed literals.
    const literal = evaluateExpression(arithmetic(expression), 0);
    if (!Number.isFinite(actual)) return { error: 'the calculation has no finite result' };
    const tolerance = Math.max(
      precision(result),
      Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(result)) * 16,
    );
    if (Math.abs(actual - result) <= tolerance) return { error: null, value: actual };
    if (Math.abs(literal - result) <= tolerance) return { error: null, value: literal };
    return { error: `result ${result} does not match ${expression} (approximately ${Number(actual.toPrecision(8))})` };
  } catch {
    return { error: 'use a valid bounded arithmetic expression with concrete numbers and supported functions' };
  }
}

/** Existing bounded parser only; callers needing a diagnostic do not receive an unchecked number. */
export function checkedCalculation(expression: string, result: number, exact: ExactValues = new Map()): string | null {
  return checkCalculation(expression, result, exact).error;
}

/** Only clear claims of a numerical worked case trigger a required sequence; printed paper results do not. */
export function claimsNumericExample(say: string): boolean {
  return (
    /\b(?:illustrative|toy|worked (?:case|example)|for example|suppose|consider (?:an? )?example|zum beispiel|beispielhaft)\b/iu.test(
      say,
    ) &&
    numbersIn(say).length +
      [...say.matchAll(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|zero|eins|zwei|drei|vier|null)\b/giu)]
        .length >=
      2
  );
}

export function checkExample(
  value: unknown,
  say: string,
  required = false,
  frameKinds: readonly BoardKind[] = LEGACY_BOARD_KINDS,
): { example?: WorkedExample; problems: string[] } {
  if (value !== undefined && !raw(value))
    return {
      problems: [
        'An authored example must be an object with inputs, calculations and frames; malformed content cannot be discarded.',
      ],
    };
  if (!raw(value))
    return {
      problems: required
        ? [
            'This numerical worked example needs example frames showing actual inputs, transformation and result; a repeated symbolic formula is insufficient.',
          ]
        : [],
    };
  const problems: string[] = [];
  const assumptions = clean(value.assumptions);
  if (!assumptions || assumptions.length > 220)
    problems.push(
      'Example assumptions must clearly name the illustrative special case and held-fixed quantities (1–220 characters).',
    );
  for (const key of ['inputs', 'calculations', 'frames'])
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((entry) => !raw(entry)))
      problems.push(`Example ${key} must be an array of objects; every authored entry must be valid.`);
  const inputs = rows(value.inputs),
    calculations = rows(value.calculations),
    frames = rows(value.frames);
  if (!inputs.length || inputs.length > 8 || inputs.some((i) => !clean(i.label) || !finite(i.value)))
    problems.push('Declare 1–8 named finite illustrative input values.');
  if (!calculations.length || calculations.length > 10)
    problems.push('Declare 1–10 concrete calculations and their results.');
  const results: number[] = [];
  const exact = new Map<number, number>();
  const operands = [-1, 0, 1, Math.PI, Math.E, ...inputs.flatMap((i) => (finite(i.value) ? [i.value] : []))];
  for (const [i, c] of calculations.entries()) {
    let literals: number[] = [];
    try {
      const tree = arithmetic(clean(c.expression));
      const collect = (node: typeof tree): number[] =>
        'value' in node
          ? [node.value]
          : 'args' in node
            ? node.op === '^' && 'value' in node.args[1]
              ? collect(node.args[0]) // A literal power is an operation, not an extra illustrative datum.
              : node.args.flatMap(collect)
            : [];
      literals = collect(tree);
    } catch {
      /* checkedCalculation below returns the parser error. */
    }
    const undeclared = literals.find((n) => !operands.some((v) => same(n, v) || same(n, -v)));
    if (undeclared !== undefined)
      problems.push(
        `Example calculation ${i + 1} uses undeclared value ${undeclared}; name it as an input or derive it in an earlier calculation.`,
      );
    const checked = checkCalculation(clean(c.expression), finite(c.result) ? c.result : NaN, exact);
    if (checked.error !== null) problems.push(`Example calculation ${i + 1}: ${checked.error}.`);
    else {
      results.push(c.result as number);
      operands.push(c.result as number);
      exact.set(c.result as number, checked.value);
    }
  }
  if (frames.length < 2 || frames.length > 4)
    problems.push('Give 2–4 example frames: actual inputs followed by changed calculation/output or comparison.');
  const evidence = [-1, 0, 1, ...inputs.flatMap((i) => (finite(i.value) ? [i.value] : [])), ...results].join(' ');
  const checked: ExampleFrame[] = [];
  const previews: (BoardItem | undefined)[] = [];
  let previousAnchor: number | null = null;
  for (const [i, frame] of frames.entries()) {
    const kinds = LEGACY_BOARD_KINDS.filter((kind) => raw(frame[kind]));
    if (kinds.length !== 1) {
      problems.push(`Example frame ${i + 1} must contain exactly one formula, flow, bars, plot or scene item.`);
      continue;
    }
    const kind: BoardKind = kinds[0];
    if (!frameKinds.includes(kind))
      problems.push(
        `Example frame ${i + 1} is a ${kind}, which this step's frames may not use; use ${frameKinds.join(', ')}.`,
      );
    const itemRaw = frame[kind] as Record<string, unknown>;
    if (kind === 'bars' && itemRaw.higher_is_better !== undefined)
      problems.push(`Example frame ${i + 1}: illustrative values are not a quality ranking; omit higher_is_better.`);
    const allowedValues = [-1, 0, 1, ...inputs.flatMap((i) => (finite(i.value) ? [i.value] : [])), ...results];
    const roundedBars =
      kind === 'scene'
        ? rows(itemRaw.objects)
            .flatMap((object) => (Array.isArray(object.values) ? object.values.flat() : []))
            .filter((value): value is number => finite(value) && allowedValues.some((n) => displayed(value, n)))
        : kind === 'bars'
          ? rows(itemRaw.bars).flatMap((bar) =>
              finite(bar.value) && allowedValues.some((n) => displayed(bar.value as number, n)) ? [bar.value] : [],
            )
          : [];
    const result = checkBoard(
      kind,
      { ...itemRaw, title: clean(itemRaw.title) || 'Illustrative example' },
      `${evidence} ${roundedBars.join(' ')}`,
    );
    problems.push(...result.problems.map((p) => `Example frame ${i + 1}: ${p}`));
    if (!result.item && !result.problems.length) problems.push(`Example frame ${i + 1} is empty.`);
    // Keep readable values from a malformed board in the repair report too: fixing its
    // layout must not reveal an avoidable second input/result error on the final attempt.
    const preview = result.item ?? readableFrame(kind, itemRaw);
    previews[i] = preview;
    const anchor = clean(frame.anchor),
      at = anchorWord(say, anchor);
    if (at === null) problems.push(`Example frame ${i + 1} needs an exact anchor from say.`);
    else if (previousAnchor !== null && at <= previousAnchor)
      problems.push('Example frame anchors must progress through the narration, never at the same word or backwards.');
    if (at !== null) previousAnchor = at;
    if (preview) {
      const allowed = [-1, 0, 1, ...inputs.flatMap((i) => (finite(i.value) ? [i.value] : [])), ...results];
      // In a subtraction, the positive written operand may be the magnitude
      // of a declared negative bias (e.g. x*0.5 - 1.5 for b=-1.5).
      const subtracted = visibleText(preview).flatMap((text) =>
        [...text.matchAll(/[\d)]\s*[-−]\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1])),
      );
      const unsupported = visibleNumbers(preview).find(
        (n) => !allowed.some((v) => displayed(n, v) || (v < 0 && subtracted.includes(n) && displayed(n, -v))),
      );
      if (unsupported !== undefined)
        problems.push(
          `Example frame ${i + 1} displays undeclared value ${unsupported}; show only input values or checked results.`,
        );
      problems.push(...displayedCalculationProblems(preview, exact).map((p) => `Example frame ${i + 1}: ${p}`));
    }
    if (result.item && at !== null) checked.push({ anchor, at, item: result.item });
  }
  if (checked.length >= 2) {
    if (
      !checked.some(
        (frame) =>
          frame.item.kind !== 'formula' &&
          (frame.item.kind !== 'scene' ||
            frame.item.objects.some(
              (object) =>
                !object.background &&
                (['plot', 'vector'].includes(object.type) ||
                  (object.type === 'matrix' && (object.values?.flat().length ?? 0) > 1) ||
                  (['rect', 'circle'].includes(object.type) &&
                    frame.item.kind === 'scene' &&
                    frame.item.objects.some((other) => other.type === 'arrow'))),
            )),
      )
    )
      problems.push(
        'A worked example must visually demonstrate the mechanism with at least one flow, bars, plot or substantive scene frame, not only formula cards or isolated scalar matrices. For function behavior use a plot with the actual curve and data-bound sample markers; for component transformations show a genuine vector/matrix or a connected operation diagram.',
      );
    if (new Set(checked.map((f) => visual(f.item))).size !== checked.length)
      problems.push(
        'Each example frame must change visible values, calculations or structure; new titles or term labels alone are not a worked transformation.',
      );
  }
  if (frames.length) {
    const first = previews[0],
      last = previews[frames.length - 1];
    if (first?.kind === 'plot' || last?.kind === 'plot')
      problems.push(
        'First and final example frames must show concrete inputs/results in formula, flow, bars or scene text/matrices; plot axis bounds alone do not demonstrate a calculation.',
      );
    if (!first || !visibleNumbers(first).some((n) => inputs.some((i) => finite(i.value) && displayed(n, i.value))))
      problems.push(
        `The first example frame must visibly contain declared starting values (${inputs
          .filter((i) => finite(i.value))
          .map((i) => `${clean(i.label)} = ${i.value}`)
          .join(
            ', ',
          )}). Show these in frame 1 and preserve them while fixing other frames; a symbolic parent formula or later input frame is insufficient.`,
      );
    if (!last || !visibleNumbers(last).some((n) => results.some((r) => displayed(n, r))))
      problems.push('The final example frame must visibly contain a checked computed result.');
  }
  return problems.length ? { problems } : { example: { assumptions, frames: checked }, problems: [] };
}

export function exampleActions(example: WorkedExample): Action[] {
  return example.frames.map((frame) => ({
    type: 'board',
    item: frame.item,
    ...(frame.at ? { at_word: frame.at } : {}),
  }));
}
