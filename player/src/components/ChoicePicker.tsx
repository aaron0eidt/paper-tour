import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import './choicePicker.css';

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  detail?: string;
  group?: string;
  groupCode?: string;
  searchText?: string;
}

/** Uses the reader's listbox interaction pattern; the portal escapes scrolling audio panels. */
export function ChoicePicker<T extends string>({ value, options, onChange, label, disabled = false, searchable = false }: {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(value: T): void;
  label: string;
  disabled?: boolean;
  searchable?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(value);
  const [placement, setPlacement] = useState({ left: 0, top: 0, width: 320, maxHeight: 360 });
  const selected = options.find((option) => option.value === value);
  const visible = options.filter((option) => `${option.label} ${option.badge ?? ''} ${option.detail ?? ''} ${option.group ?? ''} ${option.searchText ?? ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const activeIndex = Math.max(0, visible.findIndex((option) => option.value === active));
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  const show = () => { setQuery(''); setActive(value); setOpen(true); typeahead.current = { text: '', at: 0 }; };
  const choose = (option: ChoiceOption<T>) => { close(true); if (option.value !== value) onChange(option.value); };

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !popup.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const height = popup.current.getBoundingClientRect().height;
    const below = window.innerHeight - anchor.bottom - 12;
    const above = anchor.top - 12;
    const upwards = below < height && above > below;
    const maxHeight = Math.max(48, Math.min(360, upwards ? above : below));
    const width = Math.min(360, Math.max(220, anchor.width), window.innerWidth - 24);
    setPlacement({ width, maxHeight, left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)),
      top: upwards ? Math.max(12, anchor.top - Math.min(height, maxHeight) - 6) : anchor.bottom + 6 });
    (searchable ? search.current : list.current)?.focus({ preventScroll: true });
  }, [open, searchable]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const row = document.getElementById(`${id}-${activeIndex}`);
    if (row && list.current) {
      const top = row.offsetTop;
      if (top < list.current.scrollTop) list.current.scrollTop = top;
      else if (top + row.offsetHeight > list.current.scrollTop + list.current.clientHeight)
        list.current.scrollTop = top + row.offsetHeight - list.current.clientHeight;
    }
  }, [open, activeIndex, id, query]);

  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Tab') { close(true); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const inSearch = event.target === search.current;
    if (event.key === 'Enter' || (event.key === ' ' && !inSearch)) {
      event.preventDefault(); event.stopPropagation(); if (visible[activeIndex]) choose(visible[activeIndex]); return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) || (!inSearch && ['Home', 'End'].includes(event.key))) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 :
        (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
      if (visible[next]) setActive(visible[next].value);
    } else if (!inSearch && event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      const now = Date.now();
      typeahead.current = { text: (now - typeahead.current.at < 700 ? typeahead.current.text : '') + event.key.toLocaleLowerCase(), at: now };
      const next = visible.find((option) => option.label.toLocaleLowerCase().startsWith(typeahead.current.text));
      if (next) setActive(next.value);
    }
  };

  return <>
    <button ref={trigger} type="button" className="choice-trigger" role="combobox" aria-label={label}
      title={[selected?.group, selected?.label, selected?.badge, selected?.detail].filter(Boolean).join(' · ')}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => open ? close() : show()} onKeyDown={(event) => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation(); show();
          if (event.key === 'Home' && options[0]) setActive(options[0].value);
          if (event.key === 'End' && options.length) setActive(options[options.length - 1].value);
        }
      }}>
      <span className="choice-selected"><span className="choice-selected-label">{selected?.label ?? value}</span>{selected?.badge && <span className="choice-badge">{selected.badge}</span>}</span>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && createPortal(<div ref={popup} className="choice-popup" style={{ ...placement, ...(searchable ? { height: placement.maxHeight } : {}) }} onKeyDown={keyboard}>
      {searchable && <input ref={search} className="choice-search" type="search" aria-label={`Search ${label.toLowerCase()}`}
        aria-controls={id} aria-activedescendant={visible.length ? `${id}-${activeIndex}` : undefined}
        placeholder="Search name, language or country…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div ref={list} id={id} className="choice-list" role="listbox" aria-label={label} tabIndex={-1}
        aria-activedescendant={visible.length ? `${id}-${activeIndex}` : undefined}>
        {visible.map((option, index) => <div key={option.value}>
          {option.group && option.group !== visible[index - 1]?.group && <div className="choice-group" role="presentation">{option.groupCode && <span className="choice-language-code">{option.groupCode}</span>}{option.group}</div>}
          <div id={`${id}-${index}`} role="option" aria-selected={option.value === value} aria-label={[option.group, option.label, option.badge, option.detail].filter(Boolean).join(', ')}
            className={`choice-option${index === activeIndex ? ' active' : ''}`} onPointerMove={() => setActive(option.value)} onClick={() => choose(option)}>
            <span><span className="choice-option-title"><span>{option.label}</span>{option.badge && <span className="choice-badge">{option.badge}</span>}</span>{option.detail && <small>{option.detail}</small>}</span>
            {option.value === value && <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>}
          </div>
        </div>)}
        {!visible.length && <p className="choice-empty">No matching voices.</p>}
      </div>
    </div>, document.body)}
  </>;
}
