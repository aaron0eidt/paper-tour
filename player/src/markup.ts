// Note text supports **bold** and `code` only. Everything else is plain text; the UI renders the
// tokens as React text nodes, so HTML in a note is always escaped.

export interface Token {
  kind: 'text' | 'bold' | 'code';
  text: string;
}

export function parseNote(src: string): Token[] {
  const tokens: Token[] = [];
  // Code spans first, so ** inside backticks stays literal.
  src.split(/(`[^`]+`)/).forEach((part) => {
    if (/^`[^`]+`$/.test(part)) {
      tokens.push({ kind: 'code', text: part.slice(1, -1) });
      return;
    }
    part.split(/(\*\*[^*]+\*\*)/).forEach((piece) => {
      if (/^\*\*[^*]+\*\*$/.test(piece)) tokens.push({ kind: 'bold', text: piece.slice(2, -2) });
      else if (piece) tokens.push({ kind: 'text', text: piece });
    });
  });
  return tokens;
}
