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
  const width = Math.max(0, Math.min(360, frame.width - right - gap));
  // A bubble hangs right above the orb. It only rises over a tall composer when the two would overlap side by side.
  const lift = !board && beside && composer ? Math.max(gap, top - composer.top + gap) : gap;
  const clears = (bubble: number) => !composer || frame.right - right - Math.min(bubble, width) >= composer.right + gap;
  const bubbleGap = clears(292) ? gap : lift;
  const cardGap = clears(366) ? gap : lift;
  const room = Math.max(0, top - cardGap - frame.top - gap);
  return {
    bottom,
    right,
    bubbleGap,
    cardGap,
    beside,
    width,
    room,
    sheet: room < 180,
    sheetTop: frame.top + gap - top,
    sheetRoom: Math.max(0, height - gap * 2),
  };
}
