export const THEME_KEY = 'paper-tour:theme';
export const THEME_OPTIONS = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
] as const;
export type ThemePreference = (typeof THEME_OPTIONS)[number]['id'];
export function parseTheme(value: string | null): ThemePreference {
  return THEME_OPTIONS.find((theme) => theme.id === value)?.id ?? 'dark';
}
export function resolvedTheme(preference: ThemePreference, systemLight: boolean): Exclude<ThemePreference, 'system'> {
  return preference === 'system' ? (systemLight ? 'light' : 'dark') : preference;
}

let preference: ThemePreference = 'dark';
const listeners = new Set<() => void>();
export const getThemePreference = () => preference;
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme(
    preference,
    matchMedia('(prefers-color-scheme: light)').matches,
  );
  listeners.forEach((listener) => listener());
}
export function setThemePreference(value: ThemePreference) {
  preference = value;
  try {
    localStorage.setItem(THEME_KEY, value);
  } catch {
    /* Still apply for this visit when storage is unavailable. */
  }
  applyTheme();
}
/** Apply before React mounts; keep other tabs and the optional system preference in sync. */
export function initializeTheme() {
  try {
    preference = parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    preference = 'dark';
  }
  const media = matchMedia('(prefers-color-scheme: light)');
  const changed = () => applyTheme();
  const stored = (event: StorageEvent) => {
    if (event.key === THEME_KEY || event.key === null) {
      preference = parseTheme(event.newValue);
      applyTheme();
    }
  };
  applyTheme();
  media.addEventListener('change', changed);
  window.addEventListener('storage', stored);
  return () => {
    media.removeEventListener('change', changed);
    window.removeEventListener('storage', stored);
  };
}
