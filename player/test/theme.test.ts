function test(name: string, run: () => void) {
  run();
  console.log(`  ok    ${name}`);
}
const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
};
import {
  THEME_KEY,
  getThemePreference,
  getResolvedTheme,
  initializeTheme,
  parseTheme,
  resolvedTheme,
  setThemePreference,
  subscribeTheme,
} from '../src/theme';
import { readVisualTheme, themedPlotlyLayout } from '../src/visuals/theme';
import { PROGRAM_THEME } from '../../shared/programRuntime';

test('theme defaults to the existing dark style and resolves the optional system choice', () => {
  assert.equal(parseTheme(null), 'dark');
  assert.equal(parseTheme('invalid'), 'dark');
  assert.equal(parseTheme('light'), 'light');
  assert.equal(resolvedTheme('dark', true), 'dark');
  assert.equal(resolvedTheme('light', false), 'light');
  assert.equal(resolvedTheme('system', true), 'light');
  assert.equal(resolvedTheme('system', false), 'dark');
});

test('theme applies before mount, persists, follows system changes, syncs tabs and cleans up', () => {
  const keys = ['window', 'document', 'localStorage', 'matchMedia'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const storage = new Map([[THEME_KEY, 'light']]);
  const handlers = new Map<string, (event?: any) => void>();
  const root = { dataset: {} as Record<string, string> };
  const media = {
    matches: false,
    addEventListener: (_: string, fn: () => void) => handlers.set('media', fn),
    removeEventListener: () => handlers.delete('media'),
  };
  const values = {
    window: {
      addEventListener: (type: string, fn: () => void) => handlers.set(type, fn),
      removeEventListener: (type: string) => handlers.delete(type),
    },
    document: { documentElement: root },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    matchMedia: () => media,
  };
  let dispose: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] });
    dispose = initializeTheme();
    assert.equal(root.dataset.theme, 'light');
    let updates = 0;
    unsubscribe = subscribeTheme(() => updates++);
    setThemePreference('system');
    assert.equal(storage.get(THEME_KEY), 'system');
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(getResolvedTheme(), 'dark');
    media.matches = true;
    handlers.get('media')?.();
    assert.equal(root.dataset.theme, 'light');
    assert.equal(getResolvedTheme(), 'light');
    handlers.get('storage')?.({ key: 'another-setting', newValue: 'dark' });
    assert.equal(getThemePreference(), 'system');
    handlers.get('storage')?.({ key: THEME_KEY, newValue: 'dark' });
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(updates, 3);
    unsubscribe();
    unsubscribe = undefined;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem() {
          throw new Error('Storage blocked');
        },
      },
    });
    setThemePreference('light');
    assert.equal(root.dataset.theme, 'light');
    assert.equal(updates, 3);
    dispose();
    dispose = undefined;
    assert.equal(handlers.size, 0);
  } finally {
    unsubscribe?.();
    dispose?.();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('worker colours come from CSS and Plotly chrome follows them without changing ranges or cameras', () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {} } });
    Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({
      getPropertyValue: (name: string) => name === '--canvas-text' ? '#202735' : name === '--canvas-raised' ? '#f0f3f8' : '',
    }) });
    const theme = readVisualTheme();
    assert.equal(theme.text, '#202735'); assert.equal(theme.panel, '#f0f3f8');
    assert.equal(theme.blue, PROGRAM_THEME.blue);
    const layout = { xaxis: { range: [0, 10] }, yaxis2: { range: [1, 8] }, scene: { camera: { eye: { x: 1 } } },
      annotations: [{ text: 'Source label', font: { color: '#ffffff' }, bgcolor: '#11141b' }] };
    const before = JSON.stringify(layout);
    const themed = themedPlotlyLayout(layout, theme) as any;
    assert.equal(JSON.stringify(themed.xaxis.range), '[0,10]');
    assert.equal(JSON.stringify(themed.yaxis2.range), '[1,8]');
    assert.equal(themed.scene.camera.eye.x, 1);
    assert.equal(themed.font.color, '#202735');
    assert.equal(themed.scene.xaxis.gridcolor, '#f0f3f8');
    assert.equal(themed.annotations[0].font.color, '#202735');
    assert.equal(themed.annotations[0].bgcolor, 'transparent');
    assert.equal(JSON.stringify(layout), before);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (originalStyle) Object.defineProperty(globalThis, 'getComputedStyle', originalStyle); else Reflect.deleteProperty(globalThis, 'getComputedStyle');
  }
});
