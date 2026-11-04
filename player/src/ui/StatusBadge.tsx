import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AnimatedPopover } from './controls';

export type StatusTone = 'ready' | 'pending' | 'failed' | 'limited' | 'idle' | 'unavailable';
/** A shared status vocabulary for document cards, the reader and generation controls. */
export function StatusBadge({
  label,
  tone = 'idle',
  detail,
  busy = false,
  onClick,
}: {
  label: string;
  tone?: StatusTone;
  detail?: string;
  busy?: boolean;
  onClick?(): void;
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const content = (
    <>
      {busy ? (
        <span className="ui-spinner" aria-hidden="true" />
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          {tone === 'ready' ? (
            <>
              <circle cx="10" cy="10" r="8" />
              <path d="m6 10 3 3 5-6" />
            </>
          ) : tone === 'failed' || tone === 'limited' || tone === 'unavailable' ? (
            <>
              <circle cx="10" cy="10" r="8" />
              <path d="M10 5v6m0 3v1" />
            </>
          ) : (
            <>
              <circle cx="10" cy="10" r="7" />
              <path d="M10 6v4l3 2" />
            </>
          )}
        </svg>
      )}
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={label}
          initial={{ opacity: 0, y: reduce ? 0 : 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
      {(detail || onClick) && (
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      )}
    </>
  );
  if (onClick)
    return (
      <button
        type="button"
        className="ui-status-badge"
        data-tone={tone}
        aria-label={`${label}: open activity`}
        aria-haspopup="dialog"
        title={detail}
        onClick={onClick}
      >
        {content}
      </button>
    );
  if (!detail)
    return (
      <span className="ui-status-badge" data-tone={tone}>
        {content}
      </span>
    );
  return (
    <AnimatedPopover
      open={open}
      onOpenChange={setOpen}
      label={`${label} details`}
      trigger={
        <button
          type="button"
          className="ui-status-badge"
          data-tone={tone}
          aria-label={`${label}: more information`}
        >
          {content}
        </button>
      }
    >
      <div className="ui-status-detail">
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </AnimatedPopover>
  );
}
