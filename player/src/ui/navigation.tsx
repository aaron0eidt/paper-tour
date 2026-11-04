import { useState } from 'react';
import { Menu } from '@animate-ui/react/primitives/base-ui/menu';
import { UI_EXIT, UI_SPRING } from './motion';

export function BackLink({ href, label = 'Back to library' }: { href: string; label?: string }) {
  return (
    <a className="ui-back-link" href={href}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <path d="m12 5-5 5 5 5M7 10h10" />
      </svg>
      {label}
    </a>
  );
}

export function AccountMenu({
  email,
  onSignOut,
  busy = false,
}: {
  email: string;
  onSignOut(): void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger className="ui-account-trigger" aria-label="Account menu" disabled={busy}>
        <span className="ui-account-avatar" aria-hidden="true">
          {email.charAt(0).toLocaleUpperCase()}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="ui-menu-positioner" align="end" sideOffset={8} collisionPadding={12}>
          <Menu.Popup className="ui-menu ui-account-menu" transition={UI_SPRING} exitTransition={UI_EXIT}>
            <div className="ui-account-identity">
              <small>Signed in as</small>
              <strong>{email}</strong>
            </div>
            <Menu.LinkItem className="ui-menu-item" href={`${import.meta.env.BASE_URL}?settings=profile`}>
              Profile &amp; Settings
            </Menu.LinkItem>
            <Menu.LinkItem className="ui-menu-item" href={`${import.meta.env.BASE_URL}?settings=voices`}>
              Manage voices
            </Menu.LinkItem>
            <Menu.Separator className="ui-menu-separator" />
            <Menu.Item className="ui-menu-item" onClick={onSignOut} disabled={busy}>
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
