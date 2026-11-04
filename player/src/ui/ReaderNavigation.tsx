import type { ReactNode } from 'react';
import * as Sidebar from '@animate-ui/react/primitives/sidebar';
import { Dialog } from '@animate-ui/react/primitives/base-ui/dialog';
import { CloseIcon } from '../components/icons';
import './readerNavigation.css';

export { useSidebar as useReaderNavigation } from '@animate-ui/react/primitives/sidebar';

export function ReaderNavigationProvider({ children }: { children: ReactNode }) {
  const expanded = !document.cookie.split('; ').includes('sidebar_state=false');
  return (
    <Sidebar.Provider defaultOpen={expanded} className="reader-navigation-provider">
      {children}
    </Sidebar.Provider>
  );
}

function PanelIcon({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="2" y="3" width="16" height="14" rx="2" />
      <path d={collapsed ? 'M6 3v14m4-10 3 3-3 3' : 'M8 3v14m6-10-3 3 3 3'} />
    </svg>
  );
}

export function ReaderNavigationToggle() {
  const { open, openMobile, isMobile, toggleSidebar } = Sidebar.useSidebar();
  const expanded = isMobile ? openMobile : open;
  return (
    <button
      type="button"
      className="reader-navigation-toggle"
      aria-controls="reader-navigation"
      aria-expanded={expanded}
      aria-label={expanded ? 'Close paper navigation' : 'Open paper navigation'}
      title={`${expanded ? 'Hide' : 'Show'} contents (⌘/Ctrl+B)`}
      onClick={toggleSidebar}
    >
      <Sidebar.TriggerIcon open={<PanelIcon />} closed={<PanelIcon collapsed />} />
      <span>Contents</span>
    </button>
  );
}

/** One content tree: a sliding desktop column or a focus-managed mobile sheet. */
export function ReaderNavigation({ children }: { children: ReactNode }) {
  const { isMobile, open, openMobile, setOpenMobile } = Sidebar.useSidebar();
  const content = <Sidebar.Highlight className="reader-navigation-content">{children}</Sidebar.Highlight>;
  if (isMobile)
    return (
      <Dialog.Root open={openMobile} onOpenChange={setOpenMobile}>
        <Dialog.Portal>
          <Dialog.Backdrop className="reader-navigation-backdrop" />
          <Dialog.Viewport className="reader-navigation-viewport">
            <Dialog.Popup className="reader-navigation-sheet" from="left">
              <div className="reader-navigation-sheet-head">
                <Dialog.Title>Contents</Dialog.Title>
                <Dialog.Close className="reader-navigation-close" aria-label="Close paper navigation">
                  <CloseIcon />
                </Dialog.Close>
              </div>
              {content}
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <div className="reader-navigation-slot" data-expanded={open}>
      <Sidebar.Gap className="reader-navigation-gap" style={{ width: open ? 'var(--sidebar-w)' : 0 }} />
      <Sidebar.Container
        className="reader-navigation-container"
        aria-hidden={!open}
        inert={!open}
        style={{ left: open ? 0 : 'calc(-1 * var(--sidebar-w))' }}
      >
        {content}
      </Sidebar.Container>
    </div>
  );
}
