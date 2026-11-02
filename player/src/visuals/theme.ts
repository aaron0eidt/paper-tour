import { useMemo, useSyncExternalStore } from 'react';
import { PROGRAM_THEME, type ProgramTheme } from '../../../shared/programRuntime';
import { getResolvedTheme, subscribeTheme } from '../theme';

/** Resolve the same semantic tokens used by native SVGs for renderers outside the document CSS tree. */
export function readVisualTheme(): ProgramTheme {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return PROGRAM_THEME;
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(PROGRAM_THEME).map(([name, fallback]) =>
    [name, style.getPropertyValue(`--canvas-${name === 'panel' ? 'raised' : name}`).trim() || fallback])) as ProgramTheme;
}

export function useVisualTheme(): ProgramTheme {
  const theme = useSyncExternalStore(subscribeTheme, getResolvedTheme, () => 'dark');
  return useMemo(readVisualTheme, [theme]);
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

/** Re-theme plot chrome while preserving scientific data, ranges, camera and semantic trace colours. */
export function themedPlotlyLayout(layout: Record<string, unknown> | undefined, theme: ProgramTheme): Record<string, unknown> {
  const chrome = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(chrome);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(record(value)).map(([key, child]) => [key,
      ['font', 'textfont', 'tickfont'].includes(key) ? { ...record(child), color: theme.text }
        : key === 'bgcolor' ? 'transparent' : key === 'arrowcolor' ? theme.muted : chrome(child)]));
  };
  const axis = (value: unknown) => ({ ...record(value), color: theme.muted, gridcolor: theme.panel,
    zerolinecolor: theme.muted, linecolor: theme.muted, tickcolor: theme.muted,
    tickfont: { ...record(record(value).tickfont), color: theme.muted } });
  const result = record(chrome(layout));
  for (const key of new Set(['xaxis', 'yaxis', ...Object.keys(result).filter((key) => /^[xyz]axis\d*$/.test(key))]))
    result[key] = axis(result[key]);
  for (const key of Object.keys(result).filter((key) => /^scene\d*$/.test(key))) {
    const scene = record(result[key]);
    result[key] = { ...scene, bgcolor: 'transparent', xaxis: axis(scene.xaxis), yaxis: axis(scene.yaxis), zaxis: axis(scene.zaxis) };
  }
  return { ...result, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
    font: { family: 'Arial, sans-serif', size: 15, ...record(layout?.font), color: theme.text },
    legend: { ...record(layout?.legend), font: { ...record(record(layout?.legend).font), color: theme.text } },
    colorway: [theme.blue, theme.pink, theme.green, theme.orange, theme.yellow] };
}
