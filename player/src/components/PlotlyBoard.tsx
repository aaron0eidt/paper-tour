import { useEffect, useRef, useState } from 'react';
import { plotlyFigure, type PlotlyItem } from '../../../shared/plotly';
import './authoredVisual.css';

export function PlotlyBoard({ item }: { item: PlotlyItem }) {
  const element = useRef<HTMLDivElement>(null),
    [parameter, setParameter] = useState(item.parameter?.value ?? 1),
    [error, setError] = useState('');
  const rendered = useRef<(typeof import('plotly.js-dist-min'))['default']>();
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (rendered.current) rendered.current.Plots.resize(node);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      rendered.current?.purge(node);
    };
  }, []);
  useEffect(() => setParameter(item.parameter?.value ?? 1), [item]);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let cancelled = false;
    import('plotly.js-dist-min')
      .then(async ({ default: Plotly }) => {
        if (cancelled) return;
        rendered.current = Plotly;
        const figure = plotlyFigure(item, parameter);
        await Plotly.react(
          node,
          figure.data,
          {
            ...figure.layout,
            autosize: true,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'Arial, sans-serif', size: 15, color: '#dce2ee' },
            colorway: ['#7ea6ff', '#ef8ac9', '#6fd3b1', '#ffb96f'],
            margin: { l: 60, r: 25, t: 35, b: 60 },
            uirevision: item.title ?? 'live-plot',
          },
          {
            responsive: true,
            displaylogo: false,
            modeBarButtonsToRemove: ['sendDataToCloud', 'sendChartToCloud'],
            showLink: false,
          },
        );
        if (!cancelled) setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Plot could not render');
      });
    return () => {
      cancelled = true;
    };
  }, [item, parameter]);
  const change = (value: number) => {
    setParameter(value);
    window.dispatchEvent(
      new CustomEvent('paper-tour:visual-revision', {
        detail: { item: { ...item, parameter: { ...item.parameter, value } } },
      }),
    );
  };
  return (
    <div className="authored-visual">
      {error && <p role="alert">{error}</p>}
      <div ref={element} className="plotly-frame" aria-label={item.objective} />
      {item.parameter && (
        <div className="visual-parameters">
          <label>
            <span>
              {item.parameter.label}
              <output>{parameter}</output>
            </span>
            <input
              type="range"
              min={item.parameter.min}
              max={item.parameter.max}
              step={item.parameter.step}
              value={parameter}
              onChange={(e) => change(Number(e.target.value))}
            />
          </label>
        </div>
      )}
    </div>
  );
}
