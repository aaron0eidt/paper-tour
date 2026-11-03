import { useLayoutEffect, type RefObject } from 'react';

/** Keep the companion above the actual question tray, including attachments and expanded conversations. */
export function useActivityPlacement(root: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const anchor = root.current?.parentElement;
    const frame = anchor?.parentElement;
    if (!anchor || !frame) return;
    let lane: Element | null = null;
    const update = () => {
      const box = frame.getBoundingClientRect();
      const tray = lane?.getBoundingClientRect();
      const clearance = tray ? box.bottom - tray.top + 18 : 18;
      anchor.style.setProperty('--agent-dock-clearance', `${clearance}px`);
      const withBoard = frame.classList.contains('with-agent-board');
      const size = root.current?.offsetHeight ?? 82;
      const room = box.height - (withBoard ? 13 : clearance) - size - 38;
      anchor.style.setProperty('--agent-card-room', `${Math.max(140, room)}px`);
      anchor.style.setProperty('--agent-card-width', `${Math.max(180, box.width - 44)}px`);
    };
    const resize = new ResizeObserver(update);
    const discover = () => {
      const next = frame.querySelector('.ask-lane');
      if (next !== lane) {
        if (lane) resize.unobserve(lane);
        lane = next;
        if (lane) resize.observe(lane);
      }
      update();
    };
    resize.observe(frame);
    const mutation = new MutationObserver(discover);
    mutation.observe(frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    discover();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [root]);
}
