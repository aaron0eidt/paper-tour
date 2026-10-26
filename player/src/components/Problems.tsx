import { useState } from 'react';
import type { Problem } from '../resolve';

/** Small list of load errors, unknown IDs and other tour problems behind a count badge. */
export function Problems({ problems, defaultOpen = false }: { problems: Problem[]; defaultOpen?: boolean }) {
  const serious = problems.filter((p) => p.level !== 'info').length;
  const [open, setOpen] = useState(defaultOpen);
  if (!problems.length) return null;
  return (
    <div className="problems">
      <button className={`chip${serious ? ' warn' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        {serious ? `${serious} problem${serious === 1 ? '' : 's'}` : `${problems.length} note${problems.length === 1 ? '' : 's'}`}
      </button>
      {open && (
        <ul className="problems-list">
          {problems.map((p, i) => (
            <li key={i} className={`problem ${p.level}`}>
              <span className="problem-level">{p.level}</span>
              {p.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
