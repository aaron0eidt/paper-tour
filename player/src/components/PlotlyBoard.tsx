import { AnimatedSlider } from '../ui/Slider';
import { useEffect, useRef, useState } from 'react';
import { plotlyFigure, plotlyProblems, type PlotlyItem } from '../../../shared/plotly';
import { loadPlotly } from '../visuals/preparation';
import { themedPlotlyLayout, useVisualTheme } from '../visuals/theme';
import './authoredVisual.css';

export function PlotlyBoard({ item }: { item: PlotlyItem }) {
  const theme = useVisualTheme();
  const element = useRef<HTMLDivElement>(null),
    [parameter, setParameter] = useState(item.parameter?.value ?? 1),
    [error, setError] = useState('');
  const rendered = useRef<(typeof import('plotly.js-dist-min'))['default'] | undefined>(undefined);
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
    const problems = plotlyProblems(item);
    if (problems.length) {
      setError(problems.join('; '));
      rendered.current?.purge(node);
      return;
    }
    loadPlotly()
      .then(async ({ default: Plotly }) => {
        if (cancelled) return;
        rendered.current = Plotly;
        const figure = plotlyFigure(item, parameter);
        await Plotly.react(
          node,
          figure.data,
          {
            ...themedPlotlyLayout(figure.layout, theme),
            autosize: true,
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
  }, [item, parameter, theme]);
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
            <AnimatedSlider label={item.parameter.label} min={item.parameter.min} max={item.parameter.max}
              step={item.parameter.step} value={parameter} onChange={change} />
          </label>
        </div>
      )}
    </div>
  );
}
