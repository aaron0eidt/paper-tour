import type { Subject } from './card';
import type { SolveKind } from './exercise';

// The worked examples of the solve call (notes/TUTOR.md, "Subjects"): a weak model copies the format and depth of its
// example, so each subject gets one complete part in schema v2 (read, background with its formula, a method, granular
// solution lines, the answer, a check with its check line, a pitfall, a checkpoint whose hints never give the result),
// and every call also gets a short explanation part. The sentence IDs are made up, as in any example for a different
// exercise; a test holds each example to the same checks as a real answer.

/** A board line of an example: its LaTeX, and the terms the narration lights up with the phrase that names each. */
export interface ExampleLine {
  title: string;
  latex: string;
  terms: { latex: string; label: string; anchor: string }[];
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
  background: { concept: string; say: string; formula: ExampleLine };
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

/** A quadratic equation: the formula as the background, four moves, a check by substitution. */
const MATHS: SolveExample = {
  plan: '2x^2 - 3x - 5 = 0, so a = 2, b = -3, c = -5. Discriminant: b^2 - 4ac = 9 + 40 = 49, and sqrt(49) = 7. Then x = (3 ± 7)/4, so x = 10/4 = 5/2 or x = -4/4 = -1. Check x = -1: 2 + 3 - 5 = 0, and x = 5/2: 12.5 - 7.5 - 5 = 0.',
  kind: 'calculation',
  read: {
    say: 'We are given the quadratic equation two x squared minus three x minus five equals zero, and we are asked for all values of x that solve it. The answer is up to two numbers.',
    given: ['p2.s4'],
    given_anchor: 'quadratic equation two x squared',
    asked: ['p2.s5'],
    asked_anchor: 'all values of x',
    marks: [],
  },
  background: {
    concept: 'The quadratic formula',
    say: 'A quadratic equation has the form a x squared plus b x plus c equals zero. Its solutions are the places where a parabola crosses the x-axis, like a thrown ball landing on the ground. The quadratic formula gives both crossing places from the three coefficients.',
    formula: {
      title: 'Quadratic formula',
      latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      terms: [
        { latex: '\\pm', label: 'two solutions', anchor: 'both crossing places' },
        { latex: 'b^2 - 4ac', label: 'the discriminant', anchor: 'three coefficients' },
      ],
    },
  },
  method: {
    say: 'We read off the coefficients a, b and c, work out the discriminant under the root, and put everything into the formula. The plus and the minus sign give the two solutions, and we check them in the original equation.',
    formula: none,
  },
  steps: [
    {
      title: 'Read the coefficients',
      latex: 'a = 2,\; b = -3,\; c = -5',
      terms: [{ latex: 'b = -3', label: 'coefficient of x', anchor: 'b equals minus three' }],
      say: 'We compare the equation with the general form. The number in front of x squared gives a equals two. The number in front of x gives b equals minus three, and the plain number gives c equals minus five.',
      sure: true,
    },
    {
      title: 'Compute the discriminant',
      latex: 'b^2 - 4ac = (-3)^2 - 4 \\cdot 2 \\cdot (-5) = 49',
      terms: [
        { latex: '(-3)^2', label: 'b squared', anchor: 'minus three squared' },
        { latex: '49', label: 'the discriminant', anchor: 'forty-nine' },
      ],
      say: 'Next the discriminant under the root. Minus three squared is nine, and four times two times minus five is minus forty. Nine minus minus forty is nine plus forty, which is forty-nine.',
      sure: true,
    },
    {
      title: 'Put into the formula',
      latex: 'x = \\frac{3 \\pm \\sqrt{49}}{4} = \\frac{3 \\pm 7}{4}',
      terms: [{ latex: '3 \\pm 7', label: 'three plus or minus seven', anchor: 'plus or minus seven' }],
      say: 'Now we put the numbers into the formula. Minus b is three, the square root of forty-nine is seven, and two a is four. So x is three plus or minus seven, divided by four.',
      sure: true,
    },
    {
      title: 'Split the two cases',
      latex: 'x_1 = \\frac{3 + 7}{4} = \\frac{5}{2},\; x_2 = \\frac{3 - 7}{4} = -1',
      terms: [
        { latex: '\\frac{3 + 7}{4}', label: 'plus case', anchor: 'with the plus sign' },
        { latex: '\\frac{3 - 7}{4}', label: 'minus case', anchor: 'with the minus sign' },
      ],
      say: 'We split the plus or minus into two cases. With the plus sign, ten divided by four gives five halves. With the minus sign, minus four divided by four gives minus one.',
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
    say: 'So the equation has two solutions: x equals five halves, and x equals minus one.',
  },
  check: {
    say: 'We put minus one back into the original equation. Two times one is two, minus three times minus one adds three, and minus five finishes it: two plus three minus five is zero.',
    latex: '2 \\cdot (-1)^2 - 3 \\cdot (-1) - 5 = 2 + 3 - 5 = 0',
  },
  pitfall:
    'Forgetting the sign of b: here b is minus three, so minus b is plus three, while b squared is still plus nine.',
  try: {
    prompt: 'Before we calculate, what are a, b and c in this equation, and what number do you get under the root?',
    hints: [
      'Match the numbers in front of x squared, in front of x and standing alone with a, b and c, and watch their signs.',
      'Work out b squared minus four times a times c; with a negative b, b squared is still positive.',
      'Take the square root of that number, put it into the formula once with plus and once with minus, and divide by two a.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does the formula give two solutions?', 'What happens if the number under the root is negative?'],
};

/** Stoichiometry: grams to moles, the mole ratio of the equation, moles to grams, with units and a size check. */
const CHEMISTRY: SolveExample = {
  plan: 'm(H2) = 4.0 g, M(H2) = 2.02 g/mol, so n(H2) = 1.98 mol. 2 H2 + O2 -> 2 H2O gives n(H2O) = n(H2). M(H2O) = 18.02 g/mol, so m(H2O) = 35.7 g, about 36 g. Check: 4.0 g * 18.02/2.02 = 35.7 g.',
  kind: 'calculation',
  read: {
    say: 'Hydrogen burns completely in excess oxygen, and we are given four point zero grams of hydrogen. We are asked for the mass of water that forms. The answer is a mass in grams.',
    given: ['p3.s2'],
    given_anchor: 'four point zero grams of hydrogen',
    asked: ['p3.s3'],
    asked_anchor: 'mass of water',
    marks: [],
  },
  background: {
    concept: 'The mole and molar mass',
    say: 'The mole is a counting unit for particles, like a dozen for eggs, and the molar mass tells us how many grams one mole weighs. The reaction equation counts particles, but the task gives grams, so we must convert between the two.',
    formula: {
      title: 'Amount of substance',
      latex: 'n = \\frac{m}{M}',
      terms: [
        { latex: 'n', label: 'amount in moles', anchor: 'counting unit' },
        { latex: '\\frac{m}{M}', label: 'mass over molar mass', anchor: 'molar mass tells us' },
      ],
    },
  },
  method: {
    say: 'The equation connects moles, not grams. So we turn the grams of hydrogen into moles, use the mole ratio of the balanced equation to get the moles of water, and turn those back into grams.',
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
      title: 'Balanced equation',
      latex: '\\ce{2H2 + O2 -> 2H2O}',
      terms: [{ latex: '\\ce{2H2 + O2 -> 2H2O}', label: 'balanced reaction', anchor: 'mole ratio' }],
      say: 'First the balanced equation. Two molecules of hydrogen react with one of oxygen to give two of water, so hydrogen and water are in the mole ratio two to two, which is one to one.',
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
      say: 'Now we convert the hydrogen to moles. We divide the mass, four point zero grams, by the molar mass of hydrogen, two point zero two grams per mole. That gives one point nine eight moles.',
      sure: true,
    },
    {
      title: 'Moles of water',
      latex: 'n(\\ce{H2O}) = n(\\ce{H2}) = 1.98\\,\\mathrm{mol}',
      terms: [{ latex: 'n(\\ce{H2O})', label: 'amount of water', anchor: 'moles of water' }],
      say: 'The mole ratio is one to one, so the water has the same number of moles as the hydrogen. We get one point nine eight moles of water.',
      sure: true,
    },
    {
      title: 'Mass of water',
      latex: 'm(\\ce{H2O}) = 1.98\\,\\mathrm{mol} \\cdot 18.02\\,\\mathrm{g/mol} = 35.7\\,\\mathrm{g}',
      terms: [
        { latex: '18.02\\,\\mathrm{g/mol}', label: 'molar mass of water', anchor: 'molar mass of water' },
        { latex: '35.7\\,\\mathrm{g}', label: 'mass in grams', anchor: 'thirty-five point seven grams' },
      ],
      say: 'Last we convert back to grams. We multiply the moles by the molar mass of water, eighteen point zero two grams per mole, and get thirty-five point seven grams.',
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

/** Free fall: one law solved for the unknown, numbers with units, a check by putting the result back. */
const PHYSICS: SolveExample = {
  plan: 'h = 20 m, g = 9.81 m/s^2, v0 = 0. h = 1/2 g t^2, so t^2 = 2h/g = 4.08 s^2 and t = 2.02 s. Check: 1/2 * 9.81 * 2.02^2 = 20.0 m.',
  kind: 'calculation',
  read: {
    say: 'A ball is dropped from rest from a height of twenty metres, and air resistance is ignored. We are asked how long it takes to reach the ground. The answer is a time in seconds.',
    given: ['p4.s2'],
    given_anchor: 'dropped from rest',
    asked: ['p4.s3'],
    asked_anchor: 'how long it takes',
    marks: [],
  },
  background: {
    concept: 'Free fall with constant acceleration',
    say: 'In free fall, gravity speeds an object up by the same amount every second, about nine point eight one metres per second more each second. Starting from rest, the distance fallen grows with the square of the time, like a stone dropped from a bridge.',
    formula: {
      title: 'Distance in free fall',
      latex: 'h = \\frac{1}{2} g t^2',
      terms: [
        { latex: 'h', label: 'distance fallen', anchor: 'distance fallen' },
        { latex: 'g', label: 'gravitational acceleration', anchor: 'gravity speeds' },
        { latex: 't^2', label: 'time squared', anchor: 'square of the time' },
      ],
    },
  },
  method: {
    say: 'We know the height and that the ball starts at rest, and we want the time. So we solve the free-fall law for t, then put in the numbers with their units and take the square root.',
    formula: none,
  },
  steps: [
    {
      title: 'Solve for t squared',
      latex: 't^2 = \\frac{2h}{g}',
      terms: [{ latex: '\\frac{2h}{g}', label: 'two h over g', anchor: 'two h over g' }],
      say: 'We solve the law for t squared: multiply both sides by two and divide by g. This gives t squared equals two h over g.',
      sure: true,
    },
    {
      title: 'Insert the numbers',
      latex: 't^2 = \\frac{2 \\cdot 20\\,\\mathrm{m}}{9.81\\,\\mathrm{m/s^2}}',
      terms: [
        { latex: '2 \\cdot 20\\,\\mathrm{m}', label: 'twice the height', anchor: 'twice the height' },
        { latex: '9.81\\,\\mathrm{m/s^2}', label: 'gravitational acceleration', anchor: 'nine point eight one' },
      ],
      say: 'Now we put in the numbers. Twice the height is two times twenty metres, and g is nine point eight one metres per second squared.',
      sure: true,
    },
    {
      title: 'Evaluate',
      latex: 't^2 = 4.08\\,\\mathrm{s^2}',
      terms: [{ latex: '4.08\\,\\mathrm{s^2}', label: 'time squared', anchor: 'four point zero eight' }],
      say: 'The metres cancel against the metres in g and leave seconds squared. Forty divided by nine point eight one is four point zero eight, so t squared is four point zero eight seconds squared.',
      sure: true,
    },
    {
      title: 'Take the square root',
      latex: 't = \\sqrt{4.08\\,\\mathrm{s^2}} = 2.02\\,\\mathrm{s}',
      terms: [{ latex: '2.02\\,\\mathrm{s}', label: 'time in seconds', anchor: 'two point zero two seconds' }],
      say: 'Finally we take the square root, because we want t, not t squared. The square root of four point zero eight seconds squared is two point zero two seconds.',
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
    say: 'We put the time back into the law. Half of nine point eight one times four point zero eight is about twenty metres, the height we started with.',
    latex: '\\frac{1}{2} \\cdot 9.81\\,\\mathrm{m/s^2} \\cdot (2.02\\,\\mathrm{s})^2 = 20.0\\,\\mathrm{m}',
  },
  pitfall:
    'Forgetting the square root at the end, which leaves t squared, or forgetting the factor two when solving for t squared.',
  try: {
    prompt: 'Before we put in numbers, how would you rearrange the free-fall law to get the time on its own?',
    hints: [
      'The time appears squared, with a factor in front of it. Which operations undo that?',
      'Multiply both sides by two and divide by g, so that t squared stands alone.',
      'Then take the square root, and put in the height and g with their units only at the very end.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does the mass of the ball not matter?', 'How long would it take on the Moon?'],
};

/** A trace of binary search: one row of the trace table per line. */
const COMPUTER_SCIENCE: SolveExample = {
  plan: 'a = [1, 3, 5, 7, 9, 11], target 7. lo = 0, hi = 5, mid = 2, a[2] = 5 < 7, so lo = 3. mid = 4, a[4] = 9 > 7, so hi = 3. mid = 3, a[3] = 7: found at index 3 after 3 probes.',
  kind: 'trace',
  read: {
    say: 'We are given the sorted array one, three, five, seven, nine, eleven, and we search for the value seven with binary search. We are asked to trace the search. The answer is the index where seven is found and the number of probes.',
    given: ['p5.s2'],
    given_anchor: 'sorted array',
    asked: ['p5.s3'],
    asked_anchor: 'trace the search',
    marks: [],
  },
  background: {
    concept: 'Binary search on a sorted array',
    say: 'Binary search looks for a value in a sorted list by checking the middle element and throwing away the half that cannot contain it, like finding a name in a phone book by opening it in the middle. The trace follows exactly this halving.',
    formula: {
      title: 'The middle index',
      latex: '\\text{mid} = \\left\\lfloor \\frac{\\text{lo} + \\text{hi}}{2} \\right\\rfloor',
      terms: [
        { latex: '\\text{mid}', label: 'middle position', anchor: 'checking the middle' },
        {
          latex: '\\frac{\\text{lo} + \\text{hi}}{2}',
          label: 'average of both ends',
          anchor: 'opening it in the middle',
        },
      ],
    },
  },
  method: {
    say: 'We keep two ends, lo and hi, of the range that can still hold seven. Each probe looks at the middle, compares it with seven, and moves one end past the middle until the middle element is seven.',
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
      say: 'We start with the whole array. The left end lo is zero and the right end hi is five, because we count positions from zero.',
      sure: true,
    },
    {
      title: 'First probe',
      latex: '\\text{mid} = 2:\\; a[2] = 5 < 7 \\;\\Rightarrow\\; \\text{lo} = 3',
      terms: [
        { latex: 'a[2] = 5 < 7', label: 'five is too small', anchor: 'five is smaller than seven' },
        { latex: '\\text{lo} = 3', label: 'new left end', anchor: 'lo moves to three' },
      ],
      say: 'The middle is zero plus five, divided by two, rounded down to two. The element at index two is five, and five is smaller than seven, so seven must be to the right and lo moves to three.',
      sure: true,
    },
    {
      title: 'Second probe',
      latex: '\\text{mid} = 4:\\; a[4] = 9 > 7 \\;\\Rightarrow\\; \\text{hi} = 3',
      terms: [
        { latex: 'a[4] = 9 > 7', label: 'nine is too big', anchor: 'nine is larger than seven' },
        { latex: '\\text{hi} = 3', label: 'new right end', anchor: 'hi moves to three' },
      ],
      say: 'Now lo is three and hi is five, so the middle is four. The element at index four is nine, and nine is larger than seven, so seven must be to the left and hi moves to three.',
      sure: true,
    },
    {
      title: 'Third probe',
      latex: '\\text{mid} = 3:\\; a[3] = 7 \\;\\Rightarrow\\; \\text{found}',
      terms: [{ latex: 'a[3] = 7', label: 'the target', anchor: 'element at index three' }],
      say: 'Now lo and hi are both three, so the middle is three. The element at index three is seven, which is the value we search for, so the search stops.',
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
    say: 'We look at the array again: counting from zero, the elements are one, three, five, seven, so index three holds seven. A search from the left would have needed four probes, binary search needed three.',
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

/** A short explanation: the board grows into the argument, each line a few words. */
const EXPLANATION: SolveExample = {
  plan: 'Ice floats because it is less dense than liquid water. Freezing makes water expand by about nine percent, so the same mass takes more volume and the density is lower: 917 against 1000 kg/m^3. A body less dense than the liquid floats.',
  kind: 'explanation',
  read: {
    say: 'We are given the everyday fact that ice floats on liquid water, and we are asked to explain why. The answer is an explanation in words, built on the idea of density.',
    given: ['p6.s2'],
    given_anchor: 'ice floats on liquid water',
    asked: ['p6.s3'],
    asked_anchor: 'asked to explain why',
    marks: [],
  },
  background: {
    concept: 'Density and floating',
    say: 'Density is mass per volume. A body floats when it is less dense than the liquid, because the liquid pushes up with the weight of the water it displaces, like a cork bobbing on a pond.',
    formula: {
      title: 'Density',
      latex: '\\rho = \\frac{m}{V}',
      terms: [
        { latex: '\\rho', label: 'density', anchor: 'Density is mass' },
        { latex: '\\frac{m}{V}', label: 'mass per volume', anchor: 'mass per volume' },
      ],
    },
  },
  method: {
    say: 'We compare the density of ice with the density of liquid water, because the less dense body floats. So we first ask what freezing does to the volume.',
    formula: none,
  },
  steps: [
    {
      title: 'Freezing makes room',
      latex: '\\text{water freezes} \\;\\Rightarrow\\; \\text{volume grows}',
      terms: [{ latex: '\\text{volume grows}', label: 'ice takes more room', anchor: 'more room' }],
      say: 'When water freezes, its molecules lock into an open crystal pattern with gaps. The same mass then takes up about nine percent more room.',
      sure: true,
    },
    {
      title: 'Lower density',
      latex: '\\rho = \\frac{m}{V} \\;\\Rightarrow\\; \\rho_{\\text{ice}} < \\rho_{\\text{water}}',
      terms: [
        { latex: '\\rho_{\\text{ice}}', label: 'density of ice', anchor: 'density of ice' },
        { latex: '\\rho_{\\text{water}}', label: 'density of water', anchor: 'liquid water' },
      ],
      say: 'Density is mass divided by volume, so the same mass in a bigger volume gives a smaller density. The density of ice is about nine hundred seventeen kilograms per cubic metre, and liquid water about one thousand.',
      sure: true,
    },
    {
      title: 'So ice floats',
      latex: '\\rho_{\\text{ice}} < \\rho_{\\text{water}} \\;\\Rightarrow\\; \\text{ice floats}',
      terms: [{ latex: '\\text{ice floats}', label: 'the conclusion', anchor: 'ice floats' }],
      say: 'A body that is less dense than the liquid floats. So the ice floats, with about nine tenths of it below the surface.',
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
  try: {
    prompt:
      'Before we explain it, what do you think happens to the room a fixed amount of water takes when it freezes?',
    hints: [
      'Think about the water molecules when they freeze into a solid crystal: do they sit closer together or further apart?',
      'If the same mass takes up more room, what happens to its mass per volume?',
      'Now compare that value for ice with the value for liquid water: which is smaller, and what does that mean for floating?',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why does water expand when it freezes?', 'Why does a lake freeze from the top down?'],
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
 * The examples of a solve call: the subject's own and the short explanation (the only one for a subject whose parts
 * are explanations). `text` is the part's text, which names the example when the subject does not.
 */
export function exampleFor(subject?: Subject, text = ''): SolveExample[] {
  const kind = exampleKind(subject, text);
  return kind === 'explanation' ? [EXAMPLES.explanation] : [EXAMPLES[kind], EXAMPLES.explanation];
}
