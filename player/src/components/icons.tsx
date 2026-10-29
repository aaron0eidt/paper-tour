// Small inline icons (24px grid, currentColor).

import type { ReactNode } from 'react';

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    {children}
  </svg>
);

export const PlayIcon = () => (
  <Svg>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </Svg>
);

export const PauseIcon = () => (
  <Svg>
    <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
  </Svg>
);

export const PrevIcon = () => (
  <Svg>
    <rect x="5" y="5" width="2.5" height="14" rx="1" />
    <path d="M19 6.2v11.6a.9.9 0 0 1-1.38.76L9.3 13.06a1.25 1.25 0 0 1 0-2.12l8.32-5.5A.9.9 0 0 1 19 6.2z" />
  </Svg>
);

export const NextIcon = () => (
  <Svg>
    <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
    <path d="M5 6.2v11.6a.9.9 0 0 0 1.38.76l8.32-5.5a1.25 1.25 0 0 0 0-2.12L6.38 5.44A.9.9 0 0 0 5 6.2z" />
  </Svg>
);

export const VolumeIcon = ({ muted }: { muted: boolean }) => (
  <Svg>
    <path d="M4 9.5v5a1 1 0 0 0 1 1h3l4.4 3.6a.6.6 0 0 0 1-.47V5.37a.6.6 0 0 0-1-.47L8 8.5H5a1 1 0 0 0-1 1z" />
    {muted ? (
      <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    ) : (
      <path d="M16 8.5a5 5 0 0 1 0 7M18.6 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    )}
  </Svg>
);

export const KeyboardIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="18" height="12" rx="2.5" />
    <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
  </svg>
);
