import { useRef } from 'react';
import { Menu } from '@animate-ui/react/primitives/base-ui/menu';
import { UI_EXIT, UI_SPRING } from '../ui/motion';
import { playInterfaceSound } from '../ui/sound';

export function PaperActions({
  title,
  onRename,
  onDelete,
}: {
  title: string;
  onRename(trigger: HTMLElement): void;
  onDelete(trigger: HTMLElement): void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (open) playInterfaceSound('open');
      }}
    >
      <Menu.Trigger ref={trigger} className="ui-menu-trigger" aria-label={`Actions for ${title}`}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="16" cy="10" r="1.5" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="ui-menu-positioner" sideOffset={6} align="end" collisionPadding={12}>
          <Menu.Popup className="ui-menu" transition={UI_SPRING} exitTransition={UI_EXIT}>
            <Menu.Item
              className="ui-menu-item"
              onClick={() => {
                if (trigger.current) onRename(trigger.current);
              }}
            >
              Rename
            </Menu.Item>
            <Menu.Item
              className="ui-menu-item delete"
              onClick={() => {
                if (trigger.current) onDelete(trigger.current);
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
