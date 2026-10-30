// "Not clear?": a quiet button beside the caption. It opens four choices (simpler, an example, a term, deeper) about the
// step on screen; the reader holds the tour while they are open and asks the choice through the ask flow. A disclosure,
// not a menu: Tab walks the choices, Escape closes it and hands focus back to the button.

import { useEffect, useRef } from 'react';
import { HelpIcon } from './icons';
import { UNCLEAR } from './unclear';
import type { Unclear } from './unclear';
import './notClear.css';

export interface NotClearProps {
  open: boolean;
  onOpen(): void;
  /** Closed without a choice. The tour goes on after Escape or the button, but stays held after a press elsewhere. */
  onClose(resume: boolean): void;
  onChoose(kind: Unclear): void;
}

export function NotClear({ open, onOpen, onClose, onChoose }: NotClearProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Opening puts the keyboard on the first choice; Escape and a press elsewhere close it.
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('.not-clear-option')?.focus();
    const away = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) onClose(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose(true);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onClose]);

  return (
    <div className="not-clear" ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className={`not-clear-button${open ? ' open' : ''}`}
        aria-label="Not clear?"
        aria-expanded={open}
        aria-controls="not-clear-choices"
        title="Not clear? Ask for it simpler, an example, a term or deeper (U)"
        onClick={() => (open ? onClose(true) : onOpen())}
      >
        <HelpIcon />
        <span>Not clear?</span>
      </button>
      {open && (
        <div className="not-clear-panel" id="not-clear-choices" role="group" aria-label="What would help with this step?">
          <p>What would help with this step?</p>
          <div className="not-clear-options">
            {UNCLEAR.map(({ kind, label, hint }) => (
              <button type="button" className="not-clear-option" key={kind} onClick={() => onChoose(kind)}>
                <strong>{label}</strong>
                <small>{hint}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
