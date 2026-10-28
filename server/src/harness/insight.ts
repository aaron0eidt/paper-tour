import type { Action, BBox, Doc, Region, Step } from '../../../shared/paper';

const words = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized = (s: string) => words(s).join(' ');

/** Detect decoder padding without banning multilingual joiners, actual numbers,
 * or mathematical notation. Return repair feedback; never silently trim say. */
export function narrationProblems(say: string): string[] {
  const problems: string[] = [];
  if (/\p{Cf}{8,}/u.test(say))
    problems.push(
      'Narration contains a long run of invisible formatting characters. Rewrite clean spoken prose without padding; normal language-specific joiners are allowed.',
    );
  if (/\s{64,}/u.test(say))
    problems.push(
      'Narration contains a long whitespace padding run. Return the complete explanation with ordinary spacing; do not fill the character limit.',
    );
  // Observed constrained-decoding failure: a complete sentence followed by many
  // long near-constant integers. Decimal expansions, equations and patterned
  // binary examples do not meet this combined suffix/repetition condition.
  const suffix = /[.!?。！？]\s+([\d\s]{80,})\s*$/u.exec(say)?.[1];
  if (suffix) {
    const runs = suffix.match(/\d{12,}/g) ?? [];
    const repetitive = runs.filter((run) => {
      const frequency = new Map<string, number>();
      for (const digit of run) frequency.set(digit, (frequency.get(digit) ?? 0) + 1);
      return /(\d)\1{7,}/u.test(run) && Math.max(...frequency.values()) / run.length >= 0.75;
    });
    if (repetitive.length >= 3 && repetitive.reduce((n, run) => n + run.length, 0) >= 60)
      problems.push(
        'Narration ends in repeated digit filler after its explanation. Rewrite the explanation without padding; keep only meaningful numerical values with their interpretation.',
      );
  }
  return problems;
}

/** Near-verbatim detail steps add length without teaching another idea. */
export function repeatsExplanation(detail: string, overview: string): boolean {
  const a = words(detail),
    b = words(overview);
  if (Math.min(a.length, b.length) < 12) return normalized(detail) === normalized(overview);
  const grams = (w: string[], n: number) => w.slice(0, 1 - n).map((_, i) => w.slice(i, i + n).join(' '));
  const overlap = (n: number) => {
    const left = grams(a, n),
      right = new Set(grams(b, n));
    return left.filter((g) => right.has(g)).length / Math.max(1, left.length);
  };
  return overlap(3) >= 0.45 || overlap(2) >= 0.65;
}

/** Find copied wording from known internal constraints, not generic words such
 * as "JSON" or "animation" that may be legitimate subject matter. Callers must
 * supply only non-spoken authoring instructions, never source text, examples,
 * or desired narration from the rest of the prompt.
 */
function copiedAuthoringPhrase(say: string, instructions: readonly string[]): string | null {
  const spoken = ` ${normalized(say)} `;
  for (const instruction of instructions) {
    const tokens = words(instruction);
    // Short commands only match in full. Longer constraints can be copied with
    // a changed introductory clause, so look for an exact eight-word phrase.
    if (tokens.length < 5) continue;
    const size = Math.min(8, tokens.length);
    for (let i = 0; i <= tokens.length - size; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (spoken.includes(` ${phrase} `)) return phrase;
    }
  }
  return null;
}

/** Only direct viewer instructions promise a visual here. Ordinary discussion
 * of video models or a figure in the paper is not a rendering requirement. */
function promisedVisual(say: string): 'video' | 'illustration' | null {
  const noun = '(animation|illustration|video|clip|veranschaulichung)';
  const english = new RegExp(
    `(?:^|[.!?]\\s+)(?:(?:now|next|please|then)\\s+)?(?:watch|look at|observe)\\s+(?:the|this|our)\\s+(?:(?:short|following|animated)\\s+)?${noun}\\b`,
    'giu',
  );
  const german = new RegExp(
    `(?:^|[.!?]\\s+)(?:(?:jetzt|nun|bitte)\\s+)?(?:(?:schau|schaue|sieh|betrachte|beobachte)(?:\\s+dir)?|(?:sehen|schauen|betrachten|beobachten)\\s+sie(?:\\s+sich)?)\\s+(?:die|diese|das|dieses|den|diesen)\\s+(?:(?:kurze[n]?|folgende[n]?)\\s+)?${noun}\\b`,
    'giu',
  );
  const nouns = [...say.matchAll(english), ...say.matchAll(german)]
    .filter((match) => {
      const illustration = ['illustration', 'veranschaulichung'].includes(match[1].toLocaleLowerCase());
      const after = say.slice((match.index ?? 0) + match[0].length);
      const sourceFigure =
        /^\s+(?:(?:in|from)\s+(?:(?:the|this)\s+)?(?:paper|document|article|figure|fig\b)|im\s+(?:paper|dokument|artikel)|in\s+(?:der|dieser)\s+abbildung)\b/iu.test(
          after,
        );
      return !(illustration && sourceFigure);
    })
    .map((match) => match[1].toLocaleLowerCase());
  if (nouns.some((value) => ['video', 'clip'].includes(value))) return 'video';
  return nouns.length ? 'illustration' : null;
}

