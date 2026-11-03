import type { ActivityOperation as Operation, OperationKind } from '../../../shared/agentActivity';

export const elapsed = (ms: number) =>
  ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;

const sourceName = (id: string, index: number): string => {
  const named = /^(fig|equ?|table)(\d+)$/.exec(id);
  if (named) return `${named[1] === 'fig' ? 'Figure' : named[1] === 'table' ? 'Table' : 'Equation'} ${named[2]}`;
  const page = /(?:^|:)p(\d+)\./.exec(id);
  return page ? `Source ${index + 1} · p. ${page[1]}` : `Source ${index + 1}`;
};

export function ActivityGlyph({ kind }: { kind: OperationKind }) {
  const path = {
    source: 'M5 3h8l4 4v14H5z M13 3v5h4 M8 12h6 M8 16h5',
    model: 'M5 5h14v12H9l-4 4z M9 9h6 M9 13h4',
    tool: 'M8 4 3 12l5 8 M16 4l5 8-5 8 M14 3l-4 18',
    cache: 'M18 8a7 7 0 1 0 1 7 M18 3v5h-5 M12 8v5l3 2',
    validation: 'm5 12 4 4 10-10 M4 4v16h16v-8',
    preview: 'M3 5h18v14H3z M3 15l5-5 5 5 3-3 5 5 M16 9h.01',
  }[kind];
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function ActivityOperation({
  operation,
  now,
  active,
  compact,
  onSource,
}: {
  operation: Operation;
  now: number;
  active: boolean;
  compact?: boolean;
  onSource?(id: string): void;
}) {
  const running = operation.state === 'running' && active;
  const state = running ? 'running' : operation.state === 'running' ? 'interrupted' : operation.state;
  return (
    <li className="activity-operation" data-state={state}>
      <span className="activity-operation-icon">
        <ActivityGlyph kind={operation.kind} />
      </span>
      <div className="activity-operation-content">
        <div className="activity-operation-label">
          <span>{operation.label}</span>
          {!compact && (
            <small>
              {elapsed((operation.endedAt ? Date.parse(operation.endedAt) : now) - Date.parse(operation.startedAt))}
            </small>
          )}
        </div>
        {!compact && (
          <>
            {operation.detail && <p>{operation.detail}</p>}
            {!!operation.refs?.length && (
              <div className="activity-source-list">
                {operation.refs.map((id, index) => (
                  <button key={id} type="button" onClick={() => onSource?.(id)}>
                    {sourceName(id, index)}
                  </button>
                ))}
              </div>
            )}
            {operation.draft && (
              <details className="activity-draft" open={running ? true : undefined}>
                <summary>{running ? 'Draft · checking follows' : 'Narration draft'}</summary>
                <p>{operation.draft}</p>
              </details>
            )}
          </>
        )}
      </div>
      <span className="activity-operation-mark" aria-label={running ? 'In progress' : state}>
        {running ? <span /> : state === 'completed' ? '✓' : state === 'failed' ? '!' : '−'}
      </span>
    </li>
  );
}
