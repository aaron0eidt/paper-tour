import type { DocEquation } from '../../../shared/paper';

// Display equations come with a printed number (eq3) or without one (equ1, equ2, ... in reading order; see
// schema/doc.schema.json). A tour treats them alike: the card may choose either as a key formula, and a formula or plot
// step may stand on either. These say how a listing or a narration names one.

/** How the document refers to an equation: "Equation 3", or for a display without a number where it is. */
export const equationName = (equation: DocEquation): string =>
  equation.number ? `Equation ${equation.number}` : `the equation on page ${equation.page}`;

/** The tag of an equation in a listing: "(3)", or "(no number)". */
export const equationTag = (equation: DocEquation): string =>
  equation.number ? `(${equation.number})` : '(no number)';
