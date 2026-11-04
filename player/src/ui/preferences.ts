export const UI_PREFERENCES_KEY = 'paper-tour:interface';
export const SOUND_PACKS = [
  { value: 'soft', label: 'Soft', detail: 'Warm, rounded feedback' },
  { value: 'minimal', label: 'Minimal', detail: 'Quiet and precise' },
  { value: 'zen', label: 'Zen', detail: 'Paper, wood and soft chimes' },
  { value: 'studio', label: 'Studio', detail: 'Tactile and restrained' },
] as const;
export interface InterfacePreferences {
  sounds: boolean;
  pack: (typeof SOUND_PACKS)[number]['value'];
  volume: number;
}
export const DEFAULT_INTERFACE_PREFERENCES: InterfacePreferences = {
  sounds: false,
  pack: 'soft',
  volume: 0.25,
};
export function parseInterfacePreferences(raw: string | null): InterfacePreferences {
  try {
    const value = JSON.parse(raw ?? '{}');
    return {
      sounds: value?.sounds === true,
      pack: SOUND_PACKS.some((pack) => pack.value === value?.pack) ? value.pack : 'soft',
      volume:
        typeof value?.volume === 'number' && Number.isFinite(value.volume)
          ? Math.max(0, Math.min(1, value.volume))
          : 0.25,
    };
  } catch {
    return { ...DEFAULT_INTERFACE_PREFERENCES };
  }
}
const listeners = new Set<() => void>();
let preferences = { ...DEFAULT_INTERFACE_PREFERENCES };
export const getInterfacePreferences = () => preferences;
export function subscribeInterfacePreferences(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function restore() {
  try {
    preferences = parseInterfacePreferences(localStorage.getItem(UI_PREFERENCES_KEY));
  } catch {
    preferences = { ...DEFAULT_INTERFACE_PREFERENCES };
  }
  listeners.forEach((listener) => listener());
}
export function setInterfacePreferences(patch: Partial<InterfacePreferences>) {
  preferences = parseInterfacePreferences(JSON.stringify({ ...preferences, ...patch }));
  try {
    localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    /* Available for this visit. */
  }
  listeners.forEach((listener) => listener());
}
export function initializeInterfacePreferences() {
  restore();
  const stored = (event: StorageEvent) => {
    if (event.key === UI_PREFERENCES_KEY || event.key === null) restore();
  };
  window.addEventListener('storage', stored);
  return () => window.removeEventListener('storage', stored);
}
