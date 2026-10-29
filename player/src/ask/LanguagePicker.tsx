import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { RESPONSE_LANGUAGES } from '../../../shared/languages';

const choices = [
  { value: '', label: 'Document language' },
  ...Object.entries(RESPONSE_LANGUAGES).map(([value, label]) => ({ value, label })),
];

/** A bounded listbox keeps the language menu inside the floating reader controls. */
export function LanguagePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const query = useRef({ text: '', at: 0 });
  const id = useId();
  const selected = Math.max(
    0,
    choices.findIndex((choice) => choice.value === value),
  );
  const label = value ? choices[selected].label : 'Auto';
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const show = () => {
    setActive(selected);
    setOpen(true);
    query.current = { text: '', at: 0 };
  };
  const choose = (index: number) => {
    onChange(choices[index].value);
    close(true);
  };
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (!open || !list.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!row) return;
    const top = row.offsetTop;
    if (top < list.current.scrollTop) list.current.scrollTop = top;
    else if (top + row.offsetHeight > list.current.scrollTop + list.current.clientHeight)
      list.current.scrollTop = top + row.offsetHeight - list.current.clientHeight;
  }, [open, active]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      choose(active);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      setActive((index) =>
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? choices.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length,
      );
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      query.current = {
        text: (now - query.current.at < 700 ? query.current.text : '') + event.key.toLowerCase(),
        at: now,
      };
      const next = choices.findIndex((choice) => choice.label.toLowerCase().startsWith(query.current.text));
      if (next >= 0) setActive(next);
    }
  };
  return (
    <div className="ask-language-control" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="ask-language"
        disabled={disabled}
        aria-label={`Answer language: ${value ? label : 'Auto, match document'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={value ? `Answer in ${label}` : 'Match the document language'}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            show();
            if (event.key === 'Home') setActive(0);
            if (event.key === 'End') setActive(choices.length - 1);
          }
        }}
      >
        <svg
          viewBox="0 0 20 20"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          aria-hidden="true"
        >
          <circle cx="10" cy="10" r="7" />
          <path d="M3 10h14M10 3c4 4 4 10 0 14C6 13 6 7 10 3Z" />
        </svg>
        <span>{label}</span>
        <svg
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="ask-language-menu">
          <div className="ask-language-heading">Answer language</div>
          <div
            ref={list}
            id={id}
            className="ask-language-list"
            role="listbox"
            aria-label="Answer language"
            aria-activedescendant={`${id}-${active}`}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            {choices.map((choice, index) => (
              <div
                key={choice.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={choice.value === value}
                data-index={index}
                className={active === index ? 'active' : ''}
                onPointerMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>
                  {choice.label}
                  {!choice.value && <small>Match this document automatically</small>}
                </span>
                {choice.value === value && (
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <path d="m3 8 3 3 7-7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
