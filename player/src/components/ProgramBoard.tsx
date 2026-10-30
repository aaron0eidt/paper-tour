import { useEffect, useRef, useState } from 'react';
import type { ProgramItem } from '../../../shared/program';
import type { BoardPlayback } from '../engine';
import { useSpokenProgress } from './Plot';
import './authoredVisual.css';

/** Host narration owns time. Slider edits create a local draft; saved tour objects are never mutated. */
export function ProgramBoard({ item, playback }: { item: ProgramItem; playback: BoardPlayback }) {
  const progress = useSpokenProgress(playback.progress, playback.playing);
  const [parameters, setParameters] = useState<Record<string, number>>({});
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const worker = useRef<Worker>();
  const request = useRef(0);
  const pending = useRef<{ t: number; parameters: Record<string, number> }>();
  const busy = useRef(false);
  const send = useRef<() => void>(() => {});
  useEffect(() => {
    setParameters({});
    setImage('');
    setError('');
    busy.current = false;
    const instance = new Worker(new URL('../visuals/program.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    let timer: ReturnType<typeof setTimeout>;
    const fail = (message: string) => {
      clearTimeout(timer);
      instance.terminate();
      busy.current = false;
      send.current = () => {};
      setError(message);
    };
    send.current = () => {
      if (busy.current || !pending.current) return;
      const next = pending.current;
      pending.current = undefined;
      busy.current = true;
      instance.postMessage({ id: ++request.current, item, ...next });
      // Engine loading and frame evaluation are both bounded outside the UI thread.
      timer = setTimeout(() => fail('This scene exceeded its render budget. Try a simpler expression.'), 5_000);
    };
    instance.onmessage = (event) => {
      clearTimeout(timer);
      busy.current = false;
      if (event.data.error) {
        setError(event.data.error);
        send.current = () => {};
        instance.terminate();
        return;
      }
      const svg = event.data.frame.svg as string;
      setImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      setError('');
      send.current();
    };
    instance.onerror = () => fail('The scene could not start.');
    return () => {
      clearTimeout(timer);
      instance.terminate();
      worker.current = undefined;
    };
  }, [item]);
  useEffect(() => {
    pending.current = { t: progress, parameters };
    send.current();
  }, [progress, parameters, item]);
  const change = (name: string, value: number) => {
    const next = { ...parameters, [name]: value };
    setParameters(next);
    const revision = { ...item, parameters: item.parameters.map((p) => ({ ...p, value: next[p.name] ?? p.value })) };
    window.dispatchEvent(new CustomEvent('paper-tour:visual-revision', { detail: { item: revision } }));
  };
  return (
    <div className="authored-visual">
      {error ? (
        <div role="alert" className="authored-visual-error">
          {error}
        </div>
      ) : image ? (
        <img className="program-frame" src={image} alt={item.objective} />
      ) : (
        <p role="status">Preparing the live illustration…</p>
      )}
      {!!item.parameters.length && (
        <div className="visual-parameters" aria-label="Illustration parameters">
          {item.parameters.map((p) => (
            <label key={p.name}>
              <span>
                {p.label}
                <output>{parameters[p.name] ?? p.value}</output>
              </span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={parameters[p.name] ?? p.value}
                onChange={(e) => change(p.name, Number(e.target.value))}
              />
            </label>
          ))}
          {Object.keys(parameters).length > 0 && (
            <button
              type="button"
              onClick={() => {
                setParameters({});
                window.dispatchEvent(new CustomEvent('paper-tour:visual-revision', { detail: { item } }));
              }}
            >
              Reset example
            </button>
          )}
        </div>
      )}
    </div>
  );
}
