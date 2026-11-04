// Adapted from useLayouts Save Button (MIT). See vendor/uselayouts-LICENSE.
// The original demo timers are replaced by real request state from the caller.
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ButtonHTMLAttributes } from 'react';
import { UI_SPRING } from './motion';

export function ActionButton({
  label,
  busy = false,
  success = false,
  className = 'library-button primary',
  shortcut,
  disabled,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  busy?: boolean;
  success?: boolean;
  shortcut?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      {...props}
      className={`ui-action-button ${className}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="ui-action-label" aria-hidden="true">
        <AnimatePresence initial={false} mode="popLayout">
          {Array.from(label).map((letter, index) => (
            <motion.span
              key={`${letter}-${index}`}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.75, filter: 'blur(3px)', y: 4 }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.75, filter: 'blur(3px)', y: -4 }}
              transition={reduce ? { duration: 0.08 } : UI_SPRING}
            >
              {letter === ' ' ? '\u00a0' : letter}
            </motion.span>
          ))}
        </AnimatePresence>
      </span>
      <span className="ui-sr-only">{label}</span>
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
      <AnimatePresence>
        {(busy || success) && (
          <motion.span
            className="ui-action-state"
            aria-hidden="true"
            key={busy ? 'busy' : 'success'}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={UI_SPRING}
          >
            {busy ? (
              <span className="ui-spinner" />
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m4 10 4 4 8-9" />
              </svg>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
