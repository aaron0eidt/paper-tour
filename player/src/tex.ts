// KaTeX with its chemistry extension (\ce, \pu) loaded once. Every place the player typesets LaTeX imports katex from
// here, so chemistry renders wherever mathematics does, as the server's check of it does (server/src/harness/board.ts).

import katex from 'katex';
import 'katex/contrib/mhchem';

export default katex;
