import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../player/src/themes.css', import.meta.url), 'utf8');
const tokens = (block: string) =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
const dark = tokens(css.split(':root {')[1].split('}')[0]);
const light = { ...dark, ...tokens(css.split(":root[data-theme='light'] {")[1].split('}')[0]) };
const luminance = (hex: string) => {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('secondary text and filenames stay readable in both interface themes', () => {
  for (const [name, palette] of [['dark', dark], ['light', light]] as const)
    for (const ink of ['text', 'muted', 'faint', 'text-secondary'])
      for (const surface of ['bg', 'panel', 'panel-2'])
        assert.ok(
          contrast(palette[ink], palette[surface]) >= 4.5,
          `${name}: ${ink} on ${surface}: ${contrast(palette[ink], palette[surface]).toFixed(2)}`,
        );
});

test('light theme text and feedback remain readable on their semantic surfaces', () => {
  for (const [ink, surface] of [
    ['text', 'panel'],
    ['muted', 'panel'],
    ['text-secondary', 'panel-2'],
    ['accent', 'panel'],
    ['on-accent', 'accent'],
    ['error-ink', 'error-surface'],
    ['warning-ink', 'warning-surface'],
    ['success-ink', 'panel'],
  ])
    assert.ok(
      contrast(light[ink], light[surface]) >= 4.5,
      `${ink} on ${surface}: ${contrast(light[ink], light[surface]).toFixed(2)}`,
    );
});
test('the interface theme preserves the mathematical canvas contrast pair', () => {
  assert.ok(contrast(light['canvas-text'], light['canvas-bg']) >= 7);
  assert.ok(contrast(light['canvas-muted'], light['canvas-bg']) >= 4.5);
  assert.equal(light['canvas-bg'], dark['canvas-bg']);
});
