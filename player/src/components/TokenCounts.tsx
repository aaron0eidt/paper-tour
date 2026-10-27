import { useEffect, useRef, useState } from 'react';
import type { TokenUsage } from '../../../shared/activity';
import './tokenCounts.css';

function Count({ label, value }: { label: string; value?: number }) {
  const [shown, setShown] = useState(0);
  const current = useRef(0);
  useEffect(() => {
    if (value === undefined) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const from = current.current,
      started = performance.now();
    let frame: number;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 650);
      current.current = Math.round(from + (value - from) * (1 - Math.pow(1 - progress, 3)));
      setShown(current.current);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <div
      className={`token-count${value === undefined ? ' waiting' : ''}`}
      aria-label={`${label}: ${value === undefined ? 'not reported yet' : value}`}
    >
      <dt>{label}</dt>
      <dd aria-hidden="true">{value === undefined ? '—' : shown.toLocaleString()}</dd>
    </div>
  );
}

export function TokenCounts({ usage, pending = false }: { usage?: TokenUsage; pending?: boolean }) {
  return (
    <div className="token-meter">
      <dl className="token-counts">
        <Count label="Input tokens" value={usage?.promptTokens} />
        <Count label="Output tokens" value={usage?.completionTokens} />
        {usage?.cachedInputTokens !== undefined && <Count label="Cached input" value={usage.cachedInputTokens} />}
      </dl>
      {pending && <span className="token-pending">{usage ? 'Reported so far' : 'Waiting for API token usage'}</span>}
    </div>
  );
}
