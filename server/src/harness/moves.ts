// Narration moves (notes/ROADMAP.md, wave 2): every step of a claim-organised paper tour has one job in the argument,
// and the voice follows that job's grammar: the conclusion first, one "because", a number only with the thing it is
// compared with, and never an echo of the highlighted text. The plan assigns the move; code checks what it can.

/** What a step does in a claim's argument. */
export const MOVES = ['thesis', 'change', 'why', 'evidence', 'catch', 'takeaway'] as const;
export type Move = (typeof MOVES)[number];

interface MoveSpec {
  /** The step's job in the tour, quoted in its brief. */
  role: string;
  /** The spoken words it aims for: fewest and most. */
  words: [number, number];
}

export const MOVE_SPECS: Record<Move, MoveSpec> = {
  thesis: {
    role: 'Open the tour. Say in one plain sentence what the document does and the problem it answers, then name its main claims in one short clause each, in the order the tour takes them. Do not explain any claim yet.',
    words: [30, 60],
  },
  change: {
    role: 'What changed. State the claim as a conclusion first, then say what it replaces or improves on (the old way or the baseline) in one more sentence. No evidence yet: it comes in a later step.',
    words: [35, 65],
  },
  why: {
    role: 'Why it should work. Give one "because": the mechanism or reason that turns the change into the effect, in your own words, with the intuition the text leaves implicit. Do not repeat the claim and do not give results.',
    words: [40, 80],
  },
  evidence: {
    role: 'The evidence and how far it reaches. Name the experiment, the metric and the comparison, then the values with their difference; then say what the evidence covers (the settings and data it was tested on) and what it does not show. Every number comes with the thing it is compared with.',
    words: [40, 75],
  },
  catch: {
    role: 'The catch. Say where the claim stops holding or what the authors admit, attributing it to them, and what the learner should not conclude as a result. One honest consequence, no drama, and no catch the text does not state.',
    words: [30, 60],
  },
  takeaway: {
    role: 'Close with the claims in one breath: what each lets the reader conclude and how far it reaches. Do not repeat the catches, which were told already.',
    words: [35, 65],
  },
};

/** The rules every move shares, appended to the direction task of a step that has one. */
export const MOVE_RULES =
  'NARRATION MOVE: the conclusion comes first, then one "because". Never open with "The authors" or "This paper", never read out the labels of a figure or table the learner is looking at, never define a term the tour already explained, and give a number only together with what it is compared with. Stay inside the step\'s job; the other moves have their own steps.';

const OPENER =
  /^\s*["“]?(?:the\s+authors?|the\s+paper|this\s+paper|in\s+this\s+(?:paper|work)|the\s+study|this\s+(?:work|study)|die\s+autor(?:en|innen)?|das\s+paper|diese\s+arbeit|l['’]?\s*article|les\s+auteurs|los\s+autores|el\s+art[ií]culo)\b/i;
const COMPARATOR =
  /\b(than|versus|vs\.?|against|compared|compare|comparison|baseline|previous|prior|earlier|before|beats?|beat|improv\w*|higher|lower|better|worse|more|less|fewer|faster|slower|cheaper|above|below|over|from\b.*\bto|instead of|gegenüber|verglichen|im vergleich|besser|schlechter|höher|niedriger|mehr|weniger|statt|contre|par rapport|mieux|plus de|moins de|frente a|comparado|mejor|peor|más|menos)\b/i;
const MEASURE = /\d+[.,]\d+|\d+\s?%/;

/**
 * Faults of a step's narration against its move, worded as an instruction for one repair turn; empty when it follows
 * the grammar. A step without a move has none. The checks are deliberately light: an opener the grammar bans, and, for
 * the evidence move, a measured value with no comparison anywhere in the step.
 */
export function moveProblems(say: string, move: Move | undefined): string[] {
  if (!move) return [];
  const problems: string[] = [];
  if (OPENER.test(say))
    problems.push('Do not open with "The authors" or "This paper": lead with the point itself, as a plain statement.');
  if (move === 'evidence' && MEASURE.test(say) && !COMPARATOR.test(say))
    problems.push(
      'A number needs its comparison: say what each value is compared with (the baseline, the previous best or the other setting) and by how much.',
    );
  return problems;
}
