import { memo } from 'react';
import { Cursor, CursorContainer, CursorFollow, CursorProvider } from '@animate-ui/react/primitives/cursor';
import './regionSelectionCursor.css';

/** Mounted only inside the active picker: native pointers elsewhere stay untouched. */
export const RegionSelectionCursor = memo(function RegionSelectionCursor({ dragging }: { dragging: boolean }) {
  return (
    <CursorProvider>
      <CursorContainer className="region-selection-cursor" aria-hidden="true">
        <Cursor className="region-selection-cursor-mark">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2v7m0 6v7M2 12h7m6 0h7" stroke="var(--panel)" strokeWidth="4" strokeLinecap="round" />
            <path d="M12 2v7m0 6v7M2 12h7m6 0h7" stroke="var(--accent-ink)" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="12" r="1.5" fill="var(--accent-ink)" />
          </svg>
        </Cursor>
        <CursorFollow className="region-selection-cursor-label" side="bottom" align="end" sideOffset={14} alignOffset={10}>
          {dragging ? 'Release to select' : 'Drag to select'}
        </CursorFollow>
      </CursorContainer>
    </CursorProvider>
  );
});
