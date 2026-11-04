import type { Subject } from './card';
import type { SolveKind } from './exercise';

// The worked examples of the solve call (notes/TUTOR.md, "Subjects" and "Flow"): a weak model copies the format, the
// depth and the openings of its example, so each subject gets one complete first part of a task in schema v3 (read, the
// tools with their laws, a checkpoint whose hints never give the result, a method when the steps do not say it, granular
// solution lines, the answer, a check with its check line, a pitfall), a short explanation part comes with it, and a part
// that goes on from an earlier one gets a follow-on part. They differ on purpose: the tools are one or two, the checkpoint
// and the method come and go, the steps are three or four and open in different ways, and none opens with "Given" or "We
// are given". The sentence IDs are made up, as in any example for a different exercise; a test holds each example to the
// same checks as a real answer.

/** A board line of an example: its LaTeX, and the terms the narration lights up with the phrase that names each. */
export interface ExampleLine {
  title: string;
  latex: string;
  terms: { latex: string; label: string; anchor: string }[];
}
export interface ExampleTool {
  concept: string;
  say: string;
  recall: string;
  formula: ExampleLine;
}
export interface SolveExample {
  plan: string;
  kind: SolveKind;
  read: {
    say: string;
    given: string[];
    given_anchor: string;
    asked: string[];
    asked_anchor: string;
    marks: { target: string; anchor: string }[];
  };
  tools: ExampleTool[];
  method: { say: string; formula: ExampleLine };
  steps: (ExampleLine & { say: string; sure: boolean })[];
  answer: ExampleLine & { say: string };
  check: { say: string; latex: string };
  pitfall: string;
  try: { prompt: string; hints: string[] };
  check_note: string;
  questions: string[];
}

/** What an example is about; the subject chooses one of the first four. */
export type ExampleKind = 'maths' | 'chemistry' | 'physics' | 'computer_science' | 'explanation';

const none: ExampleLine = { title: '', latex: '', terms: [] };

