import { useEffect, useId, useRef, useState } from 'react';
import type { CompanionMood } from './presence';
import { createOrbRenderer, type OrbRenderer, type OrbState } from './orb/renderer';
import './avatarMotion.css';

/** One closed loop (a lemniscate), drawn inside the ink: x = a·cos t / (1 + sin²t), y stretched for fuller lobes. */
const LOOP = (() => {
  const points: string[] = [];
  for (let i = 0; i < 120; i += 1) {
    const t = (i / 120) * Math.PI * 2;
    const d = 1 + Math.sin(t) ** 2;
    points.push(`${(50 + (31 * Math.cos(t)) / d).toFixed(2)} ${(50 + (48 * Math.sin(t) * Math.cos(t)) / d).toFixed(2)}`);
  }
  return `M${points.join('L')}Z`;
})();

/** Soft pigmented ink in a fixed circle; activity and narration drive its flow, and a blue loop runs through it. */
export function AgentAvatar({
  mood,
  word,
  engaged = false,
}: {
  mood: CompanionMood;
  word: number;
  engaged?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<OrbRenderer | null>(null);
  const latest = useRef<OrbState>({ mood, word, engaged });
  latest.current = { mood, word, engaged };
  const [available, setAvailable] = useState(false);
  const loop = `agent-loop-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const initialize = () => {
      renderer.current?.dispose();
      renderer.current = createOrbRenderer(element);
      renderer.current?.update(latest.current);
      setAvailable(!!renderer.current);
    };
    const lost = (event: Event) => {
      event.preventDefault();
      renderer.current?.dispose();
      renderer.current = null;
      setAvailable(false);
    };
    element.addEventListener('webglcontextlost', lost);
    element.addEventListener('webglcontextrestored', initialize);
    initialize();
    return () => {
      element.removeEventListener('webglcontextlost', lost);
      element.removeEventListener('webglcontextrestored', initialize);
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    renderer.current?.update(latest.current);
  }, [mood, word, engaged]);

  return (
    <span
      className="agent-avatar"
      data-mood={mood}
      data-engaged={engaged}
      data-renderer={available ? 'webgl' : 'static'}
      aria-hidden="true"
    >
      <span className="agent-fluid-surface">
        <span className="agent-fluid-fallback" />
        <canvas ref={canvas} className="agent-fluid-canvas" aria-hidden="true" />
        <svg className="agent-loop" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={loop} x1="16" y1="62" x2="84" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0866ff" />
              <stop offset=".55" stopColor="#1f86ff" />
              <stop offset="1" stopColor="#5fb7ff" />
            </linearGradient>
          </defs>
          <path className="agent-loop-ink" d={LOOP} stroke={`url(#${loop})`} />
          <path className="agent-loop-glint" d={LOOP} pathLength={100} />
        </svg>
      </span>
    </span>
  );
}
