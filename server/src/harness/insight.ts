import type { BBox, Doc, Region, Step } from '../../../shared/paper';

const words = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized = (s: string) => words(s).join(' ');

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
  const targets = step.actions.flatMap((a) => (a.type === 'focus' || a.type === 'zoom' ? [a.target] : []));
  const printed = targets.map((id) => printedAt(doc, id)).join('\n');
  let droppedBoard = false;
  const actions = step.actions.flatMap((a) => {
    if (
      (a.type === 'arrow' || a.type === 'circle' || a.type === 'box') &&
      a.label &&
      repeatsPrinted(a.label, printedAt(doc, a.target, a.region))
    ) {
      const { label: _label, ...mark } = a;
      return [mark];
    }
    if (a.type === 'board') {
      droppedBoard =
        a.item.kind === 'flow' &&
        a.item.nodes.filter((n) => repeatsPrinted(n.label, printed)).length >= Math.ceil(a.item.nodes.length / 2);
      if (droppedBoard) return [];
    }
    if (a.type === 'board_clear') droppedBoard = false;
    return a.type === 'board_focus' && droppedBoard ? [] : [a];
  });
  return { ...step, actions };
}