/** A quadratic equation: one tool, a checkpoint, no method step (the steps say it), four moves, a check by substitution. */
const MATHS: SolveExample = {
  plan: '2x^2 - 3x - 5 = 0, so a = 2, b = -3, c = -5. Discriminant: b^2 - 4ac = 9 + 40 = 49, and sqrt(49) = 7. Then x = (3 ± 7)/4, so x = 10/4 = 5/2 or x = -4/4 = -1. Check x = -1: 2 + 3 - 5 = 0, and x = 5/2: 12.5 - 7.5 - 5 = 0.',
  kind: 'calculation',
  read: {
    say: 'The equation two x squared minus three x minus five equals zero is quadratic, and we want every x that makes it true. Expect at most two numbers.',
    given: ['p2.s4'],
    given_anchor: 'two x squared minus three',
    asked: ['p2.s5'],
    asked_anchor: 'every x that makes it true',
    marks: [],
  },
  tools: [
    {
      concept: 'The quadratic formula',
      say: 'An equation of the form a x squared plus b x plus c equals zero asks where a parabola crosses the x-axis, like a ball landing on the ground. The quadratic formula turns the three coefficients straight into both crossing points, and here it hands us every x we are after.',
      recall: 'Again the quadratic formula, which turns the three coefficients into the crossing points.',
      formula: {
        title: 'Quadratic formula',
        latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
        terms: [
          { latex: '\\pm', label: 'two solutions', anchor: 'both crossing points' },
          { latex: 'b^2 - 4ac', label: 'the discriminant', anchor: 'three coefficients' },
        ],
      },
    },
  ],
  method: { say: '', formula: none },
  steps: [
    {
      title: 'Read the coefficients',
      latex: 'a = 2,\\; b = -3,\\; c = -5',
      terms: [{ latex: 'b = -3', label: 'coefficient of x', anchor: 'b is minus three' }],
      say: 'Match the equation with the general form. The number in front of x squared is a, so a is two; in front of x sits b, and b is minus three; standing alone is c, minus five.',
      sure: true,
    },
    {
      title: 'Compute the discriminant',
      latex: 'b^2 - 4ac = (-3)^2 - 4 \\cdot 2 \\cdot (-5) = 49',
      terms: [
        { latex: '(-3)^2', label: 'b squared', anchor: 'minus three squared' },
        { latex: '49', label: 'the discriminant', anchor: 'forty-nine' },
      ],
      say: 'Under the root goes b squared minus four a c. Minus three squared is nine, and four times two times minus five is minus forty, so nine plus forty makes forty-nine.',
      sure: true,
    },
    {
      title: 'Put into the formula',
      latex: 'x = \\frac{3 \\pm \\sqrt{49}}{4} = \\frac{3 \\pm 7}{4}',
      terms: [{ latex: '3 \\pm 7', label: 'three plus or minus seven', anchor: 'plus or minus seven' }],
      say: 'Forty-nine has a clean root, seven. So x is three plus or minus seven, all over four, since two a is four.',
      sure: true,
    },
    {
      title: 'Split the two cases',
      latex: 'x_1 = \\frac{3 + 7}{4} = \\frac{5}{2},\\; x_2 = \\frac{3 - 7}{4} = -1',
      terms: [
        { latex: '\\frac{3 + 7}{4}', label: 'plus case', anchor: 'ten over four' },
        { latex: '\\frac{3 - 7}{4}', label: 'minus case', anchor: 'minus four over four' },
      ],
      say: 'The plus sign gives ten over four, which is five halves. The minus sign gives minus four over four, which is minus one.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 'x = \\frac{5}{2} \\text{ or } x = -1',
    terms: [
      { latex: '\\frac{5}{2}', label: 'first solution', anchor: 'x equals five halves' },
      { latex: '-1', label: 'second solution', anchor: 'x equals minus one' },
    ],
    say: 'So the equation has two solutions: x equals five halves, or x equals minus one.',
  },
  check: {
    say: 'Put minus one back in: two times one is two, minus three times minus one adds three, and minus five closes it, so two plus three minus five is zero, as it should be.',
    latex: '2 \\cdot (-1)^2 - 3 \\cdot (-1) - 5 = 2 + 3 - 5 = 0',
  },
  pitfall:
    'Forgetting the sign of b: here b is minus three, so minus b is plus three, while b squared is still plus nine.',
  try: {
    prompt: 'Before the formula does its work, what are a, b and c here, and what number lands under the root?',
    hints: [
      'Match the numbers in front of x squared, in front of x and standing alone with a, b and c, and watch their signs.',
      'Work out b squared minus four times a times c; with a negative b, b squared is still positive.',
      'Take the square root of that number, put it into the formula once with plus and once with minus, and divide by two a.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does the formula give two solutions?', 'What happens if the number under the root is negative?'],
};

/** Stoichiometry: two tools, a method that lays out the path, grams to moles to grams with units and a size check. */
const CHEMISTRY: SolveExample = {
  plan: 'm(H2) = 4.0 g, M(H2) = 2.02 g/mol, so n(H2) = 1.98 mol. 2 H2 + O2 -> 2 H2O gives n(H2O) = n(H2). M(H2O) = 18.02 g/mol, so m(H2O) = 35.7 g, about 36 g. Check: 4.0 g * 18.02/2.02 = 35.7 g.',
  kind: 'calculation',
  read: {
    say: 'Four point zero grams of hydrogen burn completely in oxygen, and the question is how much water that makes, in grams.',
    given: ['p3.s2'],
    given_anchor: 'four point zero grams of hydrogen',
    asked: ['p3.s3'],
    asked_anchor: 'how much water',
    marks: [],
  },
  tools: [
    {
      concept: 'The mole and molar mass',
      say: 'The mole is a counting unit for particles, like a dozen for eggs, and the molar mass says how many grams one mole weighs. Dividing a mass by the molar mass gives the number of moles, which is the language the reaction equation speaks.',
      recall: 'Again moles: a mass divided by the molar mass gives the amount of substance.',
      formula: {
        title: 'Amount of substance',
        latex: 'n = \\frac{m}{M}',
        terms: [
          { latex: 'n', label: 'amount in moles', anchor: 'counting unit' },
          { latex: '\\frac{m}{M}', label: 'mass over molar mass', anchor: 'molar mass says' },
        ],
      },
    },
    {
      concept: 'Mole ratio of a balanced equation',
      say: 'The coefficients of a balanced equation count molecules, and so they count moles too: two hydrogen go with one oxygen and make two water. Like a recipe, they tell how much of one ingredient goes with another.',
      recall: 'Again the mole ratio: the coefficients of the balanced equation compare the moles of different substances.',
      formula: {
        title: 'Balanced reaction',
        latex: '\\ce{2H2 + O2 -> 2H2O}',
        terms: [{ latex: '\\ce{2H2 + O2 -> 2H2O}', label: 'balanced reaction', anchor: 'two hydrogen go with' }],
      },
    },
  ],
  method: {
    say: 'The equation speaks in moles but the task gives grams, so we convert the grams of hydrogen into moles, carry them over to moles of water, and turn those back into grams.',
    formula: {
      title: 'The conversion path',
      latex: 'm(\\ce{H2}) \\to n(\\ce{H2}) \\to n(\\ce{H2O}) \\to m(\\ce{H2O})',
      terms: [
        { latex: 'n(\\ce{H2})', label: 'moles of hydrogen', anchor: 'grams of hydrogen into moles' },
        { latex: 'n(\\ce{H2O})', label: 'moles of water', anchor: 'moles of water' },
      ],
    },
  },
  steps: [
    {
      title: 'Mole ratio',
      latex: 'n(\\ce{H2O}) : n(\\ce{H2}) = 2 : 2 = 1 : 1',
      terms: [{ latex: '1 : 1', label: 'one to one', anchor: 'one to one' }],
      say: 'First the balanced equation, which gives the mole ratio. Two hydrogen react with one oxygen to give two water, so hydrogen and water stand two to two, which is one to one.',
      sure: true,
    },
    {
      title: 'Moles of hydrogen',
      latex: 'n(\\ce{H2}) = \\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}} = 1.98\\,\\mathrm{mol}',
      terms: [
        {
          latex: '\\frac{4.0\\,\\mathrm{g}}{2.02\\,\\mathrm{g/mol}}',
          label: 'mass over molar mass',
          anchor: 'divide the mass',
        },
        { latex: '1.98\\,\\mathrm{mol}', label: 'amount of hydrogen', anchor: 'one point nine eight moles' },
      ],
      say: 'Next, grams to moles: divide the mass, four point zero grams, by the molar mass of hydrogen, two point zero two grams per mole. That gives one point nine eight moles.',
      sure: true,
    },
    {
      title: 'Moles of water',
      latex: 'n(\\ce{H2O}) = n(\\ce{H2}) = 1.98\\,\\mathrm{mol}',
      terms: [{ latex: 'n(\\ce{H2O})', label: 'amount of water', anchor: 'moles of water' }],
      say: 'The ratio is one to one, so water forms in the same number of moles as hydrogen burned: one point nine eight moles of water.',
      sure: true,
    },
    {
      title: 'Mass of water',
      latex: 'm(\\ce{H2O}) = 1.98\\,\\mathrm{mol} \\cdot 18.02\\,\\mathrm{g/mol} = 35.7\\,\\mathrm{g}',
      terms: [
        { latex: '18.02\\,\\mathrm{g/mol}', label: 'molar mass of water', anchor: 'molar mass of water' },
        { latex: '35.7\\,\\mathrm{g}', label: 'mass in grams', anchor: 'thirty-five point seven grams' },
      ],
      say: 'Back to grams: multiply by the molar mass of water, eighteen point zero two grams per mole. That makes thirty-five point seven grams.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 'm(\\ce{H2O}) \\approx 36\\,\\mathrm{g}',
    terms: [{ latex: '36\\,\\mathrm{g}', label: 'mass of water', anchor: 'thirty-six grams' }],
    say: 'So about thirty-six grams of water form, rounded to two significant figures like the given four point zero grams.',
  },
  check: {
    say: 'As a size check, one gram of hydrogen makes about nine grams of water, because water is mostly oxygen by mass. Four times nine is thirty-six, and the unit is grams, so the result fits.',
    latex: '4.0\\,\\mathrm{g} \\cdot \\frac{18.02}{2.02} = 35.7\\,\\mathrm{g}',
  },
  pitfall:
    'Using the grams of hydrogen directly in the mole ratio. The equation counts moles, so convert to moles first.',
  try: {
    prompt:
      'Before we calculate, how many moles are in the four point zero grams of hydrogen, and what does the equation say about the moles of water?',
    hints: [
      'Divide the mass of hydrogen by its molar mass, which you find from the periodic table.',
      'Read the coefficients of the balanced equation: how many moles of water form for each mole of hydrogen?',
      'That ratio gives the moles of water; multiply them by the molar mass of water to get grams.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why do we convert to moles first?', 'What changes if oxygen were the limiting reagent?'],
};

/** Free fall: one law solved for the unknown, three lines, no method step, numbers with units, a check by putting the result back. */
const PHYSICS: SolveExample = {
  plan: 'h = 20 m, g = 9.81 m/s^2, v0 = 0. h = 1/2 g t^2, so t^2 = 2h/g = 4.08 s^2 and t = 2.02 s. Check: 1/2 * 9.81 * 2.02^2 = 20.0 m.',
  kind: 'calculation',
  read: {
    say: 'A ball is dropped from rest at a height of twenty metres, air resistance ignored: how long does it take to hit the ground? The answer is a time in seconds.',
    given: ['p4.s2'],
    given_anchor: 'dropped from rest',
    asked: ['p4.s3'],
    asked_anchor: 'how long does it take',
    marks: [],
  },
  tools: [
    {
      concept: 'Free fall with constant acceleration',
      say: 'In free fall, gravity adds the same speed every second, about nine point eight one metres per second more each time. From rest, the distance fallen grows with the square of the time, like a stone dropped from a bridge. That law links height and time, which is what we need.',
      recall: 'Again the free-fall law: from rest, the distance fallen grows with the square of the time.',
      formula: {
        title: 'Distance in free fall',
        latex: 'h = \\frac{1}{2} g t^2',
        terms: [
          { latex: 'h', label: 'distance fallen', anchor: 'distance fallen' },
          { latex: 'g', label: 'gravitational acceleration', anchor: 'gravity adds' },
          { latex: 't^2', label: 'time squared', anchor: 'square of the time' },
        ],
      },
    },
  ],
  method: { say: '', formula: none },
  steps: [
    {
      title: 'Solve for t squared',
      latex: 't^2 = \\frac{2h}{g}',
      terms: [{ latex: '\\frac{2h}{g}', label: 'two h over g', anchor: 'two h over g' }],
      say: 'Solve the law for t squared first: multiply both sides by two and divide by g, so t squared equals two h over g.',
      sure: true,
    },
    {
      title: 'Insert the numbers',
      latex: 't^2 = \\frac{2 \\cdot 20\\,\\mathrm{m}}{9.81\\,\\mathrm{m/s^2}} = 4.08\\,\\mathrm{s^2}',
      terms: [
        { latex: '9.81\\,\\mathrm{m/s^2}', label: 'gravitational acceleration', anchor: 'nine point eight one' },
        { latex: '4.08\\,\\mathrm{s^2}', label: 'time squared', anchor: 'four point zero eight' },
      ],
      say: 'With the numbers in, the metres cancel against the metres in g and leave seconds squared. Forty over nine point eight one is four point zero eight.',
      sure: true,
    },
    {
      title: 'Take the square root',
      latex: 't = \\sqrt{4.08\\,\\mathrm{s^2}} = 2.02\\,\\mathrm{s}',
      terms: [{ latex: '2.02\\,\\mathrm{s}', label: 'time in seconds', anchor: 'two point zero two seconds' }],
      say: 'Last comes the square root, because we want t and not t squared: the root of four point zero eight seconds squared is two point zero two seconds.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 't \\approx 2.0\\,\\mathrm{s}',
    terms: [{ latex: '2.0\\,\\mathrm{s}', label: 'fall time', anchor: 'two seconds' }],
    say: 'So the ball needs about two seconds to reach the ground, rounded to two significant figures.',
  },
  check: {
    say: 'Put the time back into the law. Half of nine point eight one times four point zero eight is about twenty metres, the height we started with.',
    latex: '\\frac{1}{2} \\cdot 9.81\\,\\mathrm{m/s^2} \\cdot (2.02\\,\\mathrm{s})^2 = 20.0\\,\\mathrm{m}',
  },
  pitfall:
    'Forgetting the square root at the end, which leaves t squared, or forgetting the factor two when solving for t squared.',
  try: {
    prompt: 'Before any numbers go in, how would you rearrange the law to get the time on its own?',
    hints: [
      'The time appears squared, with a factor in front of it. Which operations undo that?',
      'Multiply both sides by two and divide by g, so that t squared stands alone.',
      'Then take the square root, and put in the height and g with their units only at the very end.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does the mass of the ball not matter?', 'How long would it take on the Moon?'],
};

/** A trace of binary search: one tool, a method that names the two ends, one row of the trace table per line. */
const COMPUTER_SCIENCE: SolveExample = {
  plan: 'a = [1, 3, 5, 7, 9, 11], target 7. lo = 0, hi = 5, mid = 2, a[2] = 5 < 7, so lo = 3. mid = 4, a[4] = 9 > 7, so hi = 3. mid = 3, a[3] = 7: found at index 3 after 3 probes.',
  kind: 'trace',
  read: {
    say: 'The sorted array one, three, five, seven, nine, eleven is searched for the value seven with binary search, and we trace every probe. The answer is the index where seven sits and how many probes it took.',
    given: ['p5.s2'],
    given_anchor: 'sorted array one',
    asked: ['p5.s3'],
    asked_anchor: 'trace every probe',
    marks: [],
  },
  tools: [
    {
      concept: 'Binary search on a sorted array',
      say: 'Binary search checks the middle element and throws away the half that cannot hold the value, like finding a name in a phone book by opening it in the middle. The trace we are asked for is exactly this halving, probe by probe.',
      recall: 'Again binary search: probe the middle and drop the half that cannot hold the value.',
      formula: {
        title: 'The middle index',
        latex: '\\text{mid} = \\left\\lfloor \\frac{\\text{lo} + \\text{hi}}{2} \\right\\rfloor',
        terms: [
          { latex: '\\text{mid}', label: 'middle position', anchor: 'checks the middle' },
          {
            latex: '\\frac{\\text{lo} + \\text{hi}}{2}',
            label: 'average of both ends',
            anchor: 'opening it in the middle',
          },
        ],
      },
    },
  ],
  method: {
    say: 'Two ends, lo and hi, mark the range that can still hold seven. Each probe compares the middle with seven and moves one end past it, until the middle is seven.',
    formula: none,
  },
  steps: [
    {
      title: 'Set up the range',
      latex: 'a = [1, 3, 5, 7, 9, 11],\\; \\text{lo} = 0,\\; \\text{hi} = 5',
      terms: [
        { latex: '\\text{lo} = 0', label: 'left end', anchor: 'lo is zero' },
        { latex: '\\text{hi} = 5', label: 'right end', anchor: 'hi is five' },
      ],
      say: 'Start with the whole array: lo is zero and hi is five, since we count positions from zero.',
      sure: true,
    },
    {
      title: 'First probe',
      latex: '\\text{mid} = 2:\\; a[2] = 5 < 7 \\;\\Rightarrow\\; \\text{lo} = 3',
      terms: [
        { latex: 'a[2] = 5 < 7', label: 'five is too small', anchor: 'five is smaller than seven' },
        { latex: '\\text{lo} = 3', label: 'new left end', anchor: 'lo moves to three' },
      ],
      say: 'The middle of zero and five, rounded down, is two. The element at index two is five, and five is smaller than seven, so seven lies to the right and lo moves to three.',
      sure: true,
    },
    {
      title: 'Second probe',
      latex: '\\text{mid} = 4:\\; a[4] = 9 > 7 \\;\\Rightarrow\\; \\text{hi} = 3',
      terms: [
        { latex: 'a[4] = 9 > 7', label: 'nine is too big', anchor: 'nine is larger than seven' },
        { latex: '\\text{hi} = 3', label: 'new right end', anchor: 'hi moves to three' },
      ],
      say: 'Now lo is three and hi is five, so the middle is four. Nine sits there, and nine is larger than seven, so hi moves to three.',
      sure: true,
    },
    {
      title: 'Third probe',
      latex: '\\text{mid} = 3:\\; a[3] = 7 \\;\\Rightarrow\\; \\text{found}',
      terms: [{ latex: 'a[3] = 7', label: 'the target', anchor: 'element at index three' }],
      say: 'With lo and hi both at three, the middle is three, and the element at index three is seven. Found, so the search stops.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: '\\text{index } 3 \\text{ after } 3 \\text{ probes}',
    terms: [
      { latex: '\\text{index } 3', label: 'where seven sits', anchor: 'index three' },
      { latex: '3 \\text{ probes}', label: 'number of probes', anchor: 'three probes' },
    ],
    say: 'So seven is at index three, counting from zero, and binary search needed three probes.',
  },
  check: {
    say: 'Look at the array again: counting from zero, the elements are one, three, five, seven, so index three holds seven. A search from the left would have needed four probes, binary search needed three.',
    latex: 'a[3] = 7',
  },
  pitfall: 'Mixing up zero-based and one-based positions: seven is at index three, but it is the fourth element.',
  try: {
    prompt: 'Before we trace it, what are the two ends of the range at the start, and which index do you probe first?',
    hints: [
      'Count the positions from zero: the left end is at zero, and the right end is the last position of the array.',
      'The first probe is the average of the two ends, rounded down; compare the element there with the value you search for.',
      'If that element is smaller than the target, the target can only be to its right, so move the left end past the probe and repeat.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does binary search need a sorted array?', 'How many probes does it need for a million elements?'],
};

/** A short explanation: one tool, no checkpoint and no method step (nothing to try first), the board grows into the argument. */
const EXPLANATION: SolveExample = {
  plan: 'Ice floats because it is less dense than liquid water. Freezing makes water expand by about nine percent, so the same mass takes more volume and the density is lower: 917 against 1000 kg/m^3. A body less dense than the liquid floats.',
  kind: 'explanation',
  read: {
    say: 'Ice floats on liquid water, which is odd for a solid, and we are asked to explain why. The answer is a short explanation in words, built on one idea: density.',
    given: ['p6.s2'],
    given_anchor: 'ice floats on liquid water',
    asked: ['p6.s3'],
    asked_anchor: 'asked to explain why',
    marks: [],
  },
  tools: [
    {
      concept: 'Density and floating',
      say: 'Density is mass per volume. A body floats when it is less dense than the liquid, because the liquid pushes up with the weight of the water it displaces, like a cork bobbing on a pond. So our explanation has to compare two densities.',
      recall: 'Again density, the mass per volume: the less dense body floats.',
      formula: {
        title: 'Density',
        latex: '\\rho = \\frac{m}{V}',
        terms: [
          { latex: '\\rho', label: 'density', anchor: 'Density is mass' },
          { latex: '\\frac{m}{V}', label: 'mass per volume', anchor: 'mass per volume' },
        ],
      },
    },
  ],
  method: { say: '', formula: none },
  steps: [
    {
      title: 'Freezing makes room',
      latex: '\\text{water freezes} \\;\\Rightarrow\\; \\text{volume grows}',
      terms: [{ latex: '\\text{volume grows}', label: 'ice takes more room', anchor: 'more room' }],
      say: 'When water freezes, its molecules lock into an open crystal pattern full of gaps. The same mass then takes up about nine percent more room.',
      sure: true,
    },
    {
      title: 'Lower density',
      latex: '\\rho = \\frac{m}{V} \\;\\Rightarrow\\; \\rho_{\\text{ice}} < \\rho_{\\text{water}}',
      terms: [
        { latex: '\\rho_{\\text{ice}}', label: 'density of ice', anchor: 'density of ice' },
        { latex: '\\rho_{\\text{water}}', label: 'density of water', anchor: 'liquid water' },
      ],
      say: 'The same mass in a bigger volume means less mass per volume. So the density of ice is about nine hundred seventeen kilograms per cubic metre, while liquid water has about one thousand.',
      sure: true,
    },
    {
      title: 'So ice floats',
      latex: '\\rho_{\\text{ice}} < \\rho_{\\text{water}} \\;\\Rightarrow\\; \\text{ice floats}',
      terms: [{ latex: '\\text{ice floats}', label: 'the conclusion', anchor: 'ice floats' }],
      say: 'A body less dense than the liquid floats, so ice floats, with about nine tenths of it below the surface.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: '\\text{Ice floats because it is less dense}',
    terms: [{ latex: '\\text{Ice floats because it is less dense}', label: 'the explanation', anchor: 'less dense' }],
    say: 'So ice floats because freezing makes the same mass take more room, and that makes it less dense than liquid water.',
  },
  check: {
    say: 'Test the explanation on a special case: oil is also less dense than water and floats on it, while a stone, which is denser, sinks. So density decides, as the explanation says.',
    latex: '\\rho_{\\text{oil}} < \\rho_{\\text{water}} \\;\\Rightarrow\\; \\text{oil floats}',
  },
  pitfall:
    'Saying ice floats because it is cold or light; what matters is the density, the mass per volume, not the mass alone.',
  try: { prompt: '', hints: [] },
  check_note: 'Please check this step yourself.',
  questions: ['Why does water expand when it freezes?', 'Why does a lake freeze from the top down?'],
};

/**
 * A part that goes on from the one before: it continues from the mean part a found, says no number, lists no givens, gives
 * no tool (the task's toolkit came with part a) and has no checkpoint and no method step: two lines and the answer.
 */
export const FOLLOW_ON: SolveExample = {
  plan: 'Study hours 8, 10, 12, 9, 11, 13, 7, 10 with mean 10. Deviations -2, 0, 2, -1, 1, 3, -3, 0; squares 4, 0, 4, 1, 1, 9, 9, 0 sum to 28. s^2 = 28/7 = 4 h^2 and s = 2 h. Check: values lie mostly within 2 h of the mean.',
  kind: 'calculation',
  read: {
    say: 'How far do the eight values scatter around that mean of ten hours? That is what the sample variance measures, and its square root, the standard deviation, gives it back in hours.',
    given: [],
    given_anchor: '',
    asked: ['p7.s4'],
    asked_anchor: 'sample variance',
    marks: [],
  },
  tools: [],
  method: { say: '', formula: none },
  steps: [
    {
      title: 'Squared distances',
      latex: '\\sum_i (x_i - 10)^2 = 4 + 0 + 4 + 1 + 1 + 9 + 9 + 0 = 28',
      terms: [{ latex: '28', label: 'sum of squares', anchor: 'add up to twenty-eight' }],
      say: 'Subtract ten from each value and square it. The distances are two, zero, two, one, one, three, three and zero, so their squares add up to twenty-eight.',
      sure: true,
    },
    {
      title: 'Variance and deviation',
      latex: 's^2 = \\frac{28}{7} = 4\\,\\mathrm{h^2},\\quad s = \\sqrt{4} = 2\\,\\mathrm{h}',
      terms: [
        { latex: '\\frac{28}{7}', label: 'sum over n minus one', anchor: 'divide by seven' },
        { latex: '2\\,\\mathrm{h}', label: 'standard deviation', anchor: 'back to hours' },
      ],
      say: 'Now divide by seven, one less than the eight students, since a sample variance divides by n minus one. That leaves four squared hours, and the root takes us back to hours: two.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 's^2 = 4\\,\\mathrm{h^2},\\; s = 2\\,\\mathrm{h}',
    terms: [
      { latex: '4\\,\\mathrm{h^2}', label: 'sample variance', anchor: 'four squared hours' },
      { latex: '2\\,\\mathrm{h}', label: 'standard deviation', anchor: 'two hours' },
    ],
    say: 'So the sample variance is four squared hours, and the standard deviation is two hours.',
  },
  check: {
    say: 'Two hours is a plausible spread: most values lie within two hours of the mean, and only seven and thirteen reach three away.',
    latex: '\\sqrt{28 / 7} = 2',
  },
  pitfall: 'Dividing by eight instead of seven: a sample variance divides by n minus one.',
  try: { prompt: '', hints: [] },
  check_note: 'Please check this step yourself.',
  questions: ['Why divide by n minus one?', 'What does a standard deviation of two hours tell us?'],
};

export const EXAMPLES: Record<ExampleKind, SolveExample> = {
  maths: MATHS,
  chemistry: CHEMISTRY,
  physics: PHYSICS,
  computer_science: COMPUTER_SCIENCE,
  explanation: EXPLANATION,
};

// The heuristics of a subject the card could not name: chemical formulas and the vocabulary of each field in the text.

const ELEMENTS = new Set(
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce W Pt Au Hg Pb Bi U'.split(
    ' ',
  ),
);
/** A chemical formula such as H2O, NaCl or CO2: every symbol an element, and a digit or a lower-case letter in it. */
function hasFormula(text: string): boolean {
  for (const [token] of text.matchAll(/\b(?:[A-Z][a-z]?\d*){2,}\b/g))
    if ([...token.matchAll(/[A-Z][a-z]?/g)].every(([symbol]) => ELEMENTS.has(symbol)) && /[a-z\d]/.test(token))
      return true;
  return false;
}
const CHEMISTRY_WORDS = /\\ce\{|\b(?:mol|molar\w*|moles?|pH|stoichiometr\w*|stoffmenge|reaktionsgleichung|molmasse)\b/i;
const PHYSICS_UNITS = /\d\s*(?:m\/s|km\/h|m\s?s\^?-1|kg|N|J|W|Pa|Hz|V|A|K)\b|\bm\/s\b/;
const PHYSICS_WORDS =
  /\b(?:velocity|speed|acceleration|force|energy|momentum|friction|gravity|kinetic|potential|voltage|current|resistance|geschwindigkeit|beschleunigung|kraft|energie|impuls|reibung|schwerkraft|spannung|strom|widerstand)\b/i;
const CS_WORDS = /\b(?:algorithm\w*|array|pseudocode|runtime|laufzeit)\b|\bO\(/i;

/**
 * The example that fits a part: by the card's subject, else (for "other", biology, medicine or no subject) by what the
 * part's text is about, else a calculation.
 */
export function exampleKind(subject: Subject | undefined, text = ''): ExampleKind {
  switch (subject) {
    case 'chemistry':
      return 'chemistry';
    case 'physics':
    case 'engineering':
      return 'physics';
    case 'computer_science':
      return 'computer_science';
    case 'language':
    case 'humanities':
    case 'law':
      return 'explanation';
    case 'mathematics':
    case 'statistics':
    case 'economics':
      return 'maths';
  }
  if (CHEMISTRY_WORDS.test(text) || hasFormula(text)) return 'chemistry';
  if (PHYSICS_UNITS.test(text) && PHYSICS_WORDS.test(text)) return 'physics';
  if (CS_WORDS.test(text)) return 'computer_science';
  return 'maths';
}

/**
 * The examples of a solve call: the subject's own (the only one for a subject whose parts are explanations) and, for the
 * first part of a task, the short explanation, for a part that goes on from an earlier one the follow-on part. `text` is
 * the part's text, which names the example when the subject does not.
 */
export function exampleFor(subject?: Subject, text = '', entry = true): SolveExample[] {
  const kind = exampleKind(subject, text);
  const own = kind === 'explanation' ? [EXAMPLES.explanation] : [EXAMPLES[kind], ...(entry ? [EXAMPLES.explanation] : [])];
  return entry ? own : [...own, FOLLOW_ON];
}
