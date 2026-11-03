export interface DockRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

/** Hold the character beside the composer when there is room; only its bubble clears an expanded tray. */
export function companionPlacement(
  frame: DockRect,
  composer: DockRect | undefined,
  size: number,
  edge: number,
  gap: number,
  board: boolean,
) {
  const beside = board || !composer || frame.right - composer.right >= size + gap + edge;
  const height = frame.bottom - frame.top;
  const bottom = Math.min(
    !beside && composer ? frame.bottom - composer.top + gap : edge,
    Math.max(0, height - size - edge),
  );
  const right = !beside && composer ? Math.max(edge, frame.right - composer.right) : edge;
  const top = frame.bottom - bottom - size;
  const bubbleGap = !board && beside && composer ? Math.max(gap, top - composer.top + gap) : gap;
  const room = Math.max(0, top - bubbleGap - frame.top - gap);
  return {
    bottom,
    right,
    bubbleGap,
    beside,
    width: Math.max(0, Math.min(360, frame.width - right - gap)),
    room,
    sheet: room < 180,
    sheetTop: frame.top + gap - top,
    sheetRoom: Math.max(0, height - gap * 2),
  };
}
