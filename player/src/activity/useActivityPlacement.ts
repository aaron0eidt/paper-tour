import { useLayoutEffect, type RefObject } from 'react';
import { companionPlacement } from './placement';

/** Measure actual controls, not the full-width transparent lane around them. */
export function useActivityPlacement(root: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const anchor = root.current?.parentElement;
    const frame = anchor?.parentElement;
    if (!anchor || !frame) return;
    let pending = 0;
    const observed = new Set<Element>();
    const update = () => {
      pending = 0;
      const box = frame.getBoundingClientRect();
      const controls = [...frame.querySelectorAll('.ask-lane > *')];
      const rects = controls
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width && rect.height);
      const composer = rects.length
        ? {
            left: Math.min(...rects.map((rect) => rect.left)),
            right: Math.max(...rects.map((rect) => rect.right)),
            top: Math.min(...rects.map((rect) => rect.top)),
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
            width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
          }
        : undefined;
      const style = getComputedStyle(anchor);
      const placement = companionPlacement(
        box,
        composer,
        root.current?.offsetHeight ?? 82,
        parseFloat(style.getPropertyValue('--agent-edge')) || 18,
        14,
        frame.classList.contains('with-agent-board'),
      );
      for (const [name, value] of Object.entries({
        '--agent-dock-clearance': placement.bottom,
        '--agent-dock-right': placement.right,
        '--agent-bubble-gap': placement.bubbleGap,
        '--agent-card-room': placement.room,
        '--agent-card-width': placement.width,
        '--agent-sheet-top': placement.sheetTop,
        '--agent-sheet-room': placement.sheetRoom,
      }))
        anchor.style.setProperty(name, `${value}px`);
      anchor.dataset.placement = placement.beside ? 'beside' : 'stacked';
      anchor.dataset.panel = placement.sheet ? 'sheet' : 'bubble';
      for (const element of observed)
        if (!controls.includes(element)) {
          resize.unobserve(element);
          observed.delete(element);
        }
      for (const element of controls)
        if (!observed.has(element)) {
          resize.observe(element);
          observed.add(element);
        }
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    const changed = (records: MutationRecord[]) => {
      if (records.some((record) => !root.current?.contains(record.target))) schedule();
    };
    resize.observe(frame);
    const mutation = new MutationObserver(changed);
    mutation.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    update();
    return () => {
      cancelAnimationFrame(pending);
      resize.disconnect();
      mutation.disconnect();
    };
  }, [root]);
}
