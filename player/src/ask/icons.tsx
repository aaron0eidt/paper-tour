// Icons for the ask bar: 24px grid, currentColor, round strokes to match the reader's controls.

import type { ReactNode } from 'react';
import type { Answerable } from './api';

const Line = ({ size = 16, children }: { size?: number; children: ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

/** A four-point spark: the field asks the tutor, not a search box. */
export const SparkIcon = () => (
  <svg className="ask-spark" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M12 3.5Q13.1 10.9 20.5 12 13.1 13.1 12 20.5 10.9 13.1 3.5 12 10.9 10.9 12 3.5Z" />
  </svg>
);

export const SendIcon = () => (
  <Line size={17}>
    <path d="M12 18.5V6M6.5 11.5 12 6l5.5 5.5" strokeWidth="2" />
  </Line>
);

/** Stop, inside a ring that turns while the answer is being written. */
export const StopIcon = () => (
  <>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
    <svg className="ask-ring" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16.75" pathLength="100" />
    </svg>
  </>
);

export const ResumeIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
    <path d="M8 6.2v11.6a1 1 0 0 0 1.5.86l9.3-5.8a1 1 0 0 0 0-1.72L9.5 5.34A1 1 0 0 0 8 6.2z" />
  </svg>
);

/** How well the paper answers: a check, a half-filled circle, or a dash for "not in the paper". */
export const AnswerIcon = ({ answerable }: { answerable: Answerable }) => (
  <Line size={15}>
    <circle cx="12" cy="12" r="8.5" />
    {answerable === 'yes' && <path d="m8.4 12.3 2.4 2.4 4.8-5" />}
    {answerable === 'partly' && <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" />}
    {answerable === 'no' && <path d="M8.5 12h7" />}
  </Line>
);

export const AlertIcon = () => (
  <Line size={15}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.6v5M12 16.2h.01" />
  </Line>
);
