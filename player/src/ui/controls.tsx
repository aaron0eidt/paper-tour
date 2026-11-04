import { Popover } from '@animate-ui/react/primitives/base-ui/popover';
import { Switch } from '@animate-ui/react/primitives/base-ui/switch';
import { Dialog } from '@animate-ui/react/primitives/base-ui/dialog';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { UI_EXIT, UI_SPRING } from './motion';
import { playInterfaceSound } from './sound';

export function AnimatedSwitch({
  checked,
  onCheckedChange,
  className = '',
  ...props
}: ComponentProps<typeof Switch.Root>) {
  return (
    <Switch.Root
      {...props}
      checked={checked}
      className={`ui-switch ${className}`}
      onCheckedChange={(value, details) => {
        onCheckedChange?.(value, details);
        playInterfaceSound(value ? 'toggle-on' : 'toggle-off');
      }}
    >
      <Switch.Thumb className="ui-switch-thumb" transition={UI_SPRING} />
    </Switch.Root>
  );
}

export function AnimatedPopover({
  trigger,
  children,
  className = '',
  open,
  onOpenChange,
  label,
  side = 'bottom',
  openOnHover = false,
}: {
  trigger: ReactElement;
  children: ReactNode;
  className?: string;
  label: string;
  side?: 'top' | 'bottom';
  openOnHover?: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        playInterfaceSound(next ? 'open' : 'close');
      }}
    >
      <Popover.Trigger render={trigger} openOnHover={openOnHover} delay={250} closeDelay={200} />
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="ui-popover-positioner"
        >
          <Popover.Popup
            className={`ui-popover ${className}`}
            aria-label={label}
            transition={UI_SPRING}
            exitTransition={UI_EXIT}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AnimatedDialog({
  children,
  className = '',
  popupProps,
  ...props
}: ComponentProps<typeof Dialog.Root> & {
  children: ReactNode;
  className?: string;
  popupProps?: ComponentProps<typeof Dialog.Popup>;
}) {
  return (
    <Dialog.Root {...props}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-modal-backdrop" transition={{ duration: 0.18 }} />
        <Dialog.Viewport className="ui-modal-viewport">
          <Dialog.Popup
            {...popupProps}
            className={`ui-modal ${className}`}
            transition={UI_SPRING}
            exitTransition={UI_EXIT}
          >
            {children}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export const DialogTitle = Dialog.Title;
