import { useEffect, useRef, useState } from 'react';
import type { CompanionMood } from './presence';
import { createOrbRenderer, type OrbRenderer, type OrbState } from './orb/renderer';
import './avatarMotion.css';

/** Soft pigmented ink in a fixed circle; activity and narration drive its flow. */
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
      </span>
    </span>
  );
}
