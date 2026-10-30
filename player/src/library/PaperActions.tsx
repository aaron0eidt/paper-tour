import { useEffect, useRef, useState } from 'react';

/** Native disclosure semantics; dismissing it never steals focus from the next clicked control. */
export function PaperActions({ title, onRename, onDelete }: {
  title: string;
  onRename(trigger: HTMLElement): void;
  onDelete(trigger: HTMLElement): void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = details.current;
    if (!open || !element) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) element.open = false;
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      element.open = false;
      trigger.current?.focus();
    };
    const page = element.ownerDocument;
    page.addEventListener('pointerdown', dismissOutside);
    page.addEventListener('keydown', dismissWithEscape);
    return () => {
      page.removeEventListener('pointerdown', dismissOutside);
      page.removeEventListener('keydown', dismissWithEscape);
    };
  }, [open]);

  function choose(action: (trigger: HTMLElement) => void) {
    if (!details.current || !trigger.current) return;
    details.current.open = false;
    trigger.current.focus();
    action(trigger.current);
  }

  return (
    <details
      className="library-more"
      name="paper-actions"
      ref={details}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
      }}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary ref={trigger} aria-label={`Actions for ${title}`}>•••</summary>
      <div>
        <button type="button" onClick={() => choose(onRename)}>
          Rename
        </button>
        <button type="button" className="delete" onClick={() => choose(onDelete)}>
          Delete
        </button>
      </div>
    </details>
  );
}