/** Actionable repair feedback; never silently delete or rewrite the narration.
 * Keep native visuals alongside the explanation that needs them; do not repeat
 * an explanation just to introduce a separate visual step.
 */
export function answerNarrationProblems(
  steps: readonly { say: string; actions?: readonly Action[] }[],
  authoringInstructions: readonly string[],
): string[] {
  const problems: string[] = [];
  steps.forEach((step, index) => {
    problems.push(...narrationProblems(step.say).map((problem) => `Step ${index + 1}: ${problem}`));
    const copied = copiedAuthoringPhrase(step.say, authoringInstructions);
    if (copied)
      problems.push(
        `Step ${index + 1} copies an internal authoring instruction ("${copied}"). Rewrite its narration for the learner; keep schema and rendering decisions in the structured fields, not in say.`,
      );
    const promised = promisedVisual(step.say);
    const provided = promised === 'illustration' && (step.actions ?? []).some((action) => action.type === 'board');
    if (promised && !provided)
      problems.push(
        `Step ${index + 1} tells the learner to watch ${promised === 'video' ? 'a video/clip' : 'an illustration'}, but this same step has no ${promised === 'video' ? 'video (this reader uses native visual boards)' : 'visual board'}. Use a native visual in this step, or remove the unsupported viewing promise and explain the idea directly. A visual in a different step does not satisfy this promise.`,
      );
    if (!words(step.say).length) return;
    const earlier = steps
      .slice(0, index)
      .findIndex((previous) => words(previous.say).length > 0 && repeatsExplanation(step.say, previous.say));
    if (earlier >= 0)
      problems.push(
        `Step ${index + 1} substantially repeats step ${earlier + 1}. Combine their useful visuals with one explanation, or give the later step a genuinely new worked example or consequence; do not narrate the same explanation twice.`,
      );
  });
  return problems;
}

/** Extracted labels inside the graphic, plus its caption. No OCR or document-specific vocabulary. */
export function printedAt(doc: Doc, target: string, region?: Region): string {
  const figure = doc.figures.find((f) => f.id === target || f.panels.some((p) => p.id === target));
  if (!figure) return '';
  const panel = figure.panels.find((p) => p.id === target);
  const box = panel?.bbox ?? figure.bbox;
  const [x0, y0, x1, y1] = box;
  const area: BBox = region
    ? [x0 + region[0] * (x1 - x0), y0 + region[1] * (y1 - y0), x0 + region[2] * (x1 - x0), y0 + region[3] * (y1 - y0)]
    : box;
  const inside = (b: BBox) =>
    (b[0] + b[2]) / 2 >= area[0] &&
    (b[0] + b[2]) / 2 <= area[2] &&
    (b[1] + b[3]) / 2 >= area[1] &&
    (b[1] + b[3]) / 2 <= area[3];
  return [
    figure.caption,
    panel?.label ?? '',
    ...doc.blocks.filter((b) => b.page === figure.page && inside(b.bbox)).map((b) => b.text),
  ].join('\n');
}

export function repeatsPrinted(label: string, printed: string): boolean {
  const a = normalized(label),
    b = normalized(printed);
  if (!a || !b) return false;
  return ` ${b} `.includes(` ${a} `);
}

/** A long almost-verbatim reading of the source is repaired once, like an invalid board. */
export function readsSource(say: string, doc: Doc): boolean {
  const spoken = words(say);
  if (spoken.length < 16) return false;
  const source = new Set(
    doc.sentences.flatMap((s) => {
      const w = words(s.text);
      return w.slice(0, -3).map((_, i) => w.slice(i, i + 4).join(' '));
    }),
  );
  const copied = spoken.slice(0, -3).filter((_, i) => source.has(spoken.slice(i, i + 4).join(' '))).length;
  return copied / (spoken.length - 3) >= 0.8;
}

/** Shared final guard for authored tours and Q&A: a mark can stay useful without repeating its printed name. */
export function insightStep(step: Step, doc: Doc): Step {
  const actions = step.actions.flatMap((a): Action[] => {
    if (a.type === 'spotlight') {
      const sentence = doc.sentences.find((s) => s.id === a.target);
      const block = doc.blocks.find((b) => b.id === a.target);
      const targets = sentence ? [sentence.id] : (block?.sentences ?? []);
      if (targets.length)
        return [
          { type: 'highlight', targets, color: 'blue', ...(a.at_word !== undefined ? { at_word: a.at_word } : {}) },
        ];
    }
    if (
      (a.type === 'arrow' || a.type === 'circle' || a.type === 'box') &&
      a.label &&
      repeatsPrinted(a.label, printedAt(doc, a.target, a.region))
    ) {
      const { label: _label, ...mark } = a;
      return [mark];
    }
    return [a];
  });
  return { ...step, actions };
}
